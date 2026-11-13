package com.nexusx.core

import com.google.common.truth.Truth.assertThat
import com.nexusx.core.crypto.Hkdf
import org.junit.Test

class HkdfTest {
    private fun hex(s: String) = s.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    private fun ByteArray.hex() = joinToString("") { "%02x".format(it) }

    /** RFC 5869 Appendix A.1 test vector (SHA-256). */
    @Test fun rfc5869_vector1() {
        val ikm = hex("0b".repeat(22))
        val salt = hex("000102030405060708090a0b0c")
        val info = hex("f0f1f2f3f4f5f6f7f8f9")
        val okm = Hkdf.derive(ikm, salt, info, 42)
        assertThat(okm.hex()).isEqualTo(
            "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865"
        )
    }

    @Test fun deterministic_and_length() {
        val a = Hkdf.derive("secret".toByteArray(), null, "ctx".toByteArray(), 32)
        val b = Hkdf.derive("secret".toByteArray(), null, "ctx".toByteArray(), 32)
        assertThat(a.hex()).isEqualTo(b.hex())
        assertThat(a.size).isEqualTo(32)
        val c = Hkdf.derive("secret".toByteArray(), null, "other".toByteArray(), 32)
        assertThat(c.hex()).isNotEqualTo(a.hex())
    }
}
