package com.nexusx.core.db.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.nexusx.core.db.entity.TransferEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface TransferDao {
    @Query("SELECT * FROM transfers ORDER BY updatedAtEpochMs DESC")
    fun observeAll(): Flow<List<TransferEntity>>

    @Query("SELECT * FROM transfers WHERE transferId = :id")
    suspend fun find(id: String): TransferEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(transfer: TransferEntity)

    @Query("UPDATE transfers SET transferredBytes = :bytes, status = :status, updatedAtEpochMs = :updatedAt WHERE transferId = :id")
    suspend fun progress(id: String, bytes: Long, status: String, updatedAt: Long)
}
