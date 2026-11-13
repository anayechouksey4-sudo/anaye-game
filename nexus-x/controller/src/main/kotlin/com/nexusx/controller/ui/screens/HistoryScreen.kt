package com.nexusx.controller.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nexusx.controller.ui.LocalVmFactory
import com.nexusx.controller.ui.components.GlassCard
import com.nexusx.controller.ui.components.NexusHeader
import com.nexusx.controller.ui.components.SectionHeader
import com.nexusx.controller.ui.components.StatusPill
import com.nexusx.controller.ui.theme.NexusColors
import com.nexusx.controller.ui.util.Format
import com.nexusx.controller.vm.HistoryViewModel
import com.nexusx.core.model.ObservationSummary

@Composable
fun HistoryScreen(onBack: () -> Unit) {
    val vm: HistoryViewModel = viewModel(factory = LocalVmFactory.current)
    val state by vm.state.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxSize().background(NexusColors.Black)) {
        NexusHeader("Connection History", onBack = onBack)
        LazyColumn(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item { SectionHeader("Observed devices") }
            if (state.observed.isEmpty()) {
                item { GlassCard(Modifier.fillMaxWidth()) { Text("No observation history yet.", color = NexusColors.TextSecondary, fontSize = 13.sp, modifier = Modifier.padding(8.dp)) } }
            } else {
                items(state.observed, key = { it.deviceId }) { s -> ObservedRow(s) }
            }
            item { Spacer(Modifier.height(8.dp)); SectionHeader("Session log") }
            if (state.sessions.isEmpty()) {
                item { GlassCard(Modifier.fillMaxWidth()) { Text("No secure sessions recorded yet.", color = NexusColors.TextSecondary, fontSize = 13.sp, modifier = Modifier.padding(8.dp)) } }
            } else {
                items(state.sessions, key = { it.sessionId }) { s ->
                    GlassCard(Modifier.fillMaxWidth(), contentPadding = 12) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Column {
                                Text(s.peerName, color = NexusColors.TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                                Text("${s.kind.name.lowercase()} · ${Format.dayTime(s.startedAtEpochMs)}", color = NexusColors.TextMuted, fontSize = 11.sp)
                            }
                            StatusPill(s.status.name.lowercase(), NexusColors.Cyan)
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(16.dp)) }
        }
    }
}

@Composable
private fun ObservedRow(s: ObservationSummary) {
    GlassCard(Modifier.fillMaxWidth(), contentPadding = 12) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.weight(1f)) {
                Text(s.deviceId, color = NexusColors.TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1)
                Text("first ${Format.relativeTime(s.firstSeenEpochMs)} · ${s.windowCount} window(s)", color = NexusColors.TextMuted, fontSize = 11.sp)
            }
            Column(horizontalAlignment = androidx.compose.ui.Alignment.End) {
                Text(Format.duration(s.longestWindowMs), color = NexusColors.Cyan, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                if (s.longestWindowMs >= ObservationSummary.TEN_MINUTES_MS) StatusPill("10 min+", NexusColors.Amber)
            }
        }
    }
}
