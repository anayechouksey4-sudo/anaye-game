package com.nexusx.core

import com.google.common.truth.Truth.assertThat
import com.nexusx.core.privacy.WhatsAppImporter
import org.junit.Test

class WhatsAppImporterTest {
    private val sample = """
        12/31/23, 11:58 PM - Messages are end-to-end encrypted.
        12/31/23, 11:59 PM - Alice: Happy new year!
        12/31/23, 11:59 PM - Bob: You too 🎉
        This is a second line of Bob's message
        1/1/24, 12:01 AM - Alice: Let's catch up tomorrow
    """.trimIndent()

    @Test fun parses_messages_senders_and_multiline() {
        val msgs = WhatsAppImporter.parse(sample, "Alice & Bob", importedAtEpochMs = 1_700_000_000_000)
        assertThat(msgs).hasSize(4)
        assertThat(msgs[0].sender).isNull() // system notice
        assertThat(msgs[1].sender).isEqualTo("Alice")
        assertThat(msgs[2].sender).isEqualTo("Bob")
        assertThat(msgs[2].content).contains("second line")
        assertThat(msgs.all { it.source == WhatsAppImporter.SOURCE }).isTrue()
    }

    @Test fun timestamps_parse_when_possible() {
        val msgs = WhatsAppImporter.parse(sample, "c", 0)
        assertThat(msgs[1].timestampEpochMs).isNotNull()
    }

    @Test fun timestamps_with_seconds_parse() {
        val withSeconds = "12/31/23, 11:59:30 PM - Alice: at the stroke of midnight"
        val msgs = WhatsAppImporter.parse(withSeconds, "c", 0)
        assertThat(msgs).hasSize(1)
        assertThat(msgs[0].sender).isEqualTo("Alice")
        assertThat(msgs[0].timestampEpochMs).isNotNull()
    }
}
