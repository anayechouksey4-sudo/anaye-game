package com.nexusx.core

import com.google.common.truth.Truth.assertThat
import com.nexusx.core.discovery.DiscoveryState
import com.nexusx.core.model.DiscoverySource
import com.nexusx.core.model.PresenceConfidence
import org.junit.Test

class DiscoveryStateTest {
    private fun obs(id: String, reachable: Boolean, paired: Boolean = false) =
        DiscoveryState.Observation(id = id, ipAddress = "192.168.1.5", source = DiscoverySource.PING_SWEEP, reachable = reachable, paired = paired)

    @Test fun first_seen_is_preserved_last_seen_advances() {
        val s1 = DiscoveryState.merge(emptyMap(), listOf(obs("a", true)), nowMs = 1000)
        val s2 = DiscoveryState.merge(s1, listOf(obs("a", true)), nowMs = 5000)
        assertThat(s2["a"]!!.firstSeenEpochMs).isEqualTo(1000)
        assertThat(s2["a"]!!.lastSeenEpochMs).isEqualTo(5000)
    }

    @Test fun reachable_is_reachable_confidence_paired_is_confirmed() {
        val s = DiscoveryState.merge(emptyMap(), listOf(obs("a", true), obs("b", false, paired = true)), 1000)
        assertThat(s["a"]!!.confidence).isEqualTo(PresenceConfidence.REACHABLE)
        assertThat(s["b"]!!.confidence).isEqualTo(PresenceConfidence.CONFIRMED)
    }

    @Test fun absent_device_becomes_stale() {
        val s1 = DiscoveryState.merge(emptyMap(), listOf(obs("a", true)), nowMs = 0)
        val s2 = DiscoveryState.merge(s1, emptyList(), nowMs = DiscoveryState.DEFAULT_STALE_AFTER_MS + 1)
        assertThat(s2["a"]!!.confidence).isEqualTo(PresenceConfidence.STALE)
    }
}
