package com.nexusx.core.privacy

import com.nexusx.core.db.entity.PrivacyMessageEntity
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/**
 * Parses a user's OWN Instagram "Download Your Information" export. Instagram provides message history
 * as JSON (messages_1.json inside each thread folder). The user requests this archive from Instagram,
 * then picks it here via the Storage Access Framework. NEXUS X never scrapes Instagram, never uses
 * anyone's credentials, and never accesses another account.
 */
object InstagramImporter {
    const val SOURCE = "INSTAGRAM"

    /** Parses one thread's messages_*.json content. */
    fun parseThreadJson(json: String, importedAtEpochMs: Long): List<PrivacyMessageEntity> {
        val root = runCatching { JSONObject(json) }.getOrNull() ?: return emptyList()
        val conversation = root.optString("title").ifBlank { "Instagram thread" }
        val messages = root.optJSONArray("messages") ?: return emptyList()
        val out = ArrayList<PrivacyMessageEntity>(messages.length())
        for (i in 0 until messages.length()) {
            val m = messages.optJSONObject(i) ?: continue
            val sender = m.optString("sender_name").takeIf { it.isNotBlank() }
            val content = decodeMojibake(m.optString("content"))
            val tsMs = if (m.has("timestamp_ms")) m.optLong("timestamp_ms") else null
            if (content.isBlank()) continue
            out += PrivacyMessageEntity(
                source = SOURCE, conversation = conversation, sender = sender,
                timestampEpochMs = tsMs, content = content, importedAtEpochMs = importedAtEpochMs,
            )
        }
        return out
    }

    /**
     * Instagram exports frequently store UTF-8 bytes misread as Latin-1 (mojibake). We repair this,
     * but ONLY when the telltale marker characters are present AND the re-decode is strictly valid
     * UTF-8 — otherwise correctly-encoded content (emoji, CJK) would be destroyed by a blind round-trip.
     */
    private fun decodeMojibake(s: String): String {
        if (s.none { it == 'Ã' || it == 'Â' }) return s
        return runCatching {
            val bytes = s.toByteArray(Charsets.ISO_8859_1)
            val decoder = Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
            decoder.decode(ByteBuffer.wrap(bytes)).toString()
        }.getOrDefault(s)
    }
}
