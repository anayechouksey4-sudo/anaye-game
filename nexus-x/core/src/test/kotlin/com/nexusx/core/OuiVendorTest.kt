package com.nexusx.core

import com.google.common.truth.Truth.assertThat
import com.nexusx.core.discovery.OuiVendor
import org.junit.Test

class OuiVendorTest {
    @Test fun known_prefix_resolves() {
        assertThat(OuiVendor.lookup("B8:27:EB:12:34:56")).isEqualTo("Raspberry Pi")
        assertThat(OuiVendor.lookup("b827eb123456")).isEqualTo("Raspberry Pi")
    }

    @Test fun unknown_or_null_returns_null() {
        assertThat(OuiVendor.lookup("AA:BB:CC:DD:EE:FF")).isNull()
        assertThat(OuiVendor.lookup(null)).isNull()
        assertThat(OuiVendor.lookup("")).isNull()
    }
}
