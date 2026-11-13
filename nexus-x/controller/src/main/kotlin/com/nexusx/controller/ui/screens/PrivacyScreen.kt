package com.nexusx.controller.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
import com.nexusx.controller.ui.util.Format
import com.nexusx.controller.vm.PrivacyViewModel
import com.nexusx.core.privacy.InstagramImporter
import com.nexusx.core.privacy.WhatsAppImporter

@Composable
fun PrivacyScreen(onBack: () -> Unit) {
    val vm: PrivacyViewModel = viewModel(factory = LocalVmFactory.current)
    val state by vm.state.collectAsStateWithLifecycle()

    val waPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) vm.importWhatsApp(uri, uri.lastPathSegment ?: "WhatsApp chat")
    }
    val igPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) vm.importInstagram(uri)
    }

    Column(Modifier.fillMaxSize().background(NexusColors.Black)) {
        NexusHeader("Privacy Center", "Your own data, imported and searchable", onBack = onBack)
        Column(Modifier.padding(horizontal = 16.dp)) {
            GlassCard(Modifier.fillMaxWidth()) {
                Text(
                    "Import chat archives you exported yourself. NEXUS X never reads another app's private storage, never bypasses end-to-end encryption, and never accesses anyone else's account.",
                    color = NexusColors.TextMuted, fontSize = 12.sp,
                )
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                GradientButton("WhatsApp .txt", icon = Icons.Filled.FileDownload, modifier = Modifier.weight(1f)) { waPicker.launch(arrayOf("text/plain")) }
                GradientButton("Instagram .json", icon = Icons.Filled.FileDownload, modifier = Modifier.weight(1f)) { igPicker.launch(arrayOf("application/json")) }
            }
            if (state.lastImport != null) {
                Spacer(Modifier.height(8.dp)); Text(state.lastImport!!, color = NexusColors.Mint, fontSize = 12.sp)
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(WhatsAppImporter.SOURCE to "WhatsApp", InstagramImporter.SOURCE to "Instagram").forEach { (src, label) ->
                    FilterChip(
                        selected = state.source == src, onClick = { vm.setSource(src) }, label = { Text(label) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = NexusColors.SurfaceElevated, selectedLabelColor = NexusColors.Cyan,
                            labelColor = NexusColors.TextMuted, containerColor = NexusColors.Surface,
                        ),
                    )
                }
            }
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = state.query, onValueChange = { vm.setQuery(it) },
                placeholder = { Text("Search messages", color = NexusColors.TextMuted) },
                leadingIcon = { Icon(Icons.Filled.Search, null, tint = NexusColors.TextMuted) },
                singleLine = true, modifier = Modifier.fillMaxWidth(),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = NexusColors.Cyan, unfocusedBorderColor = NexusColors.Hairline,
                    focusedTextColor = NexusColors.TextPrimary, unfocusedTextColor = NexusColors.TextPrimary,
                    cursorColor = NexusColors.Cyan,
                ),
            )
            Spacer(Modifier.height(10.dp))
            if (state.messages.isEmpty()) {
                GlassCard(Modifier.fillMaxWidth()) { Text("No messages. Import an export to begin.", color = NexusColors.TextSecondary, fontSize = 13.sp, modifier = Modifier.padding(8.dp)) }
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(state.messages, key = { it.id }) { m ->
                        GlassCard(Modifier.fillMaxWidth(), contentPadding = 12) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(m.sender ?: "System", color = NexusColors.Cyan, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                                Text(Format.dayTime(m.timestampEpochMs), color = NexusColors.TextMuted, fontSize = 10.sp)
                            }
                            Spacer(Modifier.height(2.dp))
                            Text(m.content, color = NexusColors.TextSecondary, fontSize = 13.sp)
                            Text(m.conversation, color = NexusColors.TextMuted, fontSize = 10.sp)
                        }
                    }
                    item { Spacer(Modifier.height(16.dp)) }
                }
            }
        }
    }
}
