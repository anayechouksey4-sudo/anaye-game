package com.nexusx.core.db.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.nexusx.core.db.entity.DeviceEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface DeviceDao {
    @Query("SELECT * FROM devices ORDER BY lastSeenEpochMs DESC")
    fun observeAll(): Flow<List<DeviceEntity>>

    @Query("SELECT * FROM devices WHERE id = :id")
    suspend fun find(id: String): DeviceEntity?

    @Query("SELECT * FROM devices ORDER BY lastSeenEpochMs DESC")
    suspend fun getAll(): List<DeviceEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(device: DeviceEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(devices: List<DeviceEntity>)

    @Query("SELECT COUNT(*) FROM devices")
    fun count(): Flow<Int>

    @Query("DELETE FROM devices WHERE lastSeenEpochMs < :olderThanMs AND isPaired = 0")
    suspend fun pruneOlderThan(olderThanMs: Long)
}
