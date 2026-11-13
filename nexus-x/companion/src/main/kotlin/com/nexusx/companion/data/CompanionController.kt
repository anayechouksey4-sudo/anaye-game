package com.nexusx.companion.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Shared, process-wide state bridging the Companion's foreground service (which runs the server,
 * handshake and screen capture) and its UI. Consent decisions flow UI -> service through the
 * registered handlers; status flows service -> UI through the StateFlows. This keeps the app honest:
 * nothing starts without a user tap, and the active-session state is always reflected on screen.
 */
object CompanionController {
    data class PendingPairing(val deviceId: String, val displayName: String, val shortAuthString: String)
    data class ActiveShare(val peerName: String, val startedAtEpochMs: Long)

    private val _serverRunning = MutableStateFlow(false)
    val serverRunning = _serverRunning.asStateFlow()

    private val _listenInfo = MutableStateFlow<String?>(null)
    val listenInfo = _listenInfo.asStateFlow()

    private val _pendingPairing = MutableStateFlow<PendingPairing?>(null)
    val pendingPairing = _pendingPairing.asStateFlow()

    private val _pairedCount = MutableStateFlow(0)
    val pairedCount = _pairedCount.asStateFlow()

    private val _activeShare = MutableStateFlow<ActiveShare?>(null)
    val activeShare = _activeShare.asStateFlow()

    // Handlers registered by the service.
    var onApprovePairing: (() -> Unit)? = null
    var onRejectPairing: (() -> Unit)? = null
    var onStopShare: (() -> Unit)? = null

    fun setServerRunning(running: Boolean, info: String?) { _serverRunning.value = running; _listenInfo.value = info }
    fun setPendingPairing(p: PendingPairing?) { _pendingPairing.value = p }
    fun setPairedCount(n: Int) { _pairedCount.value = n }
    fun setActiveShare(s: ActiveShare?) { _activeShare.value = s }

    fun approvePairing() { onApprovePairing?.invoke() }
    fun rejectPairing() { onRejectPairing?.invoke() }
    fun stopShare() { onStopShare?.invoke() }
}
