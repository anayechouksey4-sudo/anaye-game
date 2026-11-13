package com.nexusx.core.db.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * A single message from a user's OWN exported data archive (e.g. a WhatsApp chat .txt export, or an
 * Instagram data download the user requested from the platform). NEXUS X never reaches into another
 * app's private storage; the user explicitly picks the export file via the Storage Access Framework
 * and imports it here for their own searchable viewing.
 */
@Entity(tableName = "privacy_messages", indices = [Index("source"), Index("conversation")])
data class PrivacyMessageEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val source: String,          // WHATSAPP | INSTAGRAM
    val conversation: String,    // chat name / thread
    val sender: String?,
    val timestampEpochMs: Long?,
    val content: String,
    val importedAtEpochMs: Long,
)
