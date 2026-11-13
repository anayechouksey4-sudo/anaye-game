package com.nexusx.core

import com.google.common.truth.Truth.assertThat
import com.nexusx.core.crypto.Fingerprint
import org.junit.Test

class FingerprintTest {
    @Test fun sas_is_six_digits_and_deterministic() {
        val a = byteArrayOf(1, 2, 3, 4); val b = byteArrayOf(5, 6, 7, 8)
        val s1 = Fingerprint.shortAuthString(a, b)
        val s2 = Fingerprint.shortAuthString(a, b)
        assertThat(s1).isEqualTo(s2)
        assertThat(s1).hasLength(6)
        assertThat(s1.all { it.isDigit() }).isTrue()
    }

    @Test fun sas_order_matters() {
        val a = byteArrayOf(1, 2, 3, 4); val b = byteArrayOf(5, 6, 7, 8)
        assertThat(Fingerprint.shortAuthString(a, b)).isNotEqualTo(Fingerprint.shortAuthString(b, a))
    }

    @Test fun fingerprint_is_grouped_hex() {
        val fp = Fingerprint.formatFingerprint("key".toByteArray())
        assertThat(fp).matches("([0-9A-F]{4} ){7}[0-9A-F]{4}")
    }
}
