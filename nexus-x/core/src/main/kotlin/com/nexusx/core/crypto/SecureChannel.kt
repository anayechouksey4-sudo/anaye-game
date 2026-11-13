package com.nexusx.core.crypto

import java.util.concurrent.atomic.AtomicLong

/**
 * A duplex authenticated channel over a pair of AES-256-GCM keys produced by [KeyExchange].
 *
 * Each direction uses a 64-bit monotonic sequence counter as the GCM nonce (zero-padded to 12
 * bytes), guaranteeing nonce uniqueness without random generation. The sequence number is also
 * authenticated as associated data, so a reordered or replayed frame fails to decrypt. The receiver
 * rejects any frame whose sequence is not the next expected value.
 *
 * This class is transport-agnostic and fully unit-testable; [com.nexusx.core.net] wraps it around a
 * TLS socket. `sendKey`/`recvKey` are swapped on the two peers so each direction is independent.
 */
class SecureChannel(
    private val sendKey: ByteArray,
    private val recvKey: ByteArray,
    private val sessionId: ByteArray,
) {
    private val sendSeq = AtomicLong(0)
    private var recvSeq = 0L

    init {
        require(sendKey.size == 32 && recvKey.size == 32) { "channel keys must be 32 bytes" }
    }

    fun encrypt(plaintext: ByteArray): ByteArray {
        val seq = sendSeq.getAndIncrement()
        val nonce = nonceOf(seq)
        val aad = sessionId + longToBytes(seq)
        return longToBytes(seq) + CryptoBox.sealWithNonce(sendKey, nonce, plaintext, aad)
    }

    /** Decrypts a frame, enforcing in-order delivery. Throws on tampering or replay. */
    fun decrypt(frame: ByteArray): ByteArray {
        require(frame.size > 8) { "frame too short" }
        val seq = bytesToLong(frame, 0)
        check(seq == recvSeq) { "unexpected sequence $seq (expected $recvSeq): replay or reorder" }
        val nonce = nonceOf(seq)
        val aad = sessionId + longToBytes(seq)
        val ct = frame.copyOfRange(8, frame.size)
        val pt = CryptoBox.openWithNonce(recvKey, nonce, ct, aad)
        recvSeq++
        return pt
    }

    private fun nonceOf(seq: Long): ByteArray {
        val nonce = ByteArray(CryptoBox.NONCE_LEN)
        val s = longToBytes(seq)
        System.arraycopy(s, 0, nonce, CryptoBox.NONCE_LEN - 8, 8)
        return nonce
    }

    companion object {
        fun longToBytes(v: Long): ByteArray = ByteArray(8) { i -> (v ushr (56 - i * 8)).toByte() }
        fun bytesToLong(b: ByteArray, off: Int): Long {
            var v = 0L
            for (i in 0 until 8) v = (v shl 8) or (b[off + i].toLong() and 0xFF)
            return v
        }
    }
}
