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
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
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
import com.nexusx.controller.ui.theme.NexusColors
import com.nexusx.controller.vm.SettingsViewModel

@Composable
fun SettingsScreen(onBack: () -> Unit) {
    val vm: SettingsViewModel = viewModel(factory = LocalVmFactory.current)
    val state by vm.state.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxSize().background(NexusColors.Black)) {
        NexusHeader("Settings", onBack = onBack)
        LazyColumn(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { SectionHeader("Scanning") }
            item {
                GlassCard(Modifier.fillMaxWidth()) {
                    ToggleRow("Automatic scanning", "Continuously discover devices", state.autoScan) { vm.setAutoScan(it) }
                    ToggleRow("Show inferred devices", "Include ARP-only, unconfirmed presence", state.showInferred) { vm.setShowInferred(it) }
                    Spacer(Modifier.height(8.dp))
                    Text("Scan interval", color = NexusColors.TextMuted, fontSize = 12.sp)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(30_000L to "30s", 60_000L to "1m", 120_000L to "2m", 300_000L to "5m").forEach { (ms, label) ->
                            val selected = state.scanIntervalMs == ms
                            androidx.compose.material3.FilterChip(
                                selected = selected, onClick = { vm.setInterval(ms) }, label = { Text(label) },
                                colors = androidx.compose.material3.FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = NexusColors.SurfaceElevated, selectedLabelColor = NexusColors.Cyan,
                                    labelColor = NexusColors.TextMuted, containerColor = NexusColors.Surface,
                                ),
                            )
                        }
                    }
                }
            }
            item { SectionHeader("Identity") }
            item {
                GlassCard(Modifier.fillMaxWidth()) {
                    KeyVal2("Device name", state.deviceName)
                    KeyVal2("Device id", state.deviceId)
                    KeyVal2("Key fingerprint", state.fingerprint)
                    Spacer(Modifier.height(6.dp))
                    Text("The identity private key is generated in and never leaves the hardware Keystore.", color = NexusColors.TextMuted, fontSize = 11.sp)
                }
            }
            item { SectionHeader("About") }
            item {
                GlassCard(Modifier.fillMaxWidth()) {
                    Text("NEXUS X Controller 1.0.0", color = NexusColors.TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    Text("Your Network. Your Control.", color = NexusColors.Cyan, fontSize = 12.sp)
                    Spacer(Modifier.height(6.dp))
                    Text("Consent-first, no root, no exploits, no covert access. Minimal permissions, encrypted local storage, fully revocable pairings.", color = NexusColors.TextMuted, fontSize = 11.sp)
                }
            }
            item { Spacer(Modifier.height(16.dp)) }
        }
    }
}

@Composable
private fun ToggleRow(title: String, body: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, color = NexusColors.TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            Text(body, color = NexusColors.TextMuted, fontSize = 11.sp)
        }
        Switch(
            checked = checked, onCheckedChange = onChange,
            colors = SwitchDefaults.colors(checkedThumbColor = NexusColors.Black, checkedTrackColor = NexusColors.Cyan, uncheckedTrackColor = NexusColors.SurfaceElevated),
        )
    }
}

@Composable
private fun KeyVal2(k: String, v: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(k, color = NexusColors.TextMuted, fontSize = 13.sp)
        Text(v, color = NexusColors.TextPrimary, fontSize = 12.sp, fontWeight = FontWeight.Medium, maxLines = 1)
    }
}
