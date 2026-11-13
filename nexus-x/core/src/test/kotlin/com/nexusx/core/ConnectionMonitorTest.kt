package com.nexusx.core

import com.google.common.truth.Truth.assertThat
import com.nexusx.core.model.ObservationSummary
import com.nexusx.core.monitor.ConnectionMonitor
import org.junit.Test

class ConnectionMonitorTest {
    @Test fun sightings_within_gap_merge_into_one_window() {
        val m = ConnectionMonitor(mergeGapMs = 90_000)
        var t = 1_000_000L
        repeat(5) { m.recordSighting("dev", t); t += 60_000 } // 5 sightings 60s apart
        val s = m.summary("dev")!!
        assertThat(s.windowCount).isEqualTo(1)
        assertThat(s.longestWindowMs).isEqualTo(4 * 60_000L)
    }

    @Test fun large_gap_opens_new_window() {
        val m = ConnectionMonitor(mergeGapMs = 90_000)
        m.recordSighting("dev", 0)
        m.recordSighting("dev", 60_000)
        m.recordSighting("dev", 60_000 + 10 * 60_000) // 10-min gap > mergeGap
        assertThat(m.summary("dev")!!.windowCount).isEqualTo(2)
    }

    @Test fun ten_minute_milestone_fires_once() {
        val m = ConnectionMonitor(mergeGapMs = 90_000)
        var t = 0L
        val events = mutableListOf<ConnectionMonitor.Event>()
        repeat(12) { events += m.recordSighting("dev", t); t += 60_000 } // 11 minutes continuous
        val milestones = events.filterIsInstance<ConnectionMonitor.Event.MilestoneReached>()
        assertThat(milestones).hasSize(1)
        assertThat(m.devicesAtMilestone()).contains("dev")
        assertThat(m.summary("dev")!!.longestWindowMs).isAtLeast(ObservationSummary.TEN_MINUTES_MS)
    }
}
