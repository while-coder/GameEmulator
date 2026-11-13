package com.whilecode.gameemulator.tv

import android.app.Application
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoRuntimeSettings

class TvApplication : Application() {
    // One runtime and asset server per process, surviving Activity recreation.
    val runtime: GeckoRuntime by lazy {
        GeckoRuntime.create(this, GeckoRuntimeSettings.Builder()
            .remoteDebuggingEnabled(BuildConfig.DEBUG)
            .consoleOutput(BuildConfig.DEBUG)
            .build())
    }
    private var server: AssetServer? = null
    fun setNativeHandler(handler: ((String, String, ByteArray) -> AssetServer.NativeResponse)?) {
        server?.nativeHandler = handler
    }
    fun startServer() {
        if (server == null) server = AssetServer { assets.open("www/$it") }
    }
}
