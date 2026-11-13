package com.whilecode.gameemulator.tv

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.FileNotFoundException
import java.net.Socket
import org.junit.Assert.*
import org.junit.Test

class AssetServerTest {
    @Test fun nativeTransfersAreBoundedAndRequireSameOriginCustomHeader() {
        AssetServer { throw FileNotFoundException(it) }.use { server ->
            var calls = 0
            server.nativeHandler = { method, path, body ->
                calls++
                assertEquals("POST", method); assertEquals("/native/nes/load", path)
                NativeReply(body)
            }
            fun request(extra: String, body: ByteArray = byteArrayOf(1, 2, 3), path: String = "/native/nes/load", length: Int = body.size): ByteArray {
                return Socket("127.0.0.1", AssetServer.PORT).use { socket ->
                    socket.soTimeout = 5000
                    val requestHeaders = "POST $path HTTP/1.1\r\nHost: 127.0.0.1:${AssetServer.PORT}\r\nContent-Length: $length\r\n$extra\r\n"
                    socket.getOutputStream().write(requestHeaders.toByteArray() + body)
                    // Rejected uploads may close with unread request bytes, producing
                    // a TCP reset after the response. Honor Content-Length rather
                    // than waiting for EOF after an already complete HTTP response.
                    val input = socket.getInputStream()
                    val headers = ByteArrayOutputStream()
                    while (!headers.toString("US-ASCII").endsWith("\r\n\r\n")) {
                        val next = input.read()
                        check(next >= 0 && headers.size() < 8192) { "Incomplete HTTP response headers" }
                        headers.write(next)
                    }
                    val responseLength = headers.toString("US-ASCII").lineSequence()
                        .first { it.startsWith("Content-Length:", ignoreCase = true) }
                        .substringAfter(':').trim().toInt()
                    val responseBody = input.readNBytes(responseLength)
                    assertEquals(responseLength, responseBody.size)
                    headers.toByteArray() + responseBody
                }
            }
            assertTrue(request("").toString(Charsets.ISO_8859_1).startsWith("HTTP/1.1 403"))
            assertTrue(request("X-GameEmulator-TV: 1\r\nOrigin: https://evil.example\r\n").toString(Charsets.ISO_8859_1).startsWith("HTTP/1.1 403"))
            assertTrue(request("X-GameEmulator-TV: 1\r\n", length = 8 * 1024 * 1024 + 1).toString(Charsets.ISO_8859_1).startsWith("HTTP/1.1 413"))
            assertTrue(request("X-GameEmulator-TV: 1\r\n", path = "/native/nes/command", length = 16385).toString(Charsets.ISO_8859_1).startsWith("HTTP/1.1 413"))
            assertTrue(request("X-GameEmulator-TV: 1\r\n", path = "/native/arcade/upload/game.zip/0", length = 262145).toString(Charsets.ISO_8859_1).startsWith("HTTP/1.1 413"))
            assertEquals(0, calls)
            val body = byteArrayOf(0, 97, -1, 10)
            val result = request("X-GameEmulator-TV: 1\r\nOrigin: ${AssetServer.ORIGIN}\r\n", body)
            assertTrue(result.toString(Charsets.ISO_8859_1).startsWith("HTTP/1.1 200"))
            assertArrayEquals(body, result.takeLast(body.size).toByteArray())
            assertEquals(1, calls)
            assertFalse(result.toString(Charsets.ISO_8859_1).contains("Access-Control-Allow-Origin"))
        }
    }
    private fun NativeReply(bytes: ByteArray) = AssetServer.NativeResponse(bytes, "application/octet-stream")
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
