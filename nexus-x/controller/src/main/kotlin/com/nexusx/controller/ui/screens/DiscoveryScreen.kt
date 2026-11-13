package com.nexusx.controller.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nexusx.controller.ui.LocalVmFactory
import com.nexusx.controller.ui.components.DeviceRow
import com.nexusx.controller.ui.components.GlassCard
import com.nexusx.controller.ui.components.NexusHeader
import com.nexusx.controller.ui.theme.NexusColors
import com.nexusx.controller.vm.DeviceFilter
import com.nexusx.controller.vm.DiscoveryViewModel

@Composable
fun DiscoveryScreen(onOpenDevice: (String) -> Unit) {
    val vm: DiscoveryViewModel = viewModel(factory = LocalVmFactory.current)
    val state by vm.state.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxSize().background(NexusColors.Black)) {
        NexusHeader("Live Discovery", "${state.devices.size} shown") {
            IconButton(onClick = { vm.refresh() }) {
                if (state.scanning) CircularProgressIndicator(Modifier.height(20.dp), color = NexusColors.Cyan, strokeWidth = 2.dp)
                else Icon(Icons.Filled.Refresh, "Scan now", tint = NexusColors.Cyan)
            }
        }
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            DeviceFilter.entries.forEach { f ->
                FilterChip(
                    selected = state.filter == f,
                    onClick = { vm.setFilter(f) },
                    label = { Text(f.name.lowercase().replaceFirstChar { it.uppercase() }) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = NexusColors.SurfaceElevated,
                        selectedLabelColor = NexusColors.Cyan,
                        labelColor = NexusColors.TextMuted,
                        containerColor = NexusColors.Surface,
                    ),
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        if (state.devices.isEmpty()) {
            GlassCard(Modifier.padding(16.dp).fillMaxWidth()) {
                Text(
                    if (state.scanning) "Scanning…" else "No devices match this filter yet.",
                    color = NexusColors.TextSecondary, fontSize = 13.sp, modifier = Modifier.padding(8.dp),
                )
            }
        } else {
            LazyColumn(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(state.devices, key = { it.id }) { d ->
                    GlassCard(Modifier.fillMaxWidth(), contentPadding = 6) { DeviceRow(d, onClick = { onOpenDevice(d.id) }) }
                }
                item { Spacer(Modifier.height(16.dp)) }
            }
        }
    }
}
