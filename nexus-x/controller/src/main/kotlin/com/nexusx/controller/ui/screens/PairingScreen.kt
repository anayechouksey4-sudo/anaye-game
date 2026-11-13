package com.nexusx.controller.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.QrCode2
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nexusx.controller.ui.LocalVmFactory
import com.nexusx.controller.ui.components.GlassCard
import com.nexusx.controller.ui.components.GradientButton
import com.nexusx.controller.ui.components.NexusHeader
import com.nexusx.controller.ui.components.SectionHeader
import com.nexusx.controller.ui.components.StatusPill
import com.nexusx.controller.ui.theme.NexusColors
import com.nexusx.controller.ui.util.Format
import com.nexusx.controller.ui.util.Qr
import com.nexusx.controller.vm.PairingUiState
import com.nexusx.controller.vm.PairingViewModel
import com.nexusx.core.model.PairingStatus

@Composable
fun PairingScreen() {
    val vm: PairingViewModel = viewModel(factory = LocalVmFactory.current)
    val state by vm.state.collectAsStateWithLifecycle()
    var invite by remember { mutableStateOf<PairingUiState?>(null) }

    Column(Modifier.fillMaxSize().background(NexusColors.Black)) {
        NexusHeader("Secure Pairing", "Mutually authenticated · encrypted · revocable")
        LazyColumn(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                GlassCard(Modifier.fillMaxWidth()) {
                    Text("Your device fingerprint", color = NexusColors.TextMuted, fontSize = 12.sp)
                    Text(state.selfFingerprint.ifBlank { "generating…" }, color = NexusColors.Cyan, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(4.dp))
                    Text("Compare this on both screens to confirm there is no machine-in-the-middle.", color = NexusColors.TextMuted, fontSize = 11.sp)
                }
            }
            item {
                val inv = invite
                GlassCard(Modifier.fillMaxWidth()) {
                    if (inv?.payloadUri == null) {
                        Text("Invite a Companion", color = NexusColors.TextPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                        Spacer(Modifier.height(4.dp))
                        Text(
                            if (state.localIp == null) "Join a Wi-Fi network to generate an invite."
                            else "Generate a single-use QR and short code. The Companion scans it and both of you approve.",
                            color = NexusColors.TextMuted, fontSize = 12.sp,
                        )
                        Spacer(Modifier.height(12.dp))
                        GradientButton("Generate invite", icon = Icons.Filled.QrCode2, enabled = state.localIp != null, modifier = Modifier.fillMaxWidth()) {
                            vm.generateInvite { invite = it }
                        }
                    } else {
                        val img = remember(inv.payloadUri) { Qr.encode(inv.payloadUri!!) }
                        if (img != null) {
                            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                                Image(img, contentDescription = "Pairing QR", modifier = Modifier.fillMaxWidth(0.72f).aspectRatio(1f).clip(RoundedCornerShape(16.dp)))
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                        Text("Short code", color = NexusColors.TextMuted, fontSize = 12.sp)
                        Text(inv.shortCode ?: "", color = NexusColors.TextPrimary, fontSize = 26.sp, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(4.dp))
                        Text("Listening on ${inv.localIp}:${PairingViewModel.LISTEN_PORT}", color = NexusColors.TextMuted, fontSize = 11.sp)
                        TextButton(onClick = { invite = null }) { Text("New invite", color = NexusColors.Cyan) }
                    }
                }
            }
            item { SectionHeader("Paired devices") }
            if (state.paired.isEmpty()) {
                item { GlassCard(Modifier.fillMaxWidth()) { Text("No paired devices yet.", color = NexusColors.TextSecondary, fontSize = 13.sp, modifier = Modifier.padding(8.dp)) } }
            } else {
                items(state.paired, key = { it.deviceId }) { p ->
                    GlassCard(Modifier.fillMaxWidth(), contentPadding = 12) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(p.displayName, color = NexusColors.TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                                Text(p.fingerprint, color = NexusColors.TextMuted, fontSize = 11.sp, maxLines = 1)
                                Text("expires ${Format.dayTime(p.expiresAtEpochMs)}", color = NexusColors.TextMuted, fontSize = 10.sp)
                            }
                            Column(horizontalAlignment = Alignment.End) {
                                val color = if (p.status == PairingStatus.ACTIVE) NexusColors.Mint else NexusColors.TextMuted
                                StatusPill(p.status.name.lowercase(), color)
                                TextButton(onClick = { vm.revoke(p.deviceId) }) { Text("Revoke", color = NexusColors.Rose, fontSize = 12.sp) }
                            }
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(16.dp)) }
        }
    }
}
