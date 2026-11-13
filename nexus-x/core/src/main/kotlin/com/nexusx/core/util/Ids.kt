package com.nexusx.core.util

import java.security.SecureRandom

/** Random identifiers for sessions and transfers. */
object Ids {
    private val rng = SecureRandom()
    fun random(prefix: String = ""): String {
        val b = ByteArray(9).also { rng.nextBytes(it) }
        val s = b.joinToString("") { "%02x".format(it) }
        return if (prefix.isEmpty()) s else "$prefix-$s"
    }
}
