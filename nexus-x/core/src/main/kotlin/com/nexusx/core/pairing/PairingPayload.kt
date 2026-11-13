package com.nexusx.core.pairing

import android.net.Uri
import android.util.Base64

/**
 * The data a Controller shows as a QR code (and behind a short code) for a Companion to scan.
 * Encoded as a compact `nexusx://pair` URI so any QR reader surfaces something inspectable, and so
 * our own scanner can validate the scheme before acting.
 *
 * It carries the Controller's reachable address, its identity public key, and a single-use pairing
 * token. Possession of the QR/short code is the first factor; the on-device approval tap and the SAS
 * match are the second and third. The token never grants access on its own.
 */
data class PairingPayload(
    val deviceId: String,
    val displayName: String,
    val host: String,
    val port: Int,
    /** Base64 (URL-safe, no wrap) of the X.509 identity public key. */
    val publicKeyB64: String,
    /** Single-use, time-boxed token echoed back during the handshake. */
    val token: String,
) {
    fun toUri(): String = Uri.Builder()
        .scheme(SCHEME).authority(AUTHORITY)
        .appendQueryParameter("id", deviceId)
        .appendQueryParameter("n", displayName)
        .appendQueryParameter("h", host)
        .appendQueryParameter("p", port.toString())
        .appendQueryParameter("k", publicKeyB64)
        .appendQueryParameter("t", token)
        .build().toString()

    fun encodePublicKey(): ByteArray = Base64.decode(publicKeyB64, B64_FLAGS)

    companion object {
        const val SCHEME = "nexusx"
        const val AUTHORITY = "pair"
        const val B64_FLAGS = Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING

        fun publicKeyToB64(x509: ByteArray): String = Base64.encodeToString(x509, B64_FLAGS)

        fun parse(uri: String): PairingPayload? {
            val u = runCatching { Uri.parse(uri) }.getOrNull() ?: return null
            if (u.scheme != SCHEME || u.authority != AUTHORITY) return null
            val id = u.getQueryParameter("id") ?: return null
            val host = u.getQueryParameter("h") ?: return null
            val port = u.getQueryParameter("p")?.toIntOrNull() ?: return null
            val key = u.getQueryParameter("k") ?: return null
            val token = u.getQueryParameter("t") ?: return null
            val name = u.getQueryParameter("n") ?: id
            return PairingPayload(id, name, host, port, key, token)
        }
    }
}
