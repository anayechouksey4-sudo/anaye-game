package com.nexusx.controller.vm

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.nexusx.controller.di.AppContainer

/** Builds every ViewModel from the shared [AppContainer]. */
class NexusViewModelFactory(private val c: AppContainer) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return when {
            modelClass.isAssignableFrom(OverviewViewModel::class.java) ->
                OverviewViewModel(c.deviceRepository, c.pairingRepository)
            modelClass.isAssignableFrom(DiscoveryViewModel::class.java) ->
                DiscoveryViewModel(c.deviceRepository)
            modelClass.isAssignableFrom(DeviceDetailViewModel::class.java) ->
                DeviceDetailViewModel(c.deviceRepository)
            modelClass.isAssignableFrom(HistoryViewModel::class.java) ->
                HistoryViewModel(c.deviceRepository, c.sessionRepository)
            modelClass.isAssignableFrom(PairingViewModel::class.java) ->
                PairingViewModel(c.pairingRepository, c.deviceRepository)
            modelClass.isAssignableFrom(RemoteViewModel::class.java) ->
                RemoteViewModel(c.sessionRepository, c.pairingRepository)
            modelClass.isAssignableFrom(TransferViewModel::class.java) ->
                TransferViewModel(c.transferRepository, c.pairingRepository)
            modelClass.isAssignableFrom(PrivacyViewModel::class.java) ->
                PrivacyViewModel(c.privacyRepository)
            modelClass.isAssignableFrom(SettingsViewModel::class.java) ->
                SettingsViewModel(c.settings, c.identity, c.pairingRepository, c.deviceRepository)
            modelClass.isAssignableFrom(DiagnosticsViewModel::class.java) ->
                DiagnosticsViewModel(c.deviceRepository, c.keyVault)
            else -> throw IllegalArgumentException("Unknown ViewModel: ${modelClass.name}")
        } as T
    }
}
