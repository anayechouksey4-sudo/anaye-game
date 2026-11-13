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
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import com.nexusx.controller.ui.components.SectionHeader
import com.nexusx.controller.ui.components.StatusPill
import com.nexusx.controller.ui.theme.NexusColors
import com.nexusx.controller.ui.util.Format
import com.nexusx.controller.vm.TransferViewModel

@Composable
fun TransferScreen(onBack: () -> Unit) {
    val vm: TransferViewModel = viewModel(factory = LocalVmFactory.current)
    val state by vm.state.collectAsStateWithLifecycle()
    var picked by remember { mutableStateOf<String?>(null) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        picked = uri?.lastPathSegment
    }

    Column(Modifier.fillMaxSize().background(NexusColors.Black)) {
        NexusHeader("File Transfer", "Secure, integrity-checked, between paired devices", onBack = onBack)
        LazyColumn(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                GlassCard(Modifier.fillMaxWidth()) {
                    Text("Send a file", color = NexusColors.TextPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(4.dp))
                    Text("Files are chosen by you through the system picker, chunked, encrypted end-to-end, and verified with SHA-256 on arrival.", color = NexusColors.TextMuted, fontSize = 12.sp)
                    Spacer(Modifier.height(12.dp))
                    GradientButton("Choose file", icon = Icons.Filled.UploadFile, modifier = Modifier.fillMaxWidth()) {
                        picker.launch(arrayOf("*/*"))
                    }
                    if (picked != null) {
                        Spacer(Modifier.height(8.dp))
                        Text("Selected: $picked", color = NexusColors.Cyan, fontSize = 12.sp)
                        Text(
                            if (state.pairedDevices.isEmpty()) "Pair a device to send it."
                            else "Open a session with a paired device to send it.",
                            color = NexusColors.TextMuted, fontSize = 11.sp,
                        )
                    }
                }
            }
            item { SectionHeader("Transfers") }
            if (state.transfers.isEmpty()) {
                item { GlassCard(Modifier.fillMaxWidth()) { Text("No transfers yet.", color = NexusColors.TextSecondary, fontSize = 13.sp, modifier = Modifier.padding(8.dp)) } }
            } else {
                items(state.transfers, key = { it.transferId }) { t ->
                    GlassCard(Modifier.fillMaxWidth(), contentPadding = 12) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(t.fileName, color = NexusColors.TextPrimary, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                            StatusPill(t.status.name.lowercase(), NexusColors.Cyan)
                        }
                        Spacer(Modifier.height(8.dp))
                        LinearProgressIndicator(progress = { t.progress }, modifier = Modifier.fillMaxWidth(), color = NexusColors.Cyan, trackColor = NexusColors.SurfaceElevated)
                        Spacer(Modifier.height(4.dp))
                        Text("${Format.bytes(t.transferredBytes)} / ${Format.bytes(t.totalBytes)} · ${t.direction.name.lowercase()}", color = NexusColors.TextMuted, fontSize = 11.sp)
                    }
                }
            }
            item { Spacer(Modifier.height(16.dp)) }
        }
    }
}
