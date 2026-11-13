package com.nexusx.core.transfer

import java.security.MessageDigest

/** Streaming SHA-256 so a receiver can verify integrity without holding the whole file in memory. */
class IncrementalSha256 {
    private val digest = MessageDigest.getInstance("SHA-256")
    fun update(data: ByteArray, offset: Int = 0, len: Int = data.size) = digest.update(data, offset, len)
    fun hexDigest(): String = digest.digest().joinToString("") { "%02x".format(it) }

    companion object {
        fun of(data: ByteArray): String {
            val d = MessageDigest.getInstance("SHA-256").digest(data)
            return d.joinToString("") { "%02x".format(it) }
        }
    }
}
