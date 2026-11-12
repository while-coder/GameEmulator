package com.wandergame.emulator.nativecore

import android.net.Uri
import android.util.Base64
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.Closeable
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Tauri WebView adapter. It neither replaces Wry's WebViewClient nor opens a server. */
class NativeWebViewBridge(private val webView: WebView, private val emulator: NativeEmulator,
                          debug: Boolean) : Closeable {
    private val worker = ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS, ArrayBlockingQueue(32))
    @Volatile private var closed = false
    init {
        check(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) { "请更新 Android System WebView 后使用原生模拟器" }
        val origins = if (debug) setOf("*") else setOf("https://tauri.localhost", "http://tauri.localhost")
        WebViewCompat.addWebMessageListener(webView, "GameEmulatorNative", origins) { _, message, origin, mainFrame, reply ->
            val trusted = origin.host == "tauri.localhost" && origin.scheme in listOf("http", "https") || debug && origin.scheme == "http" && origin.port == 1801
            if (!mainFrame || !trusted || closed) return@addWebMessageListener
            val raw = message.data ?: return@addWebMessageListener
            if (raw.length > 12 * 1024 * 1024) return@addWebMessageListener
            try {
                worker.execute {
                    val response = JSONObject()
                    try {
                        val request = JSONObject(raw)
                        response.put("id", request.getLong("id"))
                        val data = Base64.decode(request.optString("body", ""), Base64.DEFAULT)
                        check(!closed) { "游戏页面已关闭" }
                        val result = emulator.request(request.getString("method"), request.getString("path"), data)
                        response.put("body", Base64.encodeToString(result.bytes, Base64.NO_WRAP)).put("mime", result.mime)
                    } catch (error: Exception) { response.put("error", (error.message ?: "原生模拟器操作失败").take(300)) }
                    webView.post { if (!closed) reply.postMessage(response.toString()) }
                }
            } catch (_: java.util.concurrent.RejectedExecutionException) {
                val id = runCatching { JSONObject(raw).getLong("id") }.getOrDefault(-1)
                reply.postMessage(JSONObject().put("id", id).put("error", "原生请求队列已满，请重试").toString())
            }
        }
    }
    override fun close() {
        closed = true
        WebViewCompat.removeWebMessageListener(webView, "GameEmulatorNative")
        worker.shutdownNow()
    }
}
