package com.wandergame.gameemulator.tv

import java.io.Closeable
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Fixed loopback origin preserves IndexedDB identity across sessions and APK upgrades. */
class AssetServer(private val openAsset: (String) -> InputStream) : Closeable {
    companion object {
        const val PORT = 17864
        const val ORIGIN = "http://127.0.0.1:$PORT"
    }
    private val listener = ServerSocket(PORT, 16, InetAddress.getByName("127.0.0.1"))
    private val workers = ThreadPoolExecutor(4, 4, 0, TimeUnit.SECONDS, ArrayBlockingQueue(32))
    private val acceptThread = Thread({
        while (!listener.isClosed) {
            val client = try { listener.accept() } catch (_: Exception) { break }
            try { workers.execute { client.use { serve(it) } } }
            catch (_: java.util.concurrent.RejectedExecutionException) { client.close() }
        }
    }, "tv-assets").apply { isDaemon = true; start() }

    private fun serve(client: Socket) {
        try {
            client.soTimeout = 5000
            val input = client.getInputStream()
            fun readLine(): String {
                val bytes = java.io.ByteArrayOutputStream()
                while (bytes.size() < 8192) {
                    val b = input.read()
                    if (b == -1) throw java.io.EOFException()
                    if (b == 10) return bytes.toString("US-ASCII").trimEnd('\r')
                    bytes.write(b)
                }
                throw java.io.IOException("Header too long")
            }
            val request = readLine().split(' ')
            val headers = mutableMapOf<String, String>()
            var ended = false
            repeat(64) {
                if (!ended) {
                    val line = readLine()
                    if (line.isEmpty()) ended = true
                    else {
                        val parts = line.split(':', limit = 2)
                        if (parts.size == 2) headers[parts[0].lowercase()] = parts[1].trim()
                    }
                }
            }
            if (!ended || request.size != 3) { reply(client, 400, "Bad Request"); return }
            if (headers["host"] != "127.0.0.1:$PORT") { reply(client, 403, "Forbidden"); return }
            val method = request[0]
            if (method != "GET" && method != "HEAD") { reply(client, 405, "Method Not Allowed"); return }
            val uri = try { URI(request[1]) } catch (_: Exception) { reply(client, 400, "Bad Request"); return }
            val path = uri.path ?: ""
            if (uri.isAbsolute || !path.startsWith('/') || path.contains('\\') ||
                path.contains('\u0000') || path.split('/').any { it == ".." || it == "." }) {
                reply(client, 403, "Forbidden"); return
            }
            val asset = if (path == "/") "index.html" else path.removePrefix("/")
            val stream = try { openAsset(asset) } catch (_: java.io.IOException) {
                reply(client, 404, "Not Found"); return
            }
            stream.use {
                val mime = when (asset.substringAfterLast('.').lowercase()) {
                    "html" -> "text/html; charset=utf-8"
                    "js", "mjs" -> "text/javascript; charset=utf-8"
                    "css" -> "text/css; charset=utf-8"
                    "json" -> "application/json"
                    "wasm" -> "application/wasm"
                    "png" -> "image/png"
                    "svg" -> "image/svg+xml"
                    "ico" -> "image/x-icon"
                    "woff2" -> "font/woff2"
                    else -> "application/octet-stream"
                }
                val output = client.getOutputStream()
                output.write(("HTTP/1.1 200 OK\r\nContent-Type: $mime\r\n" +
                    "Cache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\n" +
                    "Connection: close\r\n\r\n").toByteArray(Charsets.US_ASCII))
                if (method == "GET") it.copyTo(output)
                output.flush()
            }
        } catch (_: java.io.IOException) {
            // The browser may cancel a fetch when changing emulator documents.
        }
    }

    private fun reply(client: Socket, code: Int, reason: String) {
        client.getOutputStream().write(("HTTP/1.1 $code $reason\r\nContent-Length: 0\r\n" +
            "Connection: close\r\n\r\n").toByteArray(Charsets.US_ASCII))
    }

    override fun close() {
        listener.close()
        workers.shutdownNow()
        acceptThread.join(1000)
    }
}
