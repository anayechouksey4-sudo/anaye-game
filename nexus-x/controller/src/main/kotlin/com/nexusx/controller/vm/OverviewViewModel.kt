package com.nexusx.controller.vm

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.nexusx.controller.data.DeviceRepository
import com.nexusx.controller.data.PairingRepository
import com.nexusx.core.model.DiscoveredDevice
import com.nexusx.core.model.NetworkInfo
import com.nexusx.core.model.ObservationSummary
import com.nexusx.core.model.PresenceConfidence
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class OverviewUiState(
    val devices: List<DiscoveredDevice> = emptyList(),
    val network: NetworkInfo = NetworkInfo(com.nexusx.core.model.NetworkTransport.UNKNOWN),
    val summaries: Map<String, ObservationSummary> = emptyMap(),
    val scanning: Boolean = false,
    val pairedCount: Int = 0,
) {
    val total: Int get() = devices.size
    val reachable: Int get() = devices.count { it.confidence == PresenceConfidence.REACHABLE || it.confidence == PresenceConfidence.CONFIRMED }
    val atMilestone: Int get() = summaries.values.count { it.reachedTenMinuteMilestone }
}

class OverviewViewModel(
    private val deviceRepository: DeviceRepository,
    pairingRepository: PairingRepository,
) : ViewModel() {

    val state = combine(
        deviceRepository.devices, deviceRepository.networkInfo, deviceRepository.summaries,
        deviceRepository.scanning, pairingRepository.paired,
    ) { devices, net, summaries, scanning, paired ->
        OverviewUiState(devices, net, summaries, scanning, paired.size)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), OverviewUiState())

    fun refresh() = viewModelScope.launch { deviceRepository.scanOnce() }
}
