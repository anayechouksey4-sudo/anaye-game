package com.nexusx.controller.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.filled.DevicesOther
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import com.nexusx.controller.ui.components.DeviceRow
import com.nexusx.controller.ui.components.GlassCard
import com.nexusx.controller.ui.components.NexusHeader
import com.nexusx.controller.ui.components.SectionHeader
import com.nexusx.controller.ui.components.StatTile
import com.nexusx.controller.ui.theme.NexusColors
import com.nexusx.controller.vm.OverviewViewModel
import com.nexusx.core.model.NetworkTransport

@Composable
fun OverviewScreen(onOpenDevice: (String) -> Unit, onSeeAll: () -> Unit) {
    val vm: OverviewViewModel = viewModel(factory = LocalVmFactory.current)
    val state by vm.state.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxSize().background(NexusColors.Black)) {
        NexusHeader("Network Overview", "Your network. Your control.") {
            IconButton(onClick = { vm.refresh() }) {
                if (state.scanning) CircularProgressIndicator(Modifier.height(20.dp), color = NexusColors.Cyan, strokeWidth = 2.dp)
                else Icon(Icons.Filled.Refresh, "Scan now", tint = NexusColors.Cyan)
            }
        }
        LazyColumn(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { NetworkCard(state.network.transport, state.network.ssid, state.network.localIp, state.network.gatewayIp, state.network.isVpnActive) }
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    StatTile(state.total.toString(), "Discovered", Icons.Filled.DevicesOther, NexusColors.Cyan, Modifier.weight(1f))
                    StatTile(state.reachable.toString(), "Reachable", Icons.Filled.Wifi, NexusColors.Mint, Modifier.weight(1f))
                }
            }
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    StatTile(state.pairedCount.toString(), "Paired", Icons.Filled.Link, NexusColors.Violet, Modifier.weight(1f))
                    StatTile(state.atMilestone.toString(), "10-min+", Icons.Filled.Timer, NexusColors.Amber, Modifier.weight(1f))
                }
            }
            item { SectionHeader("Recent devices", trailing = "See all", modifier = Modifier.padding(top = 4.dp).fillMaxWidth().clickable(onClick = onSeeAll)) }
            if (state.devices.isEmpty()) {
                item { EmptyHint(if (state.scanning) "Scanning your network…" else "No devices observed yet. Pull to scan.") }
            } else {
                items(state.devices.take(6), key = { it.id }) { d ->
                    GlassCard(Modifier.fillMaxWidth(), contentPadding = 6) { DeviceRow(d, onClick = { onOpenDevice(d.id) }) }
                }
            }
            item { Spacer(Modifier.height(16.dp)) }
        }
    }
}

@Composable
private fun NetworkCard(transport: NetworkTransport, ssid: String?, ip: String?, gateway: String?, vpn: Boolean) {
    GlassCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(Icons.Filled.Wifi, null, tint = NexusColors.Cyan)
            Column {
                Text(ssid ?: transport.name.lowercase().replaceFirstChar { it.uppercase() }, color = NexusColors.TextPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    buildString {
                        append(ip ?: "no address")
                        if (gateway != null) append("  ·  gw $gateway")
                        if (vpn) append("  ·  VPN")
                    },
                    color = NexusColors.TextMuted, fontSize = 12.sp,
                )
            }
        }
    }
}

@Composable
private fun EmptyHint(text: String) {
    GlassCard(Modifier.fillMaxWidth()) {
        Text(text, color = NexusColors.TextSecondary, fontSize = 13.sp, modifier = Modifier.padding(8.dp))
    }
}
