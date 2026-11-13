package com.whilecode.gameemulator.nativecore

import android.graphics.SurfaceTexture
import android.app.Activity
import android.hardware.input.InputManager
import android.media.AudioManager
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.Surface
import android.view.TextureView
import android.view.View
import android.widget.FrameLayout
import android.widget.TextView
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Owns one libretro session. Only commands and files cross the browser boundary. */
data class NativeResponse(val bytes: ByteArray, val mime: String)

class NativeEmulator(private val activity: Activity, private val root: FrameLayout,
                     private val notifyPause: () -> Unit, private val notifyFailure: (String?) -> Unit) : InputManager.InputDeviceListener {
    companion object {
        const val BUILD = "fceumm-e0f3086-native-v1"
        const val ARCADE_BUILD = "fbalpha2012-0ce3153-native-v1"
        init { System.loadLibrary("gameemulator") }
    }
    private external fun create(directory: String): Long
    private external fun destroy(handle: Long)
    private external fun load(handle: Long, bytes: ByteArray, hash: String, arcade: Boolean, path: String)
    private external fun setSurface(handle: Long, surface: Surface?)
    private external fun control(handle: Long, action: String, value: Double)
    private external fun buttons(handle: Long, player: Int, mask: Int)
    private external fun turbo(handle: Long, player: Int, mask: Int, hz: Double)
    private external fun save(handle: Long): ByteArray
    private external fun restore(handle: Long, bytes: ByteArray)
    private external fun stats(handle: Long): String
    private external fun lastError(handle: Long): String

    private var handle = create(File(activity.filesDir, "native-nes").apply { mkdirs() }.absolutePath)
    private val texture = TextureView(activity).apply { isOpaque = true; visibility = View.INVISIBLE; isFocusable = false }
    private val metrics = TextView(activity).apply { setTextColor(-1); setBackgroundColor(0xbb000000.toInt()); textSize = 12f; visibility = View.INVISIBLE; isFocusable = false }
    private var debug = false
    private val inputs = activity.getSystemService(InputManager::class.java)
    private val audioManager = activity.getSystemService(AudioManager::class.java)
    private val audioFocus = AudioManager.OnAudioFocusChangeListener { change ->
        if (change <= 0) activity.runOnUiThread { if (!closed && playing) { pause(); notifyPause() } }
    }
    @Suppress("DEPRECATION") private fun releaseAudioFocus() { audioManager.abandonAudioFocus(audioFocus) }
    @Suppress("DEPRECATION") private fun acquireAudioFocus() {
        check(audioManager.requestAudioFocus(audioFocus, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { "暂时无法获得音频焦点，请稍后继续游戏" }
    }
    private val players = linkedMapOf<Int, Int>()
    private val signals = arrayOf(mutableSetOf<String>(), mutableSetOf<String>())
    private val digital = arrayOf(mutableSetOf<String>(), mutableSetOf<String>())
    private val injected = IntArray(2)
    private var mappings = Array(2) { mapOf(0 to "b12", 1 to "b13", 2 to "b14", 3 to "b15", 4 to "b1", 5 to "b0", 6 to "b3", 7 to "b2", 8 to "b9", 9 to "b8") }
    private var turboHz = 16.0
    @Volatile private var playing = false
    @Volatile private var closed = false
    private var romHash = ""
    private var surface: Surface? = null
    private var system = "nes"
    private data class ExpectedFile(val size: Long, val hash: String)
    private val arcadeFiles = linkedMapOf<String, ExpectedFile>()
    private val work = File(activity.filesDir, "native-arcade/work").apply { mkdirs() }
    private var primary = ""
    private var statsTime = android.os.SystemClock.elapsedRealtime()
    private var statsFrames = 0L
    private var statsPresented = 0L

    init {
        File(activity.filesDir, "native-nes/arcade").mkdirs()
        root.addView(texture, FrameLayout.LayoutParams(1, 1))
        root.addView(metrics, FrameLayout.LayoutParams(-2, -2))
        texture.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
            override fun onSurfaceTextureAvailable(value: SurfaceTexture, width: Int, height: Int) {
                synchronized(this@NativeEmulator) {
                    if (closed) return
                    surface = Surface(value)
                    setSurface(handle, surface)
                }
            }
            override fun onSurfaceTextureSizeChanged(value: SurfaceTexture, width: Int, height: Int) {}
            override fun onSurfaceTextureUpdated(value: SurfaceTexture) {}
            override fun onSurfaceTextureDestroyed(value: SurfaceTexture): Boolean {
                synchronized(this@NativeEmulator) {
                    if (!closed) {
                        playing = false; releaseInputs()
                        releaseAudioFocus()
                        runCatching { control(handle, "pause", 0.0) }.onFailure { notifyFailure(it.message) }
                        setSurface(handle, null)
                    }
                    surface?.release(); surface = null
                }
                return true
            }
        }
        inputs.registerInputDeviceListener(this, null)
    }
    private fun ui(action: () -> Unit) {
        if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) { action(); return }
        val done = CountDownLatch(1)
        activity.runOnUiThread { try { if (!closed) action() } finally { done.countDown() } }
        check(done.await(3, TimeUnit.SECONDS)) { "原生画面未能及时响应" }
    }
    private fun releaseInputs() {
        for (player in 0..1) { signals[player].clear(); digital[player].clear(); injected[player] = 0; buttons(handle, player, 0); turbo(handle, player, 0, turboHz) }
    }
    fun pause() {
        synchronized(this) {
            if (closed) return
            playing = false; releaseInputs()
            releaseAudioFocus()
            runCatching { control(handle, "pause", 0.0) }.onFailure { notifyFailure(it.message) }
        }
        texture.visibility = View.INVISIBLE
        metrics.visibility = View.INVISIBLE
    }
    fun close() {
        synchronized(this) {
            if (closed) return
            playing = false; closed = true
            releaseAudioFocus()
            destroy(handle); handle = 0
        }
        inputs.unregisterInputDeviceListener(this)
        surface?.release(); surface = null
        root.removeView(texture)
        root.removeView(metrics)
    }
    fun stop() {
        synchronized(this) {
            if (closed) return
            playing = false; releaseInputs()
            releaseAudioFocus()
            runCatching { control(handle, "stop", 0.0) }.onFailure { notifyFailure(it.message) }
        }
        texture.visibility = View.INVISIBLE; metrics.visibility = View.INVISIBLE
    }
    /** Invoked on an HTTP worker, never the UI thread. */
    fun request(method: String, path: String, body: ByteArray): NativeResponse {
        if (path == "/native/app/exit") {
            require(method == "POST" && body.isEmpty()) { "无效的退出请求" }
            activity.runOnUiThread { activity.finish() }
            return json(JSONObject().put("ok", true))
        }
        require(path.matches(Regex("/native/(nes|arcade)/[a-zA-Z0-9_+./-]+"))) { "无效的原生接口" }
        val requestedSystem = path.split('/')[2]
        val route = path.removePrefix("/native/$requestedSystem/")
        require(method in listOf("GET", "POST"))
        require(body.size <= if (route in listOf("load", "restore")) 8 * 1024 * 1024 else if (route.startsWith("upload/")) 256 * 1024 else 16384)
        if (route == "frame" && method == "GET") {
            var bitmap: android.graphics.Bitmap? = null
            ui { bitmap = texture.getBitmap(256, 240) }
            val out = java.io.ByteArrayOutputStream()
            bitmap?.let { try { it.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out) } finally { it.recycle() } }
            return NativeResponse(out.toByteArray(), "image/png")
        }
        // UI tasks must execute outside the session monitor (surface callbacks use it).
        val command = if (route == "command") JSONObject(body.toString(Charsets.UTF_8)) else null
        if (command?.optString("action") == "bounds") {
            val vw = command.getDouble("viewportWidth"); val vh = command.getDouble("viewportHeight")
            require(vw.isFinite() && vh.isFinite() && vw > 0 && vh > 0)
            ui {
                val sx = root.width / vw; val sy = root.height / vh
                texture.layoutParams = FrameLayout.LayoutParams(
                    (command.getDouble("width") * sx).toInt().coerceIn(1, root.width.coerceAtLeast(1)),
                    (command.getDouble("height") * sy).toInt().coerceIn(1, root.height.coerceAtLeast(1))
                ).apply { leftMargin = (command.getDouble("left") * sx).toInt(); topMargin = (command.getDouble("top") * sy).toInt() }
                metrics.layoutParams = FrameLayout.LayoutParams(-2, -2).apply {
                    leftMargin = (command.getDouble("left") * sx).toInt() + 4
                    topMargin = (command.getDouble("top") * sy).toInt() + 4
                }
            }
            return json(JSONObject().put("ok", true))
        }
        val result = synchronized(this) {
            check(!closed) { "游戏会话已关闭" }
            when {
                route == "info" -> { require(method == "GET"); json(JSONObject().put("build", if (requestedSystem == "arcade") ARCADE_BUILD else BUILD)) }
                route == "prepare" && requestedSystem == "arcade" -> {
                    require(method == "POST")
                    playing = false; releaseInputs(); control(handle, "stop", 0.0)
                    val manifest = JSONObject(body.toString(Charsets.UTF_8)); val files = manifest.getJSONArray("files")
                    require(files.length() in 1..16)
                    val expected = linkedMapOf<String, ExpectedFile>()
                    for (i in 0 until files.length()) {
                        val file = files.getJSONObject(i); val name = file.getString("name")
                        require(name.matches(Regex("[a-zA-Z0-9_+-]{1,100}\\.zip")) && name !in expected)
                        val size = file.getLong("size"); val hash = file.getString("hash")
                        require(size in 1..128L * 1024 * 1024 && hash.matches(Regex("[a-f0-9]{64}")))
                        expected[name] = ExpectedFile(size, hash)
                    }
                    require(expected.values.sumOf { it.size } <= 512L * 1024 * 1024)
                    val game = manifest.getString("game"); require(game in expected)
                    for (file in work.listFiles().orEmpty()) check(file.isFile && file.delete()) { "无法清理旧游戏缓存" }
                    arcadeFiles.clear(); arcadeFiles.putAll(expected); primary = game; system = "arcade"
                    json(JSONObject().put("ok", true))
                }
                route.startsWith("upload/") && requestedSystem == "arcade" -> {
                    require(method == "POST")
                    val parts = route.split('/'); require(parts.size == 3)
                    val expected = arcadeFiles[parts[1]] ?: error("未声明的游戏文件")
                    val offset = parts[2].toLong(); val target = File(work, parts[1])
                    require(offset >= 0 && target.length() == offset && offset + body.size <= expected.size && body.isNotEmpty())
                    java.io.FileOutputStream(target, true).use { it.write(body) }
                    json(JSONObject().put("ok", true))
                }
                route == "load" -> {
                    require(method == "POST")
                    playing = false; releaseInputs()
                    system = requestedSystem
                    if (system == "arcade") {
                        require(primary in arcadeFiles)
                        for ((name, expected) in arcadeFiles) {
                            val file = File(work, name); require(file.length() == expected.size)
                            val digest = MessageDigest.getInstance("SHA-256")
                            file.inputStream().use { input -> val chunk = ByteArray(65536); while (true) { val n = input.read(chunk); if (n < 0) break; digest.update(chunk, 0, n) } }
                            require(digest.digest().joinToString("") { "%02x".format(it) } == expected.hash) { "$name 游戏文件校验失败" }
                        }
                        romHash = arcadeFiles.getValue(primary).hash
                        load(handle, ByteArray(0), romHash, true, File(work, primary).absolutePath)
                    } else {
                        require(body.size in 16..8 * 1024 * 1024)
                        romHash = MessageDigest.getInstance("SHA-256").digest(body).joinToString("") { "%02x".format(it) }
                        load(handle, body, romHash, false, "")
                    }
                    statsTime = android.os.SystemClock.elapsedRealtime(); statsFrames = 0; statsPresented = 0
                    json(JSONObject(stats(handle)).put("hash", romHash).put("build", if (system == "arcade") ARCADE_BUILD else BUILD))
                }
                route == "state" -> {
                    require(method == "GET")
                    NativeResponse(save(handle), "application/octet-stream")
                }
                route == "restore" -> {
                    require(method == "POST" && body.size in 1..8 * 1024 * 1024)
                    restore(handle, body); releaseInputs(); json(JSONObject().put("ok", true))
                }
                route == "stats" -> {
                    require(method == "GET")
                    val value = JSONObject(stats(handle))
                    val now = android.os.SystemClock.elapsedRealtime()
                    val elapsed = (now - statsTime).coerceAtLeast(1)
                    val frames = value.optLong("frames"); val presented = value.optLong("presented")
                    value.put("emulationFps", ((frames - statsFrames).coerceAtLeast(0) * 1000.0 / elapsed))
                    value.put("presentationFps", ((presented - statsPresented).coerceAtLeast(0) * 1000.0 / elapsed))
                    if (value.optBoolean("failed")) value.put("error", lastError(handle))
                    statsTime = now; statsFrames = frames; statsPresented = presented
                    activity.runOnUiThread { if (!closed) metrics.text = "Native · %.1f / %.1f FPS · %.1f ms · late %d · audio %d".format(value.optDouble("emulationFps"), value.optDouble("presentationFps"), value.optDouble("runMs"), value.optLong("lateFrames"), value.optLong("audioUnderruns")) }
                    json(value)
                }
                route == "command" -> {
                    require(method == "POST")
                    val value = command!!; val action = value.getString("action")
                    when (action) {
                        "input" -> {
                            val player = value.getInt("player"); require(player in 0..1)
                            injected[player] = value.getInt("mask") and 0xffff; update(player)
                        }
                        "configure" -> {
                            val maps = value.getJSONArray("maps"); require(maps.length() == 2)
                            mappings = Array(2) { player ->
                                val map = maps.getJSONObject(player)
                                (0..if (requestedSystem == "arcade") 15 else 9).associateWith { map.optString(it.toString(), "").also { signal ->
                                    require(signal.isEmpty() || signal.matches(Regex("b([0-9]|[12][0-9]|3[01])|a[0-7][+-]")))
                                } }
                            }
                            turboHz = value.getDouble("turboHz").coerceIn(1.0, 30.0); releaseInputs()
                        }
                        "resume" -> { acquireAudioFocus(); control(handle, "resume", 0.0); playing = true }
                        "pause", "stop" -> { playing = false; releaseInputs(); releaseAudioFocus(); control(handle, action, 0.0) }
                        "debug" -> { debug = value.optDouble("value") != 0.0 }
                        "volume", "speed", "smoothing", "scanlines", "reset" -> {
                            val number = value.optDouble("value", 0.0); require(number.isFinite())
                            control(handle, action, number)
                        }
                        else -> error("未知原生命令")
                    }
                    json(JSONObject().put("ok", true))
                }
                else -> error("未知原生接口")
            }
        }
        if (command?.optString("action") in listOf("resume", "pause", "stop", "debug")) ui {
            texture.visibility = if (playing) View.VISIBLE else View.INVISIBLE
            metrics.visibility = if (playing && debug) View.VISIBLE else View.INVISIBLE
        }
        return result
    }
    private fun json(value: JSONObject) = NativeResponse(value.toString().toByteArray(), "application/json")
    private fun player(device: Int): Int? = players[device] ?: (0..1).firstOrNull { it !in players.values }?.also { players[device] = it }
    private fun update(player: Int) {
        val retro = intArrayOf(4, 5, 6, 7, 8, 0, 8, 0, 3, 2)
        var mask = injected[player]; var turboMask = 0
        val held = signals[player] + digital[player]
        for ((button, signal) in mappings[player]) if (signal in held) {
            if (system == "arcade") mask = mask or (1 shl button)
            else if (button in 6..7) turboMask = turboMask or (1 shl retro[button])
            else mask = mask or (1 shl retro[button])
        }
        for ((bit, signal) in listOf(4 to "a1-", 5 to "a1+", 6 to "a0-", 7 to "a0+")) {
            if (signal in held && signal !in mappings[player].values) mask = mask or (1 shl bit)
        }
        buttons(handle, player, mask); turbo(handle, player, turboMask, turboHz)
    }
    @Synchronized fun key(event: KeyEvent): Boolean {
        if (closed || !playing || (event.source and InputDevice.SOURCE_GAMEPAD != InputDevice.SOURCE_GAMEPAD && event.source and InputDevice.SOURCE_JOYSTICK != InputDevice.SOURCE_JOYSTICK)) return false
        val button = when (event.keyCode) {
            KeyEvent.KEYCODE_BUTTON_A -> 0; KeyEvent.KEYCODE_BUTTON_B -> 1
            KeyEvent.KEYCODE_BUTTON_X -> 2; KeyEvent.KEYCODE_BUTTON_Y -> 3
            KeyEvent.KEYCODE_BUTTON_L1 -> 4; KeyEvent.KEYCODE_BUTTON_R1 -> 5
            KeyEvent.KEYCODE_BUTTON_L2 -> 6; KeyEvent.KEYCODE_BUTTON_R2 -> 7
            KeyEvent.KEYCODE_BUTTON_SELECT -> 8; KeyEvent.KEYCODE_BUTTON_START -> 9
            KeyEvent.KEYCODE_BUTTON_THUMBL -> 10; KeyEvent.KEYCODE_BUTTON_THUMBR -> 11
            KeyEvent.KEYCODE_DPAD_UP -> 12; KeyEvent.KEYCODE_DPAD_DOWN -> 13
            KeyEvent.KEYCODE_DPAD_LEFT -> 14; KeyEvent.KEYCODE_DPAD_RIGHT -> 15
            else -> return false
        }
        val player = player(event.deviceId) ?: return true
        if (event.action == KeyEvent.ACTION_DOWN) digital[player].add("b$button")
        else if (event.action == KeyEvent.ACTION_UP) digital[player].remove("b$button")
        update(player); return true
    }
    @Synchronized fun motion(event: MotionEvent): Boolean {
        if (closed || !playing || event.source and InputDevice.SOURCE_JOYSTICK != InputDevice.SOURCE_JOYSTICK) return false
        val player = player(event.deviceId) ?: return true
        val state = signals[player]
        val axes = intArrayOf(MotionEvent.AXIS_X, MotionEvent.AXIS_Y, MotionEvent.AXIS_Z, MotionEvent.AXIS_RZ, MotionEvent.AXIS_RX, MotionEvent.AXIS_RY, MotionEvent.AXIS_LTRIGGER, MotionEvent.AXIS_RTRIGGER)
        for ((axis, code) in axes.withIndex()) {
            val value = event.getAxisValue(code)
            for (sign in listOf('-', '+')) {
                val signal = "a$axis$sign"
                val threshold = if (signal in state) .35f else .5f
                if (if (sign == '-') value < -threshold else value > threshold) state.add(signal) else state.remove(signal)
            }
        }
        val hx = event.getAxisValue(MotionEvent.AXIS_HAT_X); val hy = event.getAxisValue(MotionEvent.AXIS_HAT_Y)
        for ((button, down) in listOf(12 to (hy < -.5f), 13 to (hy > .5f), 14 to (hx < -.5f), 15 to (hx > .5f))) {
            if (down) state.add("b$button") else state.remove("b$button")
        }
        for ((button, value) in listOf(6 to maxOf(event.getAxisValue(MotionEvent.AXIS_LTRIGGER), event.getAxisValue(MotionEvent.AXIS_BRAKE)), 7 to maxOf(event.getAxisValue(MotionEvent.AXIS_RTRIGGER), event.getAxisValue(MotionEvent.AXIS_GAS)))) {
            if (value > .5f) state.add("b$button") else state.remove("b$button")
        }
        update(player); return true
    }
    override fun onInputDeviceAdded(deviceId: Int) {}
    override fun onInputDeviceChanged(deviceId: Int) {}
    override fun onInputDeviceRemoved(deviceId: Int) {
        if (players.remove(deviceId) != null) { pause(); notifyPause() }
    }
}
