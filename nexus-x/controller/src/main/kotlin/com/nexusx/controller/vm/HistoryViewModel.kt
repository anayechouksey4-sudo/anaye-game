package com.nexusx.controller.vm

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.nexusx.controller.data.DeviceRepository
import com.nexusx.controller.data.SessionRepository
import com.nexusx.core.model.ActiveSession
import com.nexusx.core.model.ObservationSummary
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

data class HistoryUiState(
    val sessions: List<ActiveSession> = emptyList(),
    val observed: List<ObservationSummary> = emptyList(),
)

class HistoryViewModel(
    deviceRepository: DeviceRepository,
    sessionRepository: SessionRepository,
) : ViewModel() {
    val state = combine(sessionRepository.history, deviceRepository.summaries) { sessions, summaries ->
        HistoryUiState(sessions, summaries.values.sortedByDescending { it.longestWindowMs })
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), HistoryUiState())
}
