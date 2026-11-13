package com.nexusx.core.db.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "session_log")
data class SessionLogEntity(
    @PrimaryKey val sessionId: String,
    val peerDeviceId: String,
    val peerName: String,
    val kind: String,
    val status: String,
    val startedAtEpochMs: Long,
    val endedAtEpochMs: Long?,
    val bytesIn: Long,
    val bytesOut: Long,
)
