package com.nexusx.core

import com.google.common.truth.Truth.assertThat
import com.nexusx.core.crypto.CryptoBox
import org.junit.Test
import javax.crypto.AEADBadTagException

class CryptoBoxTest {
    @Test fun seal_then_open_roundtrip() {
        val key = CryptoBox.randomKey()
        val msg = "nexus-x secret payload".toByteArray()
        val sealed = CryptoBox.seal(key, msg, aad = "ctx".toByteArray())
        val opened = CryptoBox.open(key, sealed, aad = "ctx".toByteArray())
        assertThat(String(opened)).isEqualTo("nexus-x secret payload")
    }

    @Test(expected = AEADBadTagException::class)
    fun tampered_ciphertext_fails() {
        val key = CryptoBox.randomKey()
        val sealed = CryptoBox.seal(key, "hello".toByteArray())
        sealed[sealed.size - 1] = (sealed[sealed.size - 1] + 1).toByte()
        CryptoBox.open(key, sealed)
    }

    @Test(expected = AEADBadTagException::class)
    fun wrong_aad_fails() {
        val key = CryptoBox.randomKey()
        val sealed = CryptoBox.seal(key, "hello".toByteArray(), aad = "a".toByteArray())
        CryptoBox.open(key, sealed, aad = "b".toByteArray())
    }
}
