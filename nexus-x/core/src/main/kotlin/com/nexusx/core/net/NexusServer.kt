package com.nexusx.core.net

import java.net.ServerSocket
import java.net.Socket

/**
 * A minimal LAN server that listens for incoming NEXUS X connections. Binding to port 0 lets the OS
 * pick a free port, which is then advertised over NSD. The server performs the responder side of the
 * [Handshake] for each accepted socket; the caller supplies identity material and decides, per
 * connection, whether the peer's public key is one it has paired with.
 */
class NexusServer(preferredPort: Int = 0) {
    private val serverSocket = ServerSocket(preferredPort)
    val port: Int get() = serverSocket.localPort

    fun accept(): Socket = serverSocket.accept()

    fun close() { runCatching { serverSocket.close() } }
}
