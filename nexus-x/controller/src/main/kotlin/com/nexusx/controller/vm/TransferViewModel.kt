package com.nexusx.controller.vm

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.nexusx.controller.data.PairingRepository
import com.nexusx.controller.data.TransferRepository
import com.nexusx.core.model.FileTransfer
import com.nexusx.core.model.PairedDevice
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

data class TransferUiState(
    val transfers: List<FileTransfer> = emptyList(),
    val pairedDevices: List<PairedDevice> = emptyList(),
)

class TransferViewModel(
    transferRepository: TransferRepository,
    pairingRepository: PairingRepository,
) : ViewModel() {
    val state = combine(transferRepository.transfers, pairingRepository.paired) { transfers, paired ->
        TransferUiState(transfers, paired)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), TransferUiState())
}
