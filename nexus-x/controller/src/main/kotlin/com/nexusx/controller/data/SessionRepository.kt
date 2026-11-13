package com.nexusx.controller.data

import com.nexusx.core.db.dao.SessionDao
import com.nexusx.core.db.entity.SessionLogEntity
import com.nexusx.core.model.ActiveSession
import com.nexusx.core.model.SessionStatus
import com.nexusx.core.util.Clock
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map

/** Tracks live sessions (in memory) and the persisted session history (Module 3). */
class SessionRepository(
    private val sessionDao: SessionDao,
    private val clock: Clock = Clock.SYSTEM,
) {
    private val _active = MutableStateFlow<List<ActiveSession>>(emptyList())
    val active = _active.asStateFlow()

    val history: Flow<List<ActiveSession>> = sessionDao.recent().map { list -> list.map { it.toModel() } }

    fun setActive(sessions: List<ActiveSession>) { _active.value = sessions }

    suspend fun record(session: ActiveSession) {
        sessionDao.upsert(
            SessionLogEntity(
                sessionId = session.sessionId, peerDeviceId = session.peerDeviceId, peerName = session.peerName,
                kind = session.kind.name, status = session.status.name, startedAtEpochMs = session.startedAtEpochMs,
                endedAtEpochMs = session.endedAtEpochMs, bytesIn = session.bytesIn, bytesOut = session.bytesOut,
            )
        )
    }

    suspend fun close(sessionId: String, status: SessionStatus = SessionStatus.ENDED) {
        sessionDao.close(sessionId, status.name, clock.nowMs())
        _active.value = _active.value.filterNot { it.sessionId == sessionId }
    }
}

private fun SessionLogEntity.toModel() = ActiveSession(
    sessionId = sessionId, peerDeviceId = peerDeviceId, peerName = peerName,
    kind = runCatching { com.nexusx.core.model.SessionKind.valueOf(kind) }.getOrDefault(com.nexusx.core.model.SessionKind.CONTROL),
    status = runCatching { SessionStatus.valueOf(status) }.getOrDefault(SessionStatus.ENDED),
    startedAtEpochMs = startedAtEpochMs, endedAtEpochMs = endedAtEpochMs, bytesIn = bytesIn, bytesOut = bytesOut,
)
