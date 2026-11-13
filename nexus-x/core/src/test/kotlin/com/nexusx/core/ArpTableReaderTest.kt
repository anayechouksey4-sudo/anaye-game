package com.nexusx.core

import com.google.common.truth.Truth.assertThat
import com.nexusx.core.discovery.ArpTableReader
import org.junit.Test

class ArpTableReaderTest {
    private val table = """
        IP address       HW type     Flags       HW address            Mask     Device
        192.168.1.1      0x1         0x2         b8:27:eb:aa:bb:cc     *        wlan0
        192.168.1.50     0x1         0x0         00:00:00:00:00:00     *        wlan0
        192.168.1.77     0x1         0x2         8c:85:80:11:22:33     *        wlan0
    """.trimIndent()

    @Test fun parses_valid_entries_and_drops_empty_mac() {
        val entries = ArpTableReader.parse(table)
        assertThat(entries).hasSize(3)
        assertThat(entries[0].mac).isEqualTo("b8:27:eb:aa:bb:cc")
        assertThat(entries[1].mac).isNull() // all-zero MAC dropped to null
        assertThat(entries[2].ip).isEqualTo("192.168.1.77")
    }
}
