package com.nexusx.core.crypto

import java.security.MessageDigest

/** SHA-256 fingerprints and short authentication strings for human verification during pairing. */
object Fingerprint {
    fun sha256(data: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(data)

    fun hex(data: ByteArray): String = data.joinToString("") { "%02x".format(it) }

    /** Grouped uppercase hex, e.g. "A1B2 C3D4 ...", for showing a key fingerprint. */
    fun formatFingerprint(publicKey: ByteArray): String {
        val h = hex(sha256(publicKey)).uppercase()
        return h.chunked(4).take(8).joinToString(" ")
    }

    /**
     * Short Authentication String: a 6-digit code both devices derive from the handshake transcript.
     * If the numbers match on both screens, there is no machine-in-the-middle. This binds the two
     * public keys together so neither side can be impersonated.
     */
    fun shortAuthString(initiatorPub: ByteArray, responderPub: ByteArray): String {
        val digest = sha256(initiatorPub + responderPub)
        // Take 4 bytes -> unsigned int -> 6 decimal digits.
        val v = ((digest[0].toLong() and 0xFF) shl 24) or
            ((digest[1].toLong() and 0xFF) shl 16) or
            ((digest[2].toLong() and 0xFF) shl 8) or
            (digest[3].toLong() and 0xFF)
        return (v % 1_000_000).toString().padStart(6, '0')
    }
}
