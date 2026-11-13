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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Link
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nexusx.controller.ui.LocalVmFactory
import com.nexusx.controller.ui.components.GlassCard
import com.nexusx.controller.ui.components.GradientButton
import com.nexusx.controller.ui.components.NexusHeader
import com.nexusx.controller.ui.components.SectionHeader
import com.nexusx.controller.ui.components.StatusPill
import com.nexusx.controller.ui.components.confidencePill
import com.nexusx.controller.ui.theme.NexusColors
import com.nexusx.controller.ui.util.Format
import com.nexusx.core.model.ObservationSummary

@Composable
fun DeviceDetailScreen(deviceId: String, onBack: () -> Unit, onPair: () -> Unit) {
    val vm: com.nexusx.controller.vm.DeviceDetailViewModel = viewModel(factory = LocalVmFactory.current)
    val state = remember(deviceId) { vm.load(deviceId) }
    val device = state.device

    Column(Modifier.fillMaxSize().background(NexusColors.Black)) {
        NexusHeader(device?.displayName() ?: "Device", onBack = onBack)
        if (device == null) {
            Text("This device is no longer in the current scan.", color = NexusColors.TextSecondary, modifier = Modifier.padding(16.dp))
            return@Column
        }
        LazyColumn(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                GlassCard(Modifier.fillMaxWidth()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { confidencePill(device.confidence) }
                    Spacer(Modifier.height(10.dp))
                    KeyVal("IP address", device.ipAddress ?: "unknown")
                    KeyVal("MAC address", device.macAddress ?: "unavailable (randomized or off-router)")
                    KeyVal("Hostname", device.hostname ?: "unknown")
                    KeyVal("Vendor", device.vendor ?: "unknown")
                    KeyVal("Source", device.source.name.lowercase().replace('_', ' '))
                    KeyVal("Latency", device.latencyMs?.let { "${it} ms" } ?: "—")
                    KeyVal("Open ports", device.openPorts.takeIf { it.isNotEmpty() }?.joinToString(", ") ?: "none observed")
                }
            }
            item {
                GlassCard(Modifier.fillMaxWidth()) {
                    Text(
                        "Presence is " + device.confidence.name.lowercase() + ". Observation shows the device answered probes during these windows; it does not prove it stayed connected the whole time.",
                        color = NexusColors.TextMuted, fontSize = 12.sp,
                    )
                }
            }
            item { SectionHeader("Observation (Module 2)") }
            item {
                val summary = state.summary
                GlassCard(Modifier.fillMaxWidth()) {
                    if (summary == null) {
                        Text("No observation windows recorded yet.", color = NexusColors.TextSecondary, fontSize = 13.sp)
                    } else {
                        KeyVal("First seen", Format.dayTime(summary.firstSeenEpochMs))
                        KeyVal("Last seen", Format.dayTime(summary.lastSeenEpochMs))
                        KeyVal("Total observed", Format.duration(summary.totalObservedMs))
                        KeyVal("Longest window", Format.duration(summary.longestWindowMs))
                        KeyVal("Windows", summary.windowCount.toString())
                        Spacer(Modifier.height(8.dp))
                        if (summary.longestWindowMs >= ObservationSummary.TEN_MINUTES_MS) {
                            StatusPill("Observed 10 min or more", NexusColors.Amber)
                        } else {
                            StatusPill("Under 10 minutes", NexusColors.TextMuted)
                        }
                    }
                }
            }
            if (state.windows.isNotEmpty()) {
                item { SectionHeader("Window timeline") }
                items(state.windows.reversed()) { w ->
                    GlassCard(Modifier.fillMaxWidth(), contentPadding = 12) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(Format.dayTime(w.startEpochMs), color = NexusColors.TextSecondary, fontSize = 12.sp)
                            Text(Format.duration(w.durationMs), color = NexusColors.Cyan, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
            if (!device.isPaired) {
                item { GradientButton("Pair this device", modifier = Modifier.fillMaxWidth(), icon = Icons.Filled.Link, onClick = onPair) }
            }
            item { Spacer(Modifier.height(16.dp)) }
        }
    }
}

@Composable
private fun KeyVal(k: String, v: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(k, color = NexusColors.TextMuted, fontSize = 13.sp)
        Text(v, color = NexusColors.TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}
