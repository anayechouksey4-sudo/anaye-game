package com.nexusx.core.db.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.nexusx.core.db.entity.PairedDeviceEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface PairingDao {
    @Query("SELECT * FROM paired_devices ORDER BY lastSeenEpochMs DESC")
    fun observeAll(): Flow<List<PairedDeviceEntity>>

    @Query("SELECT * FROM paired_devices WHERE deviceId = :id")
    suspend fun find(id: String): PairedDeviceEntity?

    @Query("SELECT * FROM paired_devices")
    suspend fun getAll(): List<PairedDeviceEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(device: PairedDeviceEntity)

    @Query("UPDATE paired_devices SET status = :status WHERE deviceId = :id")
    suspend fun setStatus(id: String, status: String)

    @Query("DELETE FROM paired_devices WHERE deviceId = :id")
    suspend fun delete(id: String)
}
