package com.nexusx.core.privacy

import com.nexusx.core.db.entity.PrivacyMessageEntity
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * Parses a user's OWN exported WhatsApp chat (the plain-text "Export chat" .txt file the user creates
 * from inside WhatsApp and picks via the Storage Access Framework). This reads a file the user hands
 * us; it does NOT touch WhatsApp's private database, does NOT bypass end-to-end encryption, and does
 * NOT access anyone else's data. Pure parsing logic, unit-tested.
 */
object WhatsAppImporter {
    const val SOURCE = "WHATSAPP"

    // "12/31/23, 11:59 PM - Sender: message"  or  "31/12/2023, 23:59 - Sender: message"
    private val LINE = Regex(
        """^(\d{1,2}/\d{1,2}/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\s+[-–]\s+(.*)$"""
    )

    private val DATE_FORMATS = listOf(
        // Minute precision
        "M/d/yy, h:mm a", "M/d/yyyy, h:mm a", "d/M/yy, HH:mm", "d/M/yyyy, HH:mm",
        "M/d/yy, HH:mm", "dd/MM/yyyy, HH:mm", "MM/dd/yy, h:mm a",
        // Second precision (some exports include seconds; without these the timestamp parsed to null)
        "M/d/yy, h:mm:ss a", "M/d/yyyy, h:mm:ss a", "d/M/yy, HH:mm:ss", "d/M/yyyy, HH:mm:ss",
        "M/d/yy, HH:mm:ss", "dd/MM/yyyy, HH:mm:ss", "MM/dd/yy, h:mm:ss a",
    )

    fun parse(text: String, conversation: String, importedAtEpochMs: Long): List<PrivacyMessageEntity> {
        val out = ArrayList<PrivacyMessageEntity>()
        var current: PrivacyMessageEntity? = null
        for (raw in text.lineSequence()) {
            val line = raw.trimEnd('\r')
            val m = LINE.matchEntire(line)
            if (m != null) {
                current?.let { out += it }
                val (date, time, rest) = m.destructured
                val tsMs = parseTimestamp("$date, $time")
                val colon = rest.indexOf(": ")
                val sender: String?
                val content: String
                if (colon >= 0) {
                    sender = rest.substring(0, colon)
                    content = rest.substring(colon + 2)
                } else {
                    sender = null // system/notice line
                    content = rest
                }
                current = PrivacyMessageEntity(
                    source = SOURCE, conversation = conversation, sender = sender,
                    timestampEpochMs = tsMs, content = content, importedAtEpochMs = importedAtEpochMs,
                )
            } else if (current != null) {
                current = current.copy(content = current.content + "\n" + line)
            }
        }
        current?.let { out += it }
        return out
    }

    private fun parseTimestamp(s: String): Long? {
        for (fmt in DATE_FORMATS) {
            runCatching {
                val sdf = SimpleDateFormat(fmt, Locale.US)
                sdf.isLenient = false
                return sdf.parse(s)?.time
            }
        }
        return null
    }
}
