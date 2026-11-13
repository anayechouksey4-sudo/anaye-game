package com.nexusx.controller.ui.screens

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nexusx.controller.ui.components.GlassCard
import com.nexusx.controller.ui.components.GradientButton
import com.nexusx.controller.ui.components.NexusHeader
import com.nexusx.controller.ui.theme.NexusColors

@Composable
fun PermissionsScreen(onDone: () -> Unit) {
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {}

    Column(Modifier.fillMaxSize().background(NexusColors.Black)) {
        NexusHeader("Permissions", "NEXUS X asks for the minimum it needs")
        Column(Modifier.padding(16.dp)) {
            PermCard(Icons.Filled.Wifi, "Local network", "Discover and reach devices on your Wi-Fi or hotspot. No internet servers are contacted.")
            Spacer(Modifier.height(12.dp))
            PermCard(Icons.Filled.Notifications, "Notifications", "Show a persistent indicator while scanning or sharing is active.")
            Spacer(Modifier.height(12.dp))
            PermCard(Icons.Filled.LocationOn, "Location (optional)", "Only used to display the Wi-Fi network name. Discovery works without it.")
            Spacer(Modifier.height(24.dp))
            GradientButton("Grant permissions", modifier = Modifier.fillMaxWidth()) {
                val perms = buildList {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
                    add(Manifest.permission.ACCESS_FINE_LOCATION)
                }
                launcher.launch(perms.toTypedArray())
            }
            Spacer(Modifier.height(10.dp))
            Text(
                "You can change these any time in Android Settings. NEXUS X never requests root or accessibility permissions.",
                color = NexusColors.TextMuted, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 4.dp),
            )
            Spacer(Modifier.height(16.dp))
            GradientButton("Continue", modifier = Modifier.fillMaxWidth(), onClick = onDone)
        }
    }
}

@Composable
private fun PermCard(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, body: String) {
    GlassCard(Modifier.fillMaxWidth()) {
        androidx.compose.foundation.layout.Row(
            horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(12.dp),
            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
        ) {
            androidx.compose.material3.Icon(icon, null, tint = NexusColors.Cyan, modifier = Modifier.height(24.dp))
            Column {
                Text(title, color = NexusColors.TextPrimary, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                Text(body, color = NexusColors.TextMuted, fontSize = 12.sp)
            }
        }
    }
}
