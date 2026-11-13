package com.nexusx.controller.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.nexusx.controller.ui.theme.NexusColors

/** A subtle frosted-glass panel used across the dashboard. */
@Composable
fun GlassCard(
    modifier: Modifier = Modifier,
    contentPadding: Int = 16,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(20.dp),
        color = NexusColors.Surface,
        border = BorderStroke(1.dp, NexusColors.Hairline),
        tonalElevation = 0.dp,
    ) {
        Column(
            modifier = Modifier
                .clip(RoundedCornerShape(20.dp))
                .background(NexusColors.glass())
                .padding(contentPadding.dp),
            content = content,
        )
    }
}
