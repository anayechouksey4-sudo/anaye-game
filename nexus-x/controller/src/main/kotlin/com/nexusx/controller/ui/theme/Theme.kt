package com.nexusx.controller.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

private val NexusDarkScheme = darkColorScheme(
    primary = NexusColors.Cyan,
    onPrimary = NexusColors.Black,
    secondary = NexusColors.ElectricBlue,
    onSecondary = NexusColors.Black,
    tertiary = NexusColors.Violet,
    background = NexusColors.Black,
    onBackground = NexusColors.TextPrimary,
    surface = NexusColors.Surface,
    onSurface = NexusColors.TextPrimary,
    surfaceVariant = NexusColors.SurfaceElevated,
    onSurfaceVariant = NexusColors.TextSecondary,
    error = NexusColors.Rose,
    outline = NexusColors.Hairline,
)

@Composable
fun NexusTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = NexusDarkScheme, typography = NexusTypography, content = content)
}
