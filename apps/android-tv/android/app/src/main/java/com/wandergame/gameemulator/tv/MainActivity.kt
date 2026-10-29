package com.wandergame.gameemulator.tv

import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import org.json.JSONObject
import org.mozilla.geckoview.AllowOrDeny
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoView
import org.mozilla.geckoview.WebExtension

class MainActivity : ComponentActivity() {
    private lateinit var session: GeckoSession
    private lateinit var view: GeckoView
    private var port: WebExtension.Port? = null
    private val handler = Handler(Looper.getMainLooper())
    private var backSequence = 0
    private var pendingBack: Int? = null
    private var hostFailed = false
    private var filePrompt: GeckoSession.PromptDelegate.FilePrompt? = null
    private var fileResult: GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? = null

    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val prompt = filePrompt
        val response = fileResult
        filePrompt = null
        fileResult = null
        if (prompt != null && response != null && !prompt.isComplete) {
            val data = result.data
            val uris = mutableListOf<Uri>()
            if (result.resultCode == RESULT_OK && data != null) {
                data.data?.let(uris::add)
                data.clipData?.let { clip -> for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri) }
            }
            response.complete(if (uris.isEmpty()) prompt.dismiss() else prompt.confirm(applicationContext, uris.distinct().toTypedArray()))
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        immersive()
        val app = application as TvApplication
        try { app.startServer() } catch (error: Exception) {
            showError("本地资源服务启动失败：${error.message}")
            return
        }
        view = GeckoView(this)
        setContentView(view)
        session = GeckoSession()
        session.navigationDelegate = object : GeckoSession.NavigationDelegate {
            override fun onLoadRequest(session: GeckoSession, request: GeckoSession.NavigationDelegate.LoadRequest): GeckoResult<AllowOrDeny> {
                val uri = Uri.parse(request.uri)
                // Keep the document on our origin; remote ROM/catalog fetches are unaffected.
                return GeckoResult.fromValue(if (uri.scheme == "http" && uri.host == "127.0.0.1" && uri.port == AssetServer.PORT)
                    AllowOrDeny.ALLOW else AllowOrDeny.DENY)
            }
        }
        session.contentDelegate = object : GeckoSession.ContentDelegate {
            override fun onFullScreen(session: GeckoSession, fullScreen: Boolean) { immersive() }
            override fun onCrash(session: GeckoSession) { showError("浏览器进程意外退出，请重新打开应用。") }
        }
        session.promptDelegate = object : GeckoSession.PromptDelegate {
            override fun onFilePrompt(session: GeckoSession, prompt: GeckoSession.PromptDelegate.FilePrompt): GeckoResult<GeckoSession.PromptDelegate.PromptResponse> {
                if (fileResult != null) return GeckoResult.fromValue(prompt.dismiss())
                val response = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
                filePrompt = prompt
                fileResult = response
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    // TV file providers often omit .nes/.zip MIME mappings. Let the frontend validate files.
                    type = "*/*"
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, prompt.type == GeckoSession.PromptDelegate.FilePrompt.Type.MULTIPLE)
                }
                try { filePicker.launch(intent) } catch (_: ActivityNotFoundException) {
                    filePrompt = null; fileResult = null
                    response.complete(prompt.dismiss())
                    Toast.makeText(this@MainActivity, "此设备没有可用的文件选择器，请使用在线游戏库。", Toast.LENGTH_LONG).show()
                }
                return response
            }
            override fun onAlertPrompt(session: GeckoSession, prompt: GeckoSession.PromptDelegate.AlertPrompt): GeckoResult<GeckoSession.PromptDelegate.PromptResponse> {
                val response = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
                AlertDialog.Builder(this@MainActivity).setMessage(prompt.message)
                    .setPositiveButton(android.R.string.ok) { _, _ -> response.complete(prompt.dismiss()) }
                    .setOnCancelListener { response.complete(prompt.dismiss()) }.show()
                return response
            }
        }
        session.open(app.runtime)
        view.setSession(session)
        view.requestFocus()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { sendBack() }
        })
        app.runtime.webExtensionController.ensureBuiltIn(
            "resource://android/assets/bridge/", "tv-bridge@gameemulator.local"
        ).accept({ extension ->
            if (isDestroyed) return@accept
            if (extension == null) {
                showError("返回键桥接初始化失败，请重新打开应用。")
                return@accept
            }
            session.webExtensionController.setMessageDelegate(extension, object : WebExtension.MessageDelegate {
                override fun onConnect(newPort: WebExtension.Port) {
                    port = newPort
                    newPort.setDelegate(object : WebExtension.PortDelegate {
                        override fun onPortMessage(message: Any, source: WebExtension.Port) {
                            val json = message as? JSONObject ?: return
                            if (source !== port || json.optString("type") != "backResult" || json.optInt("id") != pendingBack) return
                            pendingBack = null
                            if (json.optString("result") == "exit") finish()
                        }
                        override fun onDisconnect(source: WebExtension.Port) {
                            if (source === port) { port = null; pendingBack = null }
                        }
                    })
                }
            }, "game_emulator")
            session.loadUri("${AssetServer.ORIGIN}/index.html")
        }, { error -> if (!isDestroyed) showError("返回键桥接初始化失败：${error?.message ?: "未知错误"}") })
    }

    private fun sendBack() {
        if (hostFailed) { finish(); return }
        if (pendingBack != null) return
        val channel = port
        if (channel == null) {
            Toast.makeText(this, "页面正在加载，请稍后重试返回。", Toast.LENGTH_SHORT).show()
            return
        }
        val id = ++backSequence
        pendingBack = id
        channel.postMessage(JSONObject().put("type", "back").put("id", id))
        handler.postDelayed({ if (pendingBack == id) pendingBack = null }, 1500)
    }

    @Suppress("DEPRECATION")
    private fun immersive() {
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
    }

    private fun showError(message: String) {
        hostFailed = true
        setContentView(TextView(this).apply { text = message; textSize = 20f; setPadding(48, 48, 48, 48) })
    }
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) immersive()
    }
    override fun onStart() {
        super.onStart()
        if (::session.isInitialized) session.setActive(true)
    }
    override fun onStop() {
        if (::session.isInitialized) session.setActive(false)
        super.onStop()
    }
    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        filePrompt?.let { if (!it.isComplete) fileResult?.complete(it.dismiss()) }
        port?.disconnect()
        if (::session.isInitialized) session.close()
        super.onDestroy()
    }
}
