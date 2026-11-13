package com.nexusx.controller.vm

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.nexusx.controller.data.PairingRepository
import com.nexusx.controller.data.SessionRepository
import com.nexusx.core.model.ActiveSession
import com.nexusx.core.model.PairedDevice
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

data class RemoteUiState(
    val activeSessions: List<ActiveSession> = emptyList(),
    val pairedDevices: List<PairedDevice> = emptyList(),
)

class RemoteViewModel(
    sessionRepository: SessionRepository,
    pairingRepository: PairingRepository,
) : ViewModel() {
    val state = combine(sessionRepository.active, pairingRepository.paired) { active, paired ->
        RemoteUiState(active, paired.filter { it.grantedCapabilities.any { c -> c.name == "SCREEN_SHARE" } })
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), RemoteUiState())
}
