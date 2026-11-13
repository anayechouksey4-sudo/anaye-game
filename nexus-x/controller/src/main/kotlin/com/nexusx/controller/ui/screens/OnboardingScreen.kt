package com.nexusx.controller.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Radar
import androidx.compose.material.icons.filled.ScreenShare
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nexusx.controller.ui.components.GradientButton
import com.nexusx.controller.ui.theme.NexusColors

@Composable
fun OnboardingScreen(onContinue: () -> Unit) {
    Column(
        Modifier.fillMaxSize().background(NexusColors.Black).padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(48.dp))
        Box(
            Modifier.size(96.dp).clip(RoundedCornerShape(28.dp)).background(NexusColors.violetGradient),
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Filled.Radar, null, tint = NexusColors.Black, modifier = Modifier.size(52.dp)) }
        Spacer(Modifier.height(24.dp))
        Text("NEXUS X", color = NexusColors.TextPrimary, fontSize = 34.sp, fontWeight = FontWeight.Bold)
        Text("Your Network. Your Control.", color = NexusColors.Cyan, fontSize = 15.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.height(10.dp))
        Text(
            "A premium, consent-first monitor for the devices on your own network, with secure pairing and approved remote assistance.",
            color = NexusColors.TextSecondary, fontSize = 14.sp, textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 8.dp),
        )
        Spacer(Modifier.height(34.dp))
        Feature(Icons.Filled.Radar, "Live discovery", "See reachable devices, hostnames and vendors — honestly labelled.")
        Feature(Icons.Filled.History, "10-minute monitor", "Track how long each device has been observed on the network.")
        Feature(Icons.Filled.Lock, "Secure pairing", "Mutually authenticated, encrypted, revocable — approved on both devices.")
        Feature(Icons.Filled.ScreenShare, "Approved assistance", "Screen sharing only with the other person's explicit, visible consent.")
        Spacer(Modifier.weight(1f))
        GradientButton("Get started", modifier = Modifier.fillMaxWidth(), onClick = onContinue)
        Spacer(Modifier.height(12.dp))
    }
}

@Composable
private fun Feature(icon: ImageVector, title: String, body: String) {
    androidx.compose.foundation.layout.Row(
        Modifier.fillMaxWidth().padding(vertical = 9.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(42.dp).clip(CircleShape).background(NexusColors.SurfaceElevated), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = NexusColors.Cyan, modifier = Modifier.size(22.dp))
        }
        Column {
            Text(title, color = NexusColors.TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            Text(body, color = NexusColors.TextMuted, fontSize = 12.sp)
        }
    }
}
