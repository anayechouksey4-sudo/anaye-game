package com.nexusx.core.model

/** A live, authenticated connection between two paired devices. */
enum class SessionKind { CONTROL, SCREEN_SHARE, FILE_TRANSFER }
enum class SessionStatus { CONNECTING, ACTIVE, PAUSED, ENDED, FAILED }

data class ActiveSession(
    val sessionId: String,
    val peerDeviceId: String,
    val peerName: String,
    val kind: SessionKind,
    val status: SessionStatus,
    val startedAtEpochMs: Long,
    val endedAtEpochMs: Long? = null,
    /** Bytes exchanged, for the live activity indicator. */
    val bytesIn: Long = 0,
    val bytesOut: Long = 0,
) {
    fun durationMs(nowMs: Long): Long = ((endedAtEpochMs ?: nowMs) - startedAtEpochMs).coerceAtLeast(0)
}
