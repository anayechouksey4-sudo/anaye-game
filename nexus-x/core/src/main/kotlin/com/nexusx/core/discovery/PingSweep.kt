package com.nexusx.core.discovery

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket

/**
 * Active reachability sweep of the local subnet. For each candidate host it tries an ICMP echo
 * (InetAddress.isReachable) and, if that is filtered, a quick TCP connect to a few common service
 * ports. Concurrency is bounded so the sweep stays light on battery and does not flood the network.
 *
 * This is ordinary reachability probing of the user's own network — the same thing `ping` and any
 * network scanner does. It performs no exploitation and opens nothing it is not invited to.
 */
class PingSweep(
    private val timeoutMs: Int = 400,
    private val maxConcurrency: Int = 48,
    private val probePorts: List<Int> = listOf(80, 443, 22, 139, 445, 62080),
) {
    data class HostResult(val ip: String, val reachable: Boolean, val latencyMs: Long?, val openPorts: List<Int>)

    suspend fun sweep(hosts: List<String>): List<HostResult> = coroutineScope {
        val gate = Semaphore(maxConcurrency)
        hosts.map { ip ->
            async(Dispatchers.IO) { gate.withPermit { probe(ip) } }
        }.awaitAll()
    }

    suspend fun probe(ip: String): HostResult = withContext(Dispatchers.IO) {
        val start = System.nanoTime()
        val icmp = runCatching { InetAddress.getByName(ip).isReachable(timeoutMs) }.getOrDefault(false)
        if (icmp) {
            val ms = (System.nanoTime() - start) / 1_000_000
            return@withContext HostResult(ip, true, ms, emptyList())
        }
        val open = probePorts.filter { tcpOpen(ip, it) }
        val ms = (System.nanoTime() - start) / 1_000_000
        HostResult(ip, open.isNotEmpty(), if (open.isNotEmpty()) ms else null, open)
    }

    private fun tcpOpen(ip: String, port: Int): Boolean = runCatching {
        Socket().use { s -> s.connect(InetSocketAddress(ip, port), timeoutMs); true }
    }.getOrDefault(false)
}
