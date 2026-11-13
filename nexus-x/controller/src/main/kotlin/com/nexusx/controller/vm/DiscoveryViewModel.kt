package com.nexusx.controller.vm

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.nexusx.controller.data.DeviceRepository
import com.nexusx.core.model.DiscoveredDevice
import com.nexusx.core.model.PresenceConfidence
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

enum class DeviceFilter { ALL, REACHABLE, PAIRED, INFERRED }

data class DiscoveryUiState(
    val devices: List<DiscoveredDevice> = emptyList(),
    val scanning: Boolean = false,
    val filter: DeviceFilter = DeviceFilter.ALL,
)

class DiscoveryViewModel(private val deviceRepository: DeviceRepository) : ViewModel() {
    private val filter = MutableStateFlow(DeviceFilter.ALL)

    val state = combine(deviceRepository.devices, deviceRepository.scanning, filter) { devices, scanning, f ->
        val filtered = when (f) {
            DeviceFilter.ALL -> devices
            DeviceFilter.REACHABLE -> devices.filter { it.confidence == PresenceConfidence.REACHABLE || it.confidence == PresenceConfidence.CONFIRMED }
            DeviceFilter.PAIRED -> devices.filter { it.isPaired }
            DeviceFilter.INFERRED -> devices.filter { it.confidence == PresenceConfidence.INFERRED }
        }
        DiscoveryUiState(filtered, scanning, f)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), DiscoveryUiState())

    fun setFilter(f: DeviceFilter) { filter.value = f }
    fun refresh() = viewModelScope.launch { deviceRepository.scanOnce() }
}
