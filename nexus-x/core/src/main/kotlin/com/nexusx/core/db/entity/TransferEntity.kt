package com.nexusx.core.db.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "transfers")
data class TransferEntity(
    @PrimaryKey val transferId: String,
    val peerDeviceId: String,
    val fileName: String,
    val mimeType: String?,
    val totalBytes: Long,
    val transferredBytes: Long,
    val direction: String,
    val status: String,
    val sha256: String?,
    val startedAtEpochMs: Long,
    val updatedAtEpochMs: Long,
    val error: String?,
)
