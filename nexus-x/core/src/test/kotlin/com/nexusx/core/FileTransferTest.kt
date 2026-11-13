package com.nexusx.core

import com.google.common.truth.Truth.assertThat
import com.nexusx.core.net.wire.WireMessage
import com.nexusx.core.transfer.FileTransferEngine
import com.nexusx.core.transfer.IncrementalSha256
import kotlinx.coroutines.runBlocking
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

class FileTransferTest {
    private val payload = ByteArray(200_000) { (it * 31 % 251).toByte() }
    private val sha = IncrementalSha256.of(payload)

    @Test fun send_receive_roundtrip_verifies_integrity() = runBlocking {
        val sink = ByteArrayOutputStream()
        val receiver = FileTransferEngine.Receiver("tx", sink, expectedSha256 = sha)
        var done = false
        val sender = FileTransferEngine.Sender("tx", chunkSize = 64 * 1024)
        sender.stream(
            source = ByteArrayInputStream(payload),
            totalBytes = payload.size.toLong(),
            resumeFromByte = 0,
            emit = { msg -> done = receiver.onMessage(msg) },
            finalSha256 = sha,
        )
        assertThat(done).isTrue()
        assertThat(receiver.verified).isTrue()
        assertThat(sink.toByteArray()).isEqualTo(payload)
    }

    @Test fun corrupted_chunk_fails_verification() = runBlocking {
        val sink = ByteArrayOutputStream()
        val receiver = FileTransferEngine.Receiver("tx", sink, expectedSha256 = sha)
        val sender = FileTransferEngine.Sender("tx")
        sender.stream(
            source = ByteArrayInputStream(payload),
            totalBytes = payload.size.toLong(),
            resumeFromByte = 0,
            emit = { msg ->
                val tampered = if (msg is WireMessage.FileChunk && msg.offset == 0L) {
                    msg.copy(data = msg.data.copyOf().also { it[0] = (it[0] + 1).toByte() })
                } else msg
                receiver.onMessage(tampered)
            },
            finalSha256 = sha,
        )
        assertThat(receiver.verified).isFalse()
    }

    @Test fun resume_from_offset_sends_remaining_bytes() = runBlocking {
        val resume = 128L * 1024
        var sent = 0L
        val sender = FileTransferEngine.Sender("tx", chunkSize = 64 * 1024)
        val emitted = mutableListOf<WireMessage>()
        sender.stream(
            source = ByteArrayInputStream(payload),
            totalBytes = payload.size.toLong(),
            resumeFromByte = resume,
            emit = { emitted += it },
            onProgress = { sent = it },
            finalSha256 = sha,
        )
        val firstChunk = emitted.filterIsInstance<WireMessage.FileChunk>().first()
        assertThat(firstChunk.offset).isEqualTo(resume)
        assertThat(sent).isEqualTo(payload.size.toLong())
    }

    @Test fun resumed_receive_with_primed_hasher_verifies() = runBlocking {
        val resume = 128L * 1024
        val prefix = payload.copyOfRange(0, resume.toInt())
        val sink = ByteArrayOutputStream()
        val receiver = FileTransferEngine.Receiver(
            "tx", sink, expectedSha256 = sha, startOffset = resume,
            priorBytes = ByteArrayInputStream(prefix),
        )
        val sender = FileTransferEngine.Sender("tx", chunkSize = 64 * 1024)
        sender.stream(
            source = ByteArrayInputStream(payload),
            totalBytes = payload.size.toLong(),
            resumeFromByte = resume,
            emit = { msg -> receiver.onMessage(msg) },
            finalSha256 = sha,
        )
        assertThat(receiver.verified).isTrue()
        assertThat(sink.toByteArray()).isEqualTo(payload.copyOfRange(resume.toInt(), payload.size))
    }

    @Test fun sender_short_skip_resume_sends_correct_bytes() = runBlocking {
        // A stream whose skip() always no-ops, forcing the read-and-discard fallback path.
        val resume = 100_000L
        val noSkip = object : java.io.InputStream() {
            val inner = ByteArrayInputStream(payload)
            override fun read(): Int = inner.read()
            override fun read(b: ByteArray, off: Int, len: Int): Int = inner.read(b, off, len)
            override fun skip(n: Long): Long = 0 // never skips
        }
        val emitted = mutableListOf<WireMessage>()
        FileTransferEngine.Sender("tx", chunkSize = 64 * 1024).stream(
            source = noSkip, totalBytes = payload.size.toLong(), resumeFromByte = resume,
            emit = { emitted += it }, finalSha256 = sha,
        )
        // Reassemble the tail from emitted chunks and compare to the true tail.
        val tail = ByteArrayOutputStream()
        emitted.filterIsInstance<WireMessage.FileChunk>().sortedBy { it.offset }.forEach { tail.write(it.data) }
        assertThat(tail.toByteArray()).isEqualTo(payload.copyOfRange(resume.toInt(), payload.size))
    }
}
