package com.nexusx.companion.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nexusx.companion.ui.theme.NexusColors
import com.nexusx.companion.vm.CompanionViewModel

@Composable
fun CompanionHomeScreen() {
    val vm: CompanionViewModel = viewModel()
    val state by vm.state.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxSize().background(NexusColors.Black).padding(20.dp)) {
        Spacer(Modifier.height(24.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(56.dp).clip(RoundedCornerShape(16.dp)).background(NexusColors.violetGradient), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Shield, null, tint = NexusColors.Black, modifier = Modifier.size(30.dp))
            }
            Column {
                Text("NEXUS X Companion", color = NexusColors.TextPrimary, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Text(state.deviceName, color = NexusColors.TextMuted, fontSize = 12.sp)
            }
        }
        Spacer(Modifier.height(20.dp))

        // Active share banner — always visible while sharing, with an immediate stop control.
        state.activeShare?.let { share ->
            Card(border = NexusColors.Rose) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(10.dp).clip(CircleShape).background(NexusColors.Rose))
                    Spacer(Modifier.size(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Screen sharing is ACTIVE", color = NexusColors.Rose, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                        Text("Sharing with ${share.peerName}", color = NexusColors.TextSecondary, fontSize = 12.sp)
                    }
                }
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = { vm.stopShare() }, modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = NexusColors.Rose),
                ) { Icon(Icons.Filled.Stop, null); Spacer(Modifier.size(8.dp)); Text("Stop sharing now", fontWeight = FontWeight.Bold) }
            }
            Spacer(Modifier.height(16.dp))
        }

        // Pending pairing approval — requires an explicit tap, shows the SAS to verify.
        state.pending?.let { p ->
            Card(border = NexusColors.Cyan) {
                Text("Pairing request", color = NexusColors.TextPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                Text("${p.displayName} wants to pair with this device.", color = NexusColors.TextSecondary, fontSize = 13.sp)
                Spacer(Modifier.height(10.dp))
                Text("Verification code", color = NexusColors.TextMuted, fontSize = 11.sp)
                Text(p.shortAuthString, color = NexusColors.Cyan, fontSize = 28.sp, fontWeight = FontWeight.Bold)
                Text("Approve only if this code matches the Controller's screen.", color = NexusColors.TextMuted, fontSize = 11.sp)
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(onClick = { vm.approve() }, modifier = Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = NexusColors.Mint)) {
                        Icon(Icons.Filled.CheckCircle, null, tint = NexusColors.Black); Spacer(Modifier.size(6.dp)); Text("Approve", color = NexusColors.Black, fontWeight = FontWeight.Bold)
                    }
                    OutlinedButton(onClick = { vm.reject() }, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Filled.Close, null, tint = NexusColors.Rose); Spacer(Modifier.size(6.dp)); Text("Reject", color = NexusColors.Rose)
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
        }

        Card(border = NexusColors.Hairline) {
            StatusLine("Service", if (state.serverRunning) "running" else "idle", if (state.serverRunning) NexusColors.Mint else NexusColors.TextMuted)
            state.listenInfo?.let { StatusLine("Listening", it, NexusColors.TextSecondary) }
            StatusLine("Paired controllers", state.pairedCount.toString(), NexusColors.TextSecondary)
        }
        Spacer(Modifier.height(16.dp))
        Card(border = NexusColors.Hairline) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Filled.Verified, null, tint = NexusColors.Mint, modifier = Modifier.size(20.dp))
                Text("You are always in control", color = NexusColors.TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            }
            Spacer(Modifier.height(8.dp))
            Bullet("Nothing is shared until you approve it here.")
            Bullet("Screen sharing always shows Android's own capture prompt first.")
            Bullet("You can stop any session instantly from this screen.")
            Bullet("No root, no accessibility abuse, no hidden access.")
        }
    }
}

@Composable
private fun Card(border: Color, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    androidx.compose.material3.Surface(
        shape = RoundedCornerShape(18.dp), color = NexusColors.Surface,
        border = androidx.compose.foundation.BorderStroke(1.dp, border), modifier = Modifier.fillMaxWidth(),
    ) { Column(Modifier.padding(16.dp), content = content) }
}

@Composable
private fun StatusLine(k: String, v: String, color: Color) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(k, color = NexusColors.TextMuted, fontSize = 13.sp)
        Text(v, color = color, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun Bullet(text: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("•", color = NexusColors.Cyan, fontSize = 13.sp)
        Text(text, color = NexusColors.TextSecondary, fontSize = 12.sp)
    }
}
