package com.nexusx.core.db.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "paired_devices")
data class PairedDeviceEntity(
    @PrimaryKey val deviceId: String,
    val displayName: String,
    val remotePublicKey: String,
    val fingerprint: String,
    val status: String,
    val pairedAtEpochMs: Long,
    val expiresAtEpochMs: Long,
    val lastSeenEpochMs: Long,
    val grantedCapabilities: List<String>,
)
