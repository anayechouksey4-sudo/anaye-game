package com.nexusx.controller.vm

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.nexusx.controller.data.DeviceIdentity
import com.nexusx.controller.data.DeviceRepository
import com.nexusx.controller.data.PairingRepository
import com.nexusx.controller.data.SettingsStore
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class SettingsUiState(
    val scanIntervalMs: Long = 60_000,
    val autoScan: Boolean = true,
    val showInferred: Boolean = true,
    val deviceName: String = "",
    val deviceId: String = "",
    val fingerprint: String = "",
)

class SettingsViewModel(
    private val settings: SettingsStore,
    private val identity: DeviceIdentity,
    private val pairingRepository: PairingRepository,
    private val deviceRepository: DeviceRepository,
) : ViewModel() {

    val state = settings.settings.map { s ->
        SettingsUiState(
            scanIntervalMs = s.scanIntervalMs, autoScan = s.autoScan, showInferred = s.showInferredDevices,
            deviceName = identity.name, deviceId = identity.id,
            fingerprint = runCatching { pairingRepository.identityFingerprint() }.getOrDefault("unavailable"),
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), SettingsUiState())

    fun setAutoScan(on: Boolean) = viewModelScope.launch {
        settings.setAutoScan(on)
        deviceRepository.setAutoScan(on, state.value.scanIntervalMs)
    }
    fun setInterval(ms: Long) = viewModelScope.launch {
        settings.setScanInterval(ms)
        deviceRepository.setAutoScan(state.value.autoScan, ms)
    }
    fun setShowInferred(on: Boolean) = viewModelScope.launch { settings.setShowInferred(on) }
    fun rename(name: String) { identity.rename(name) }
}
