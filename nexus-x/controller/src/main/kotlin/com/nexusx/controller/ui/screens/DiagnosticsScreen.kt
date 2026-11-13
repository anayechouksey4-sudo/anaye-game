package com.nexusx.controller.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nexusx.controller.ui.LocalVmFactory
import com.nexusx.controller.ui.components.GlassCard
import com.nexusx.controller.ui.components.GradientButton
import com.nexusx.controller.ui.components.NexusHeader
import com.nexusx.controller.ui.theme.NexusColors
import com.nexusx.controller.vm.CheckStatus
import com.nexusx.controller.vm.DiagnosticsViewModel

@Composable
fun DiagnosticsScreen(onBack: () -> Unit) {
    val vm: DiagnosticsViewModel = viewModel(factory = LocalVmFactory.current)
    val state by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.run() }

    Column(Modifier.fillMaxSize().background(NexusColors.Black)) {
        NexusHeader("Diagnostics", "On-device self-tests", onBack = onBack)
        Column(Modifier.padding(horizontal = 16.dp)) {
            GradientButton(
                if (state.running) "Running…" else "Run checks",
                icon = Icons.Filled.PlayArrow, modifier = Modifier.fillMaxWidth(), enabled = !state.running,
            ) { vm.run() }
            Spacer(Modifier.height(12.dp))
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(state.checks) { c ->
                    GlassCard(Modifier.fillMaxWidth(), contentPadding = 12) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            val (icon, tint) = when (c.status) {
                                CheckStatus.PASS -> Icons.Filled.CheckCircle to NexusColors.Mint
                                CheckStatus.FAIL -> Icons.Filled.Error to NexusColors.Rose
                                CheckStatus.INFO -> Icons.Filled.Info to NexusColors.Cyan
                            }
                            Icon(icon, null, tint = tint, modifier = Modifier.size(22.dp))
                            Column(Modifier.weight(1f)) {
                                Text(c.name, color = NexusColors.TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                                Text(c.detail, color = NexusColors.TextMuted, fontSize = 12.sp)
                            }
                        }
                    }
                }
                item {
                    if (state.running) Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.Center) {
                        CircularProgressIndicator(color = NexusColors.Cyan)
                    }
                    Spacer(Modifier.height(16.dp))
                }
            }
        }
    }
}
