package com.nexusx.core.db.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import com.nexusx.core.db.entity.ObservationWindowEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface ObservationDao {
    @Query("SELECT * FROM observation_windows WHERE deviceId = :deviceId ORDER BY startEpochMs")
    fun observeFor(deviceId: String): Flow<List<ObservationWindowEntity>>

    @Query("SELECT * FROM observation_windows WHERE deviceId = :deviceId ORDER BY startEpochMs")
    suspend fun windowsFor(deviceId: String): List<ObservationWindowEntity>

    @Insert
    suspend fun insert(window: ObservationWindowEntity): Long

    @Query("UPDATE observation_windows SET endEpochMs = :endMs, confirmed = :confirmed WHERE id = :id")
    suspend fun extend(id: Long, endMs: Long, confirmed: Boolean)

    @Query("DELETE FROM observation_windows WHERE deviceId = :deviceId")
    suspend fun deleteForDevice(deviceId: String)

    @androidx.room.Insert
    suspend fun insertAll(windows: List<ObservationWindowEntity>)

    @Query("SELECT * FROM observation_windows ORDER BY startEpochMs DESC")
    fun observeAll(): Flow<List<ObservationWindowEntity>>
}
