package com.nexusx.core.pairing

import java.security.SecureRandom

/**
 * Generation of the single-use pairing token and the short human-readable code shown when a QR scan
 * is not convenient. The short code maps deterministically to the token's leading bytes so the two
 * channels (QR and typed code) authenticate the same handshake.
 */
object PairingCode {
    private val rng = SecureRandom()
    private const val TOKEN_BYTES = 16

    /** 128-bit URL-safe token. */
    fun newToken(): String {
        val b = ByteArray(TOKEN_BYTES).also { rng.nextBytes(it) }
        return b.joinToString("") { "%02x".format(it) }
    }

    /** A grouped 9-digit short code derived from the token, e.g. "482 190 775". */
    fun shortCode(token: String): String {
        var acc = 0L
        for (c in token.take(12)) acc = (acc * 31 + c.code) and 0xFFFFFFFFFFL
        val nine = (acc % 1_000_000_000L).toString().padStart(9, '0')
        return "${nine.substring(0,3)} ${nine.substring(3,6)} ${nine.substring(6,9)}"
    }

    fun shortCodeMatches(token: String, typed: String): Boolean {
        val normalized = typed.filter { it.isDigit() }
        val expected = shortCode(token).filter { it.isDigit() }
        return normalized.isNotEmpty() && normalized == expected
    }
}
