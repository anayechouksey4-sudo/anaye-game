package com.nexusx.controller.ui.theme

import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

/** NEXUS X palette: true-black AMOLED canvas with electric blue and cyan accents. */
object NexusColors {
    val Black = Color(0xFF000000)
    val Obsidian = Color(0xFF05070D)
    val Surface = Color(0xFF0A0E16)
    val SurfaceElevated = Color(0xFF111726)
    val Hairline = Color(0x1F2A3550)

    val Cyan = Color(0xFF1EE7FF)
    val ElectricBlue = Color(0xFF3B82F6)
    val Violet = Color(0xFF7C5CFF)
    val Mint = Color(0xFF22D3A6)
    val Amber = Color(0xFFFFB020)
    val Rose = Color(0xFFFF5C7A)

    val TextPrimary = Color(0xFFEAF2FF)
    val TextSecondary = Color(0xFF9FB0CC)
    val TextMuted = Color(0xFF5D6B86)

    val GlassTop = Color(0x14FFFFFF)
    val GlassBottom = Color(0x05FFFFFF)

    val accentGradient = Brush.linearGradient(listOf(Cyan, ElectricBlue))
    val violetGradient = Brush.linearGradient(listOf(Violet, ElectricBlue))

    fun glass() = Brush.verticalGradient(listOf(GlassTop, GlassBottom))
}
