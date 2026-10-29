package com.wandergame.gameemulator.tv

import java.io.ByteArrayInputStream
import java.io.FileNotFoundException
import java.net.Socket
import org.junit.Assert.*
import org.junit.Test

class AssetServerTest {
    @Test fun servesBundledFilesAndRejectsUnsafeRequests() {
        val wasm = byteArrayOf(0, 97, 115, 109, -1)
        val files = mapOf("index.html" to "<html>TV</html>".toByteArray(), "assets/core.wasm" to wasm)
        AssetServer { path -> ByteArrayInputStream(files[path] ?: throw FileNotFoundException(path)) }.use {
            fun request(path: String, method: String = "GET", host: String = "127.0.0.1:${AssetServer.PORT}"): ByteArray {
                return Socket("127.0.0.1", AssetServer.PORT).use { client ->
                    client.soTimeout = 5000
                    client.getOutputStream().write("$method $path HTTP/1.1\r\nHost: $host\r\n\r\n".toByteArray())
                    client.getInputStream().readBytes()
                }
            }
            val index = request("/").toString(Charsets.ISO_8859_1)
            assertTrue(index.startsWith("HTTP/1.1 200"))
            assertTrue(index.endsWith("<html>TV</html>"))
            val binary = request("/assets/core.wasm?v=1")
            assertTrue(binary.toString(Charsets.ISO_8859_1).contains("Content-Type: application/wasm"))
            assertArrayEquals(wasm, binary.takeLast(wasm.size).toByteArray())
            assertTrue(request("/assets/core.wasm", "HEAD").toString(Charsets.ISO_8859_1).endsWith("\r\n\r\n"))
            for (path in listOf("/../bridge/manifest.json", "/%2e%2e/bridge/manifest.json", "/assets%5c..%5csecret", "http://example.com/")) {
                assertTrue(request(path).toString(Charsets.ISO_8859_1).startsWith("HTTP/1.1 403"))
            }
            assertTrue(request("/", host = "evil.example").toString(Charsets.ISO_8859_1).startsWith("HTTP/1.1 403"))
            assertTrue(request("/missing.js").toString(Charsets.ISO_8859_1).startsWith("HTTP/1.1 404"))
            assertTrue(request("/", method = "POST").toString(Charsets.ISO_8859_1).startsWith("HTTP/1.1 405"))
        }
    }
}
