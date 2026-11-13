package com.nexusx.companion.vm

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.nexusx.companion.NexusCompanionApp
import com.nexusx.companion.data.CompanionController
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

data class CompanionUiState(
    val serverRunning: Boolean = false,
    val listenInfo: String? = null,
    val pairedCount: Int = 0,
    val pending: CompanionController.PendingPairing? = null,
    val activeShare: CompanionController.ActiveShare? = null,
    val deviceName: String = "",
)

class CompanionViewModel(app: Application) : AndroidViewModel(app) {
    private val application = app as NexusCompanionApp

    val state = combine(
        CompanionController.serverRunning,
        CompanionController.listenInfo,
        CompanionController.pendingPairing,
        CompanionController.activeShare,
        application.database.pairingDao().observeAll(),
    ) { running, info, pending, active, paired ->
        CompanionUiState(
            serverRunning = running, listenInfo = info, pairedCount = paired.size,
            pending = pending, activeShare = active, deviceName = application.identity.name,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), CompanionUiState(deviceName = application.identity.name))

    fun approve() = CompanionController.approvePairing()
    fun reject() = CompanionController.rejectPairing()
    fun stopShare() = CompanionController.stopShare()
}
