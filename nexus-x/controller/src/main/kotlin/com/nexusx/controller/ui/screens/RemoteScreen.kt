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
import androidx.compose.material.icons.filled.ScreenShare
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.nexusx.controller.ui.components.StatusPill
import com.nexusx.controller.ui.theme.NexusColors
import com.nexusx.controller.ui.util.Format
import com.nexusx.controller.vm.RemoteViewModel

@Composable
fun RemoteScreen() {
    val vm: RemoteViewModel = viewModel(factory = LocalVmFactory.current)
    val state by vm.state.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxSize().background(NexusColors.Black)) {
        NexusHeader("Remote Assistance", "Only with the other person's consent")
        LazyColumn(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                GlassCard(Modifier.fillMaxWidth()) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Icon(Icons.Filled.Shield, null, tint = NexusColors.Mint)
                        Text("How consent works", color = NexusColors.TextPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }
                    Spacer(Modifier.height(8.dp))
                    Bullet("The Companion device shares its own screen using Android MediaProjection, which always shows the system capture dialog.")
                    Bullet("A persistent notification and on-screen indicator stay visible for the whole session.")
                    Bullet("The Companion can end the session instantly from its own device.")
                    Bullet("NEXUS X never uses accessibility services or any method to bypass Android's capture protections.")
                }
            }
            item { SectionHeader("Active sessions") }
            if (state.activeSessions.isEmpty()) {
                item { GlassCard(Modifier.fillMaxWidth()) { Text("No active sessions.", color = NexusColors.TextSecondary, fontSize = 13.sp, modifier = Modifier.padding(8.dp)) } }
            } else {
                items(state.activeSessions, key = { it.sessionId }) { s ->
                    GlassCard(Modifier.fillMaxWidth(), contentPadding = 12) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(s.peerName, color = NexusColors.TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                                Text("${s.kind.name.lowercase()} · ${Format.duration(s.durationMs(System.currentTimeMillis()))}", color = NexusColors.TextMuted, fontSize = 11.sp)
                            }
                            StatusPill("live", NexusColors.Rose)
                        }
                    }
                }
            }
            item { SectionHeader("Devices that can share") }
            if (state.pairedDevices.isEmpty()) {
                item {
                    GlassCard(Modifier.fillMaxWidth()) {
                        Text("No paired devices have granted screen-share consent yet. Pair a Companion and grant the screen-share capability to request assistance.", color = NexusColors.TextSecondary, fontSize = 13.sp)
                    }
                }
            } else {
                items(state.pairedDevices, key = { it.deviceId }) { p ->
                    GlassCard(Modifier.fillMaxWidth(), contentPadding = 12) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.ScreenShare, null, tint = NexusColors.Cyan)
                            Spacer(Modifier.height(0.dp))
                            Column(Modifier.weight(1f).padding(start = 10.dp)) {
                                Text(p.displayName, color = NexusColors.TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                                Text("screen-share consent granted", color = NexusColors.TextMuted, fontSize = 11.sp)
                            }
                            TextButton(onClick = { /* request handled by the session service on-device */ }) {
                                Text("Request", color = NexusColors.Cyan)
                            }
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(16.dp)) }
        }
    }
}

@Composable
private fun Bullet(text: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("•", color = NexusColors.Cyan, fontSize = 13.sp)
        Text(text, color = NexusColors.TextSecondary, fontSize = 12.sp)
    }
}
