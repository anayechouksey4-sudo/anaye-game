package com.nexusx.core.util

/**
 * IPv4 subnet arithmetic used by the ping-sweep scanner to enumerate candidate host addresses.
 * Deliberately conservative: it refuses to enumerate anything larger than a /16 so a misconfigured
 * prefix cannot trigger an enormous scan.
 */
object Subnet {
    private const val MAX_HOSTS = 65_534

    fun ipToInt(ip: String): Int {
        val parts = ip.split(".")
        require(parts.size == 4) { "not an IPv4 address: $ip" }
        var v = 0
        for (p in parts) {
            val b = p.toInt()
            require(b in 0..255) { "bad octet in $ip" }
            v = (v shl 8) or b
        }
        return v
    }

    fun intToIp(v: Int): String =
        "${(v ushr 24) and 0xFF}.${(v ushr 16) and 0xFF}.${(v ushr 8) and 0xFF}.${v and 0xFF}"

    fun hostCount(prefixLength: Int): Int {
        require(prefixLength in 0..32) { "bad prefix $prefixLength" }
        val hostBits = 32 - prefixLength
        val total = (1L shl hostBits) - 2 // minus network + broadcast
        return total.coerceIn(0, MAX_HOSTS.toLong()).toInt()
    }

    /** Usable host addresses in the subnet containing [localIp] with [prefixLength]. */
    fun hostAddresses(localIp: String, prefixLength: Int): List<String> {
        require(prefixLength in 16..32) { "refusing to enumerate a subnet wider than /16" }
        val ipInt = ipToInt(localIp)
        val mask = if (prefixLength == 0) 0 else (-1 shl (32 - prefixLength))
        val network = ipInt and mask
        val broadcast = network or mask.inv()
        val hosts = ArrayList<String>()
        var a = network + 1
        while (a < broadcast && hosts.size < MAX_HOSTS) {
            hosts += intToIp(a)
            a++
        }
        return hosts
    }
}
