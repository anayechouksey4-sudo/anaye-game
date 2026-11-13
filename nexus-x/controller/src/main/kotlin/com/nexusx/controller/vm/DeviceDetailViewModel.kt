package com.nexusx.controller.vm

import androidx.lifecycle.ViewModel
import com.nexusx.controller.data.DeviceRepository
import com.nexusx.core.model.DiscoveredDevice
import com.nexusx.core.model.ObservationSummary
import com.nexusx.core.model.ObservationWindow

data class DeviceDetailUiState(
    val device: DiscoveredDevice?,
    val summary: ObservationSummary?,
    val windows: List<ObservationWindow>,
)

class DeviceDetailViewModel(private val deviceRepository: DeviceRepository) : ViewModel() {
    fun load(deviceId: String): DeviceDetailUiState = DeviceDetailUiState(
        device = deviceRepository.deviceById(deviceId),
        summary = deviceRepository.summaryFor(deviceId),
        windows = deviceRepository.windowsFor(deviceId),
    )
}
