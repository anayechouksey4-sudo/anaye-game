package com.nexusx.core.db.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "devices")
data class DeviceEntity(
    @PrimaryKey val id: String,
    val ipAddress: String?,
    val macAddress: String?,
    val hostname: String?,
    val vendor: String?,
    val source: String,
    val confidence: String,
    val reachability: String,
    val latencyMs: Long?,
    val openPorts: List<Int>,
    val firstSeenEpochMs: Long,
    val lastSeenEpochMs: Long,
    val isPaired: Boolean,
)
