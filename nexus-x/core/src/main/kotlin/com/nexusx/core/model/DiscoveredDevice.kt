package com.nexusx.core.model

/**
 * A device observed on the local network. Fields that Android cannot reliably provide are
 * nullable and must render as an explicit "unknown" state in the UI, never as a fabricated value.
 */
data class DiscoveredDevice(
    /** Stable identity: the MAC when known, otherwise the IP. Used as the persistence key. */
    val id: String,
    val ipAddress: String?,
    /** Hardware address. Often null on modern Android for devices other than the gateway. */
    val macAddress: String? = null,
    /** Reverse-DNS / mDNS hostname when resolvable, else null. */
    val hostname: String? = null,
    /** Vendor inferred from the MAC OUI, only when the MAC is known. Never guessed from IP. */
    val vendor: String? = null,
    val source: DiscoverySource,
    val confidence: PresenceConfidence,
    val reachability: Reachability = Reachability.UNKNOWN,
    /** Round-trip latency of the last successful probe, milliseconds, or null. */
    val latencyMs: Long? = null,
    /** Open TCP ports found by a light, consented scan of common service ports. */
    val openPorts: List<Int> = emptyList(),
    val firstSeenEpochMs: Long,
    val lastSeenEpochMs: Long,
    /** True once a NEXUS X secure session has been established with this device. */
    val isPaired: Boolean = false,
) {
    val isGateway: Boolean get() = hostname == "_gateway" || ipAddress?.endsWith(".1") == true

    /** Milliseconds this device has been observed across its first..last window. */
    val observedDurationMs: Long get() = (lastSeenEpochMs - firstSeenEpochMs).coerceAtLeast(0)

    fun displayName(): String =
        hostname?.takeIf { it.isNotBlank() && it != "_gateway" }
            ?: vendor?.let { "$it device" }
            ?: ipAddress
            ?: macAddress
            ?: id
}
