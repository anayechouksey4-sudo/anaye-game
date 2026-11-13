package com.nexusx.core.db.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "observation_windows", indices = [Index("deviceId")])
data class ObservationWindowEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val deviceId: String,
    val startEpochMs: Long,
    val endEpochMs: Long,
    val confirmed: Boolean,
)
