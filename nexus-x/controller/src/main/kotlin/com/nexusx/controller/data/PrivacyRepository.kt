package com.nexusx.controller.data

import android.content.Context
import android.net.Uri
import com.nexusx.core.db.dao.PrivacyDao
import com.nexusx.core.db.entity.PrivacyMessageEntity
import com.nexusx.core.privacy.InstagramImporter
import com.nexusx.core.privacy.WhatsAppImporter
import com.nexusx.core.util.Clock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext

/**
 * Imports and searches the user's OWN exported chat archives (Module 7). Files are chosen by the user
 * through the Storage Access Framework; nothing is read from another app's private storage and no
 * end-to-end encryption is bypassed.
 */
class PrivacyRepository(
    private val context: Context,
    private val privacyDao: PrivacyDao,
    private val clock: Clock = Clock.SYSTEM,
) {
    val count: Flow<Int> = privacyDao.count()

    fun observe(source: String): Flow<List<PrivacyMessageEntity>> = privacyDao.observeBySource(source)
    fun search(query: String): Flow<List<PrivacyMessageEntity>> = privacyDao.search(query)
    fun conversations(source: String): Flow<List<String>> = privacyDao.conversations(source)

    /** Import a WhatsApp "Export chat" .txt the user picked. Returns the number of messages imported. */
    suspend fun importWhatsApp(uri: Uri, conversationName: String): Int = withContext(Dispatchers.IO) {
        val text = readText(uri) ?: return@withContext 0
        val msgs = WhatsAppImporter.parse(text, conversationName, clock.nowMs())
        privacyDao.insertAll(msgs)
        msgs.size
    }

    /** Import one Instagram thread messages_*.json the user picked. */
    suspend fun importInstagramThread(uri: Uri): Int = withContext(Dispatchers.IO) {
        val json = readText(uri) ?: return@withContext 0
        val msgs = InstagramImporter.parseThreadJson(json, clock.nowMs())
        privacyDao.insertAll(msgs)
        msgs.size
    }

    suspend fun clear(source: String) = privacyDao.clearSource(source)

    private fun readText(uri: Uri): String? = runCatching {
        context.contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) }
    }.getOrNull()
}
