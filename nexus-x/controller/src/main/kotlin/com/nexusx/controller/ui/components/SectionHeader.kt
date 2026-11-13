package com.nexusx.controller.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.nexusx.controller.ui.theme.NexusColors

@Composable
fun SectionHeader(title: String, trailing: String? = null, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(title, color = NexusColors.TextPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        if (trailing != null) Text(trailing, color = NexusColors.Cyan, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}
