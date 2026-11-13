package com.nexusx.core

import com.google.common.truth.Truth.assertThat
import com.nexusx.core.crypto.CryptoBox
import com.nexusx.core.crypto.SecureChannel
import org.junit.Test

class SecureChannelTest {
    private fun pair(): Pair<SecureChannel, SecureChannel> {
        val k1 = CryptoBox.randomKey(); val k2 = CryptoBox.randomKey(); val sid = ByteArray(16) { it.toByte() }
        val a = SecureChannel(sendKey = k1, recvKey = k2, sessionId = sid)
        val b = SecureChannel(sendKey = k2, recvKey = k1, sessionId = sid)
        return a to b
    }

    @Test fun duplex_roundtrip_in_order() {
        val (a, b) = pair()
        val f1 = a.encrypt("one".toByteArray())
        val f2 = a.encrypt("two".toByteArray())
        assertThat(String(b.decrypt(f1))).isEqualTo("one")
        assertThat(String(b.decrypt(f2))).isEqualTo("two")
    }

    @Test(expected = IllegalStateException::class)
    fun replay_is_rejected() {
        val (a, b) = pair()
        val f1 = a.encrypt("one".toByteArray())
        b.decrypt(f1)
        b.decrypt(f1) // replay -> unexpected sequence
    }

    @Test(expected = IllegalStateException::class)
    fun reorder_is_rejected() {
        val (a, b) = pair()
        val f1 = a.encrypt("one".toByteArray())
        val f2 = a.encrypt("two".toByteArray())
        b.decrypt(f2) // out of order
    }
}
