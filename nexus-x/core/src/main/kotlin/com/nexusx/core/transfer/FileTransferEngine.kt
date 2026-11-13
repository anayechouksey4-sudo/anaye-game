package com.nexusx.core.transfer

import com.nexusx.core.net.wire.WireMessage
import com.nexusx.core.util.Ids
import java.io.InputStream
import java.io.OutputStream

/**
 * File transfer over the authenticated channel. Split into a [Sender] and [Receiver] that operate on
 * plain streams so the chunking, resume and integrity logic is fully unit-testable; the app layer
 * supplies streams opened from Storage Access Framework URIs (the user explicitly picks every file —
 * there is no silent access to another device's storage).
 *
 * Integrity: the sender advertises the file's SHA-256 in the offer; the receiver recomputes it over
 * the bytes it writes and rejects the file if it does not match. Transfers support resume from a byte
 * offset and can be paused/cancelled by stopping the pump.
 */
object FileTransferEngine {

    fun buildOffer(fileName: String, mimeType: String?, totalBytes: Long, sha256: String): WireMessage.FileOffer =
        WireMessage.FileOffer(Ids.random("tx"), fileName, mimeType, totalBytes, sha256)

    /** Produces chunk messages from [source], invoking [emit] for each, honouring [resumeFromByte]. */
    class Sender(
        private val transferId: String,
        private val chunkSize: Int = ChunkPlan.DEFAULT_CHUNK_SIZE,
    ) {
        /** Skips exactly [count] bytes, honouring InputStream.skip's right to skip fewer per call. */
        private fun skipFully(source: InputStream, count: Long, chunkSize: Int) {
            var remaining = count
            val discard = ByteArray(minOf(count, chunkSize.toLong()).toInt().coerceAtLeast(1))
            while (remaining > 0) {
                val skipped = source.skip(remaining)
                if (skipped > 0) { remaining -= skipped; continue }
                val n = source.read(discard, 0, minOf(remaining, discard.size.toLong()).toInt())
                if (n < 0) error("stream ended before reaching resume offset $count")
                remaining -= n
            }
        }

        /** @return total bytes sent. [shouldContinue] lets the caller pause/cancel between chunks. */
        suspend fun stream(
            source: InputStream,
            totalBytes: Long,
            resumeFromByte: Long,
            emit: suspend (WireMessage) -> Unit,
            onProgress: (sent: Long) -> Unit = {},
            shouldContinue: () -> Boolean = { true },
            finalSha256: String,
        ): Long {
            var offset = resumeFromByte
            if (resumeFromByte > 0) skipFully(source, resumeFromByte, chunkSize)
            val buf = ByteArray(chunkSize)
            while (offset < totalBytes) {
                if (!shouldContinue()) return offset
                val toRead = minOf(chunkSize.toLong(), totalBytes - offset).toInt()
                val read = source.read(buf, 0, toRead)
                if (read <= 0) break
                emit(WireMessage.FileChunk(transferId, offset, buf.copyOf(read)))
                offset += read
                onProgress(offset)
            }
            emit(WireMessage.FileComplete(transferId, finalSha256))
            return offset
        }
    }

    /** Consumes chunk/complete messages and writes [sink], verifying the final hash. */
    class Receiver(
        private val transferId: String,
        private val sink: OutputStream,
        private val expectedSha256: String,
        startOffset: Long = 0,
        /** On resume, a readable stream over the already-received prefix so the running SHA-256 is
         *  primed with those bytes; otherwise verification over a full-file hash can never match. */
        priorBytes: InputStream? = null,
    ) {
        private val hasher = IncrementalSha256()
        var bytesWritten: Long = startOffset; private set
        var verified: Boolean? = null; private set

        init {
            if (startOffset > 0 && priorBytes != null) {
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = priorBytes.read(buf)
                    if (n < 0) break
                    hasher.update(buf, 0, n)
                }
            }
        }

        /** @return true when this message completed the transfer. */
        fun onMessage(message: WireMessage, onProgress: (written: Long) -> Unit = {}): Boolean {
            when (message) {
                is WireMessage.FileChunk -> {
                    if (message.transferId != transferId) return false
                    sink.write(message.data)
                    hasher.update(message.data)
                    bytesWritten += message.data.size
                    onProgress(bytesWritten)
                    return false
                }
                is WireMessage.FileComplete -> {
                    if (message.transferId != transferId) return false
                    sink.flush()
                    val actual = hasher.hexDigest()
                    verified = actual.equals(expectedSha256, ignoreCase = true) &&
                        actual.equals(message.sha256, ignoreCase = true)
                    return true
                }
                else -> return false
            }
        }
    }
}
