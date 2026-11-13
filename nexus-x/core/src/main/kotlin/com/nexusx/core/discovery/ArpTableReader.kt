package com.nexusx.core.discovery

import java.io.File

/**
 * Reads the kernel ARP / neighbour cache to learn IP<->MAC pairs for hosts this device has recently
 * talked to. On older Android `/proc/net/arp` is world-readable; on newer releases it is often
 * restricted, in which case this returns an empty list and discovery falls back to the active sweep.
 * We never present an ARP entry as a confirmed connection — only as INFERRED presence.
 */
object ArpTableReader {
    data class ArpEntry(val ip: String, val mac: String?)

    fun read(file: File = File("/proc/net/arp")): List<ArpEntry> {
        if (!file.canRead()) return emptyList()
        return runCatching {
            file.readLines().drop(1).mapNotNull { line ->
                val cols = line.trim().split(Regex("\\s+"))
                if (cols.size < 4) return@mapNotNull null
                val ip = cols[0]
                val mac = cols[3].takeIf { it != "00:00:00:00:00:00" && it.count { c -> c == ':' } == 5 }
                if (ip.isBlank()) null else ArpEntry(ip, mac)
            }
        }.getOrDefault(emptyList())
    }

    /** Parse helper exposed for tests: takes the textual table and returns entries. */
    fun parse(text: String): List<ArpEntry> =
        text.lineSequence().drop(1).mapNotNull { line ->
            val cols = line.trim().split(Regex("\\s+"))
            if (cols.size < 4) return@mapNotNull null
            val ip = cols[0]
            val mac = cols[3].takeIf { it != "00:00:00:00:00:00" && it.count { c -> c == ':' } == 5 }
            if (ip.isBlank()) null else ArpEntry(ip, mac)
        }.toList()
}
