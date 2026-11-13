package com.nexusx.core.monitor

import com.nexusx.core.model.ObservationSummary
import com.nexusx.core.model.ObservationWindow

/**
 * Module 2 — the ten-minute connection monitor, as pure, testable logic.
 *
 * It groups per-device "sightings" (a device answered a probe, or a session carried traffic) into
 * continuous observation windows. Two sightings join the same window when the gap between them is at
 * most [mergeGapMs]; a larger gap starts a new window. A device is highlighted once any single window
 * reaches ten minutes.
 *
 * Important honesty constraint baked into the model: a window means "observed", not "provably
 * connected the whole time". The merge gap is why — we interpolate across small gaps between scans,
 * and the UI states this. The monitor has no capability to reach into a device; it only measures
 * presence.
 */
class ConnectionMonitor(
    private val mergeGapMs: Long = DEFAULT_MERGE_GAP_MS,
) {
    private val windows = LinkedHashMap<String, MutableList<ObservationWindow>>()
    private val milestoneReached = HashSet<String>()

    sealed interface Event {
        data class WindowOpened(val deviceId: String, val startMs: Long) : Event
        data class WindowExtended(val deviceId: String, val durationMs: Long) : Event
        data class MilestoneReached(val deviceId: String, val windowDurationMs: Long) : Event
    }

    /** Record that [deviceId] was observed at [nowMs]. Returns events produced by this sighting. */
    fun recordSighting(deviceId: String, nowMs: Long, confirmed: Boolean = false): List<Event> {
        val list = windows.getOrPut(deviceId) { mutableListOf() }
        val events = mutableListOf<Event>()
        val last = list.lastOrNull()
        if (last != null && nowMs - last.endEpochMs <= mergeGapMs && nowMs >= last.startEpochMs) {
            val merged = last.copy(
                endEpochMs = maxOf(last.endEpochMs, nowMs),
                confirmed = last.confirmed || confirmed,
            )
            list[list.lastIndex] = merged
            events += Event.WindowExtended(deviceId, merged.durationMs)
        } else {
            list += ObservationWindow(deviceId = deviceId, startEpochMs = nowMs, endEpochMs = nowMs, confirmed = confirmed)
            events += Event.WindowOpened(deviceId, nowMs)
        }
        val longest = list.maxOf { it.durationMs }
        if (longest >= ObservationSummary.TEN_MINUTES_MS && milestoneReached.add(deviceId)) {
            events += Event.MilestoneReached(deviceId, longest)
        }
        return events
    }

    /** Seed the monitor from persisted windows (e.g. on app start). */
    fun loadWindows(deviceId: String, persisted: List<ObservationWindow>) {
        windows[deviceId] = persisted.sortedBy { it.startEpochMs }.toMutableList()
        if (persisted.any { it.durationMs >= ObservationSummary.TEN_MINUTES_MS }) milestoneReached.add(deviceId)
    }

    fun windowsFor(deviceId: String): List<ObservationWindow> = windows[deviceId]?.toList() ?: emptyList()

    fun summary(deviceId: String): ObservationSummary? {
        val list = windows[deviceId]?.takeIf { it.isNotEmpty() } ?: return null
        return ObservationSummary(
            deviceId = deviceId,
            totalObservedMs = list.sumOf { it.durationMs },
            longestWindowMs = list.maxOf { it.durationMs },
            windowCount = list.size,
            firstSeenEpochMs = list.minOf { it.startEpochMs },
            lastSeenEpochMs = list.maxOf { it.endEpochMs },
        )
    }

    fun allSummaries(): List<ObservationSummary> = windows.keys.mapNotNull { summary(it) }

    fun devicesAtMilestone(): Set<String> = milestoneReached.toSet()

    companion object {
        /** Default: ~1.5× a 60s scan cadence, so one missed scan does not split a window. */
        const val DEFAULT_MERGE_GAP_MS: Long = 90_000
    }
}
