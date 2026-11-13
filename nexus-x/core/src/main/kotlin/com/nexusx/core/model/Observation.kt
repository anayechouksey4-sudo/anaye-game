package com.nexusx.core.model

/**
 * A single continuous window during which a device was observed on the network.
 * "Observed" means it answered probes or held a session; it does not prove the device was
 * continuously connected, and the UI states that caveat.
 */
data class ObservationWindow(
    val id: Long = 0,
    val deviceId: String,
    val startEpochMs: Long,
    val endEpochMs: Long,
    /** True if this window was backed by a confirmed NEXUS X session rather than probes. */
    val confirmed: Boolean = false,
) {
    val durationMs: Long get() = (endEpochMs - startEpochMs).coerceAtLeast(0)
}

/** Aggregated observation stats for a device, used by the 10-minute monitor. */
data class ObservationSummary(
    val deviceId: String,
    val totalObservedMs: Long,
    val longestWindowMs: Long,
    val windowCount: Int,
    val firstSeenEpochMs: Long,
    val lastSeenEpochMs: Long,
) {
    companion object {
        /** The milestone the 10-minute monitor highlights. */
        const val TEN_MINUTES_MS: Long = 10 * 60 * 1000
    }

    val reachedTenMinuteMilestone: Boolean get() = longestWindowMs >= TEN_MINUTES_MS
}
