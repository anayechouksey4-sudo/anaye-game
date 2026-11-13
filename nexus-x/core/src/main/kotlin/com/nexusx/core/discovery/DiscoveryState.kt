package com.nexusx.core.discovery

import com.nexusx.core.model.DiscoveredDevice
import com.nexusx.core.model.DiscoverySource
import com.nexusx.core.model.PresenceConfidence
import com.nexusx.core.model.Reachability

/**
 * A pure reducer that folds raw scan results into the stable device map shown on the dashboard.
 * Kept free of Android and IO so the merge rules (first/last seen, confidence transitions, staleness)
 * can be unit-tested deterministically.
 */
object DiscoveryState {

    /** One observation emitted by a scanner for a single address. */
    data class Observation(
        val id: String,
        val ipAddress: String?,
        val macAddress: String? = null,
        val hostname: String? = null,
        val vendor: String? = null,
        val source: DiscoverySource,
        val reachable: Boolean,
        val latencyMs: Long? = null,
        val openPorts: List<Int> = emptyList(),
        val paired: Boolean = false,
    )

    /**
     * Merge [observations] from one scan at [nowMs] into the [existing] map (keyed by device id).
     * Devices not seen this scan are aged: REACHABLE/INFERRED -> STALE once older than [staleAfterMs].
     */
    fun merge(
        existing: Map<String, DiscoveredDevice>,
        observations: List<Observation>,
        nowMs: Long,
        staleAfterMs: Long = DEFAULT_STALE_AFTER_MS,
    ): Map<String, DiscoveredDevice> {
        val result = LinkedHashMap(existing)
        val seenIds = HashSet<String>()

        for (o in observations) {
            seenIds += o.id
            val prior = result[o.id]
            val confidence = when {
                o.paired -> PresenceConfidence.CONFIRMED
                o.reachable -> PresenceConfidence.REACHABLE
                o.source == DiscoverySource.ARP_CACHE -> PresenceConfidence.INFERRED
                else -> PresenceConfidence.INFERRED
            }
            result[o.id] = DiscoveredDevice(
                id = o.id,
                ipAddress = o.ipAddress ?: prior?.ipAddress,
                macAddress = o.macAddress ?: prior?.macAddress,
                hostname = o.hostname ?: prior?.hostname,
                vendor = o.vendor ?: prior?.vendor,
                source = o.source,
                confidence = confidence,
                reachability = if (o.reachable) Reachability.REACHABLE else Reachability.UNREACHABLE,
                latencyMs = o.latencyMs ?: prior?.latencyMs,
                openPorts = if (o.openPorts.isNotEmpty()) o.openPorts else (prior?.openPorts ?: emptyList()),
                firstSeenEpochMs = prior?.firstSeenEpochMs ?: nowMs,
                lastSeenEpochMs = nowMs,
                isPaired = o.paired || (prior?.isPaired ?: false),
            )
        }

        // Age devices absent from this scan.
        for ((id, dev) in result) {
            if (id in seenIds) continue
            if (dev.confidence == PresenceConfidence.CONFIRMED) continue // confirmed sessions age elsewhere
            if (nowMs - dev.lastSeenEpochMs >= staleAfterMs && dev.confidence != PresenceConfidence.STALE) {
                result[id] = dev.copy(confidence = PresenceConfidence.STALE, reachability = Reachability.UNKNOWN)
            }
        }
        return result
    }

    const val DEFAULT_STALE_AFTER_MS: Long = 3 * 60 * 1000
}
