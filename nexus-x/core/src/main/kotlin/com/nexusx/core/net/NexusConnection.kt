package com.nexusx.core.net

import com.nexusx.core.crypto.SecureChannel
import com.nexusx.core.net.wire.Frame
import com.nexusx.core.net.wire.WireMessage
import java.io.Closeable
import java.io.InputStream
import java.io.OutputStream

/**
 * A live, encrypted application connection: every [WireMessage] is encoded, sealed by the
 * [SecureChannel], and length-prefixed on the wire. Read/write are each single-threaded by contract
 * (one reader coroutine, one writer); the SecureChannel's sequence counters enforce ordering.
 */
class NexusConnection(
    private val input: InputStream,
    private val output: OutputStream,
    private val channel: SecureChannel,
    val peerId: String,
    val peerName: String,
    private val onClose: () -> Unit = {},
) : Closeable {

    @Volatile private var closed = false
    val isClosed: Boolean get() = closed

    @Synchronized
    fun send(message: WireMessage) {
        check(!closed) { "connection closed" }
        val sealed = channel.encrypt(WireMessage.encode(message))
        Frame.write(output, sealed)
    }

    /** Blocks for the next message, or returns null when the peer closes the stream cleanly. */
    fun receive(): WireMessage? {
        if (closed) return null
        val frame = Frame.read(input) ?: return null
        val plain = channel.decrypt(frame)
        return WireMessage.decode(plain)
    }

    override fun close() {
        if (closed) return
        closed = true
        runCatching { input.close() }
        runCatching { output.close() }
        runCatching { onClose() }
    }
}
