package com.nexusx.core.db.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import com.nexusx.core.db.entity.PrivacyMessageEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface PrivacyDao {
    @Insert
    suspend fun insertAll(messages: List<PrivacyMessageEntity>)

    @Query("SELECT * FROM privacy_messages WHERE source = :source ORDER BY timestampEpochMs DESC LIMIT :limit")
    fun observeBySource(source: String, limit: Int = 500): Flow<List<PrivacyMessageEntity>>

    @Query("SELECT * FROM privacy_messages WHERE content LIKE '%' || :query || '%' ORDER BY timestampEpochMs DESC LIMIT :limit")
    fun search(query: String, limit: Int = 500): Flow<List<PrivacyMessageEntity>>

    @Query("SELECT DISTINCT conversation FROM privacy_messages WHERE source = :source ORDER BY conversation")
    fun conversations(source: String): Flow<List<String>>

    @Query("DELETE FROM privacy_messages WHERE source = :source")
    suspend fun clearSource(source: String)

    @Query("SELECT COUNT(*) FROM privacy_messages")
    fun count(): Flow<Int>
}
