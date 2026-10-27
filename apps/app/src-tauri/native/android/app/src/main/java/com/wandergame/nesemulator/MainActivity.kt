package com.wandergame.nesemulator

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
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
}
