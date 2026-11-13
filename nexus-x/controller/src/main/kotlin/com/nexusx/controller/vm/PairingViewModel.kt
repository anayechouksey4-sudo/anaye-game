package com.nexusx.controller.vm

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.nexusx.controller.data.DeviceRepository
import com.nexusx.controller.data.PairingRepository
import com.nexusx.core.model.PairedDevice
import com.nexusx.core.pairing.PairingPayload
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class PairingUiState(
    val paired: List<PairedDevice> = emptyList(),
    val selfFingerprint: String = "",
    val localIp: String? = null,
    val payloadUri: String? = null,
    val shortCode: String? = null,
)

class PairingViewModel(
    private val pairingRepository: PairingRepository,
    private val deviceRepository: DeviceRepository,
) : ViewModel() {

    val state = combine(pairingRepository.paired, deviceRepository.networkInfo) { paired, net ->
        PairingUiState(
            paired = paired,
            selfFingerprint = runCatching { pairingRepository.identityFingerprint() }.getOrDefault(""),
            localIp = net.localIp,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), PairingUiState())

    /** Generates a fresh QR/short-code payload bound to this device's LAN address and listen port. */
    fun generateInvite(onReady: (PairingUiState) -> Unit) {
        val ip = deviceRepository.networkInfo.value.localIp ?: return
        val (payload, code) = pairingRepository.newPairingPayload(ip, LISTEN_PORT)
        onReady(state.value.copy(payloadUri = payload.toUri(), shortCode = code, localIp = ip))
    }

    fun revoke(deviceId: String) = viewModelScope.launch { pairingRepository.revoke(deviceId) }
    fun remove(deviceId: String) = viewModelScope.launch { pairingRepository.remove(deviceId) }

    companion object { const val LISTEN_PORT = 62080 }
}
