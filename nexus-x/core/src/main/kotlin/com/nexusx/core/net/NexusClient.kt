package com.nexusx.core.net

import java.net.InetSocketAddress
import java.net.Socket

/** Dials a NEXUS X server on the LAN. */
object NexusClient {
    fun connect(host: String, port: Int, timeoutMs: Int = 5000): Socket {
        val socket = Socket()
        socket.tcpNoDelay = true
        socket.connect(InetSocketAddress(host, port), timeoutMs)
        return socket
    }
}
