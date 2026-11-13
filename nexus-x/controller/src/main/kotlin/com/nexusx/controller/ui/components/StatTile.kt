package com.nexusx.controller.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nexusx.controller.ui.theme.NexusColors

/** A compact KPI tile: big number, label, and an accent icon. */
@Composable
fun StatTile(
    value: String,
    label: String,
    icon: ImageVector,
    accent: Color = NexusColors.Cyan,
    modifier: Modifier = Modifier,
) {
    GlassCard(modifier = modifier, contentPadding = 14) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(icon, contentDescription = null, tint = accent, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.height(10.dp))
        Text(value, color = NexusColors.TextPrimary, fontSize = 26.sp, fontWeight = FontWeight.Bold)
        Text(label.uppercase(), color = NexusColors.TextMuted, fontSize = 10.sp, fontWeight = FontWeight.Medium)
    }
}
