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
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.PrivacyTip
import androidx.compose.material.icons.filled.SendToMobile
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nexusx.controller.ui.Routes
import com.nexusx.controller.ui.components.GlassCard
import com.nexusx.controller.ui.components.NexusHeader
import com.nexusx.controller.ui.theme.NexusColors

@Composable
fun MoreScreen(onNavigate: (String) -> Unit) {
    Column(Modifier.fillMaxSize().background(NexusColors.Black)) {
        NexusHeader("More", "System, privacy and diagnostics")
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Item(Icons.Filled.History, "Connection history", "Observed devices and session log", Routes.HISTORY, onNavigate)
            Item(Icons.Filled.SendToMobile, "File transfer", "Send files to paired devices", Routes.TRANSFER, onNavigate)
            Item(Icons.Filled.PrivacyTip, "Privacy center", "Import and search your own data exports", Routes.PRIVACY, onNavigate)
            Item(Icons.Filled.BugReport, "Diagnostics", "Run on-device self-tests", Routes.DIAGNOSTICS, onNavigate)
            Item(Icons.Filled.Settings, "Settings", "Scanning, identity and about", Routes.SETTINGS, onNavigate)
        }
    }
}

@Composable
private fun Item(icon: ImageVector, title: String, body: String, route: String, onNavigate: (String) -> Unit) {
    GlassCard(Modifier.fillMaxWidth().clickable { onNavigate(route) }) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(icon, null, tint = NexusColors.Cyan, modifier = Modifier.size(24.dp))
            Column(Modifier.weight(1f)) {
                Text(title, color = NexusColors.TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                Text(body, color = NexusColors.TextMuted, fontSize = 12.sp)
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = NexusColors.TextMuted)
        }
    }
}
