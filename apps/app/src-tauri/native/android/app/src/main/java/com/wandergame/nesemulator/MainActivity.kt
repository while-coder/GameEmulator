package com.wandergame.nesemulator

import android.os.Bundle
import android.webkit.WebView
import android.view.View
import android.view.ViewGroup
import android.view.KeyEvent
import android.view.MotionEvent
import android.widget.FrameLayout
import android.widget.Toast
import com.wandergame.emulator.nativecore.NativeEmulator
import com.wandergame.emulator.nativecore.NativeWebViewBridge
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var emulator: NativeEmulator? = null
  private var nativeBridge: NativeWebViewBridge? = null
  private var playerWebView: WebView? = null
  private fun notifyNativePause() {
    playerWebView?.evaluateJavascript("window.dispatchEvent(new Event('tv-native-pause'))", null)
  }
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // TauriActivity 把 WryActivity 内置的"返回键 → WebView.goBack"关掉了(handleBackNavigation=false),
  // 默认行为变成"finish 当前 Activity",在 Android TV 遥控器/手机上按返回就直接退出 app。
  // 这里把物理返回直接转给 JS 层(window.__handleAndroidBack):JS 返回 "handled" 时啥都不做(已经关面板/停 ROM 之类),
  // 返回 "exit" 才在原生侧 finish() Activity。绕开 @tauri-apps/plugin-process 的 exit() 在 Android 上不稳的问题。
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    playerWebView = webView
    nativeBridge?.close(); emulator?.close()
    val root = FrameLayout(this)
    try {
      val session = NativeEmulator(this, root, ::notifyNativePause) { message ->
        Toast.makeText(this, message ?: "原生模拟器操作失败", Toast.LENGTH_LONG).show()
        notifyNativePause()
      }
      emulator = session
      nativeBridge = NativeWebViewBridge(webView, session, BuildConfig.DEBUG)
      // Wry installs the WebView as content after this hook. Wrap it only once
      // attached, preserving its layout/insets and Wry's own WebViewClient.
      webView.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
        override fun onViewAttachedToWindow(view: View) {
          webView.removeOnAttachStateChangeListener(this)
          webView.post {
            if (isDestroyed || emulator !== session) return@post
            val parent = webView.parent as? ViewGroup ?: return@post
            val index = parent.indexOfChild(webView); val params = webView.layoutParams
            parent.removeView(webView)
            root.addView(webView, 0, FrameLayout.LayoutParams(-1, -1))
            parent.addView(root, index, params)
          }
        }
        override fun onViewDetachedFromWindow(view: View) {}
      })
    } catch (error: Exception) {
      Toast.makeText(this, error.message ?: "原生模拟器初始化失败", Toast.LENGTH_LONG).show()
    } catch (error: LinkageError) {
      Toast.makeText(this, "原生内核加载失败：${error.message}", Toast.LENGTH_LONG).show()
    }
    webView.settings.apply {
      setSupportZoom(false)
      builtInZoomControls = false
      displayZoomControls = false
    }
    webView.isLongClickable = false
    webView.setOnLongClickListener { true }
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        webView.evaluateJavascript(
          "(typeof window.__handleAndroidBack==='function')?window.__handleAndroidBack():null"
        ) { result ->
          // evaluateJavascript 把字符串结果包成 JSON 字面量,'exit' → "\"exit\"";handler 未注入时为 "null"。
          if (result == "\"exit\"" || result == "null") {
            finish()
          }
        }
      }
    })
  }
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (emulator?.key(event) == true) return true
    return super.dispatchKeyEvent(event)
  }
  override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
    if (emulator?.motion(event) == true) return true
    return super.dispatchGenericMotionEvent(event)
  }
  override fun onPause() {
    emulator?.pause(); notifyNativePause()
    super.onPause()
  }
  override fun onDestroy() {
    nativeBridge?.close(); nativeBridge = null
    emulator?.close(); emulator = null; playerWebView = null
    super.onDestroy()
  }
}
