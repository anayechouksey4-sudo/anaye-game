package com.nexusx.core.discovery

import android.content.Context
import com.nexusx.core.model.DiscoveredDevice
import com.nexusx.core.model.DiscoverySource
import com.nexusx.core.util.Clock
import com.nexusx.core.util.Subnet
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

/**
 * Orchestrates the discovery sources into a single, honest device list:
 *  1. Active ping/TCP sweep of the local subnet (REACHABLE presence).
 *  2. ARP/neighbour cache for IP<->MAC and vendor inference (INFERRED presence).
 *  3. mDNS/NSD for self-advertised services, including NEXUS X Companions.
 *
 * Results are folded through [DiscoveryState], which owns the first/last-seen and confidence rules.
 * The scan cadence is deliberately modest to limit battery and radio use.
 */
class NetworkScanner(
    private val context: Context,
    private val networkInfo: NetworkInfoProvider = NetworkInfoProvider(context),
    private val pingSweep: PingSweep = PingSweep(),
    private val clock: Clock = Clock.SYSTEM,
) {
    @Volatile private var state: Map<String, DiscoveredDevice> = emptyMap()

    fun snapshot(): List<DiscoveredDevice> = state.values.sortedByDescending { it.lastSeenEpochMs }

    suspend fun scanOnce(pairedPublicKeys: Set<String> = emptySet()): List<DiscoveredDevice> {
        val now = clock.nowMs()
        val info = networkInfo.current()
        val arp = ArpTableReader.read().associateBy { it.ip }

        val localIp = info.localIp
        val prefix = info.subnetPrefixLength
        val observations = mutableListOf<DiscoveryState.Observation>()

        if (localIp != null && prefix != null && prefix in 16..32) {
            val hosts = Subnet.hostAddresses(localIp, prefix).filter { it != localIp }
            val results = pingSweep.sweep(hosts)
            for (r in results) {
                if (!r.reachable && arp[r.ip]?.mac == null) continue // skip truly silent addresses
                val mac = arp[r.ip]?.mac
                observations += DiscoveryState.Observation(
                    id = mac ?: r.ip,
                    ipAddress = r.ip,
                    macAddress = mac,
                    vendor = OuiVendor.lookup(mac),
                    source = if (r.reachable) DiscoverySource.PING_SWEEP else DiscoverySource.ARP_CACHE,
                    reachable = r.reachable,
                    latencyMs = r.latencyMs,
                    openPorts = r.openPorts,
                )
            }
        }
        // ARP-only entries we did not actively confirm this round still count as inferred presence.
        for ((ip, entry) in arp) {
            if (observations.any { it.ipAddress == ip }) continue
            if (ip == localIp) continue
            observations += DiscoveryState.Observation(
                id = entry.mac ?: ip,
                ipAddress = ip,
                macAddress = entry.mac,
                vendor = OuiVendor.lookup(entry.mac),
                source = DiscoverySource.ARP_CACHE,
                reachable = false,
            )
        }

        state = DiscoveryState.merge(state, observations, now)
        return snapshot()
    }

    /** Repeating scan as a cold Flow. [intervalMs] defaults to a battery-friendly cadence. */
    fun observe(intervalMs: Long = DEFAULT_SCAN_INTERVAL_MS): Flow<List<DiscoveredDevice>> = flow {
        while (true) {
            emit(scanOnce())
            delay(intervalMs)
        }
    }

    companion object { const val DEFAULT_SCAN_INTERVAL_MS: Long = 60_000 }
}
