package com.nexusx.core.db.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.nexusx.core.db.entity.SessionLogEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface SessionDao {
    @Query("SELECT * FROM session_log ORDER BY startedAtEpochMs DESC LIMIT :limit")
    fun recent(limit: Int = 100): Flow<List<SessionLogEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(session: SessionLogEntity)

    @Query("UPDATE session_log SET status = :status, endedAtEpochMs = :endedAtMs WHERE sessionId = :id")
    suspend fun close(id: String, status: String, endedAtMs: Long)
}
