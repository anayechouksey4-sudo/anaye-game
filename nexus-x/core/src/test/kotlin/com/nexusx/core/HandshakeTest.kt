package com.nexusx.core

import com.google.common.truth.Truth.assertThat
import com.nexusx.core.crypto.KeyExchange
import com.nexusx.core.net.Handshake
import com.nexusx.core.net.wire.WireMessage
import org.junit.Test
import java.io.PipedInputStream
import java.io.PipedOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class HandshakeTest {
    /** Two peers over crossed pipes complete the handshake, derive matching channels, and talk. */
    @Test fun full_handshake_and_encrypted_exchange() {
        // Pipe A->B and B->A.
        val aOut = PipedOutputStream(); val bIn = PipedInputStream(aOut, 1 shl 16)
        val bOut = PipedOutputStream(); val aIn = PipedInputStream(bOut, 1 shl 16)

        val aKeys = KeyExchange.generateEphemeralKeyPair()
        val bKeys = KeyExchange.generateEphemeralKeyPair()
        val aPub = KeyExchange.encodePublicKey(aKeys.public)
        val bPub = KeyExchange.encodePublicKey(bKeys.public)

        val pool = Executors.newFixedThreadPool(2)
        val aFut = pool.submit<Handshake.Result> {
            Handshake.performInitiator(aIn, aOut, "ctrl", "Controller", aKeys.private, aPub)
        }
        val bFut = pool.submit<Handshake.Result> {
            Handshake.performResponder(bIn, bOut, "comp", "Companion", bKeys.private, bPub)
        }
        val aRes = aFut.get(10, TimeUnit.SECONDS)
        val bRes = bFut.get(10, TimeUnit.SECONDS)

        assertThat(aRes.shortAuthString).isEqualTo(bRes.shortAuthString)
        assertThat(aRes.peerId).isEqualTo("comp")
        assertThat(bRes.peerId).isEqualTo("ctrl")
        assertThat(aRes.sessionId).isEqualTo(bRes.sessionId)

        // Encrypted application exchange over the derived channels.
        val ping = WireMessage.encode(WireMessage.Ping(42))
        val frame = aRes.channel.encrypt(ping)
        val got = WireMessage.decode(bRes.channel.decrypt(frame)) as WireMessage.Ping
        assertThat(got.nonce).isEqualTo(42)
        pool.shutdownNow()
    }

    /** Regression: two sessions between the SAME identity keys must derive different keys (no GCM nonce reuse). */
    @Test fun distinct_sessions_derive_distinct_keys() {
        val aKeys = KeyExchange.generateEphemeralKeyPair()
        val bKeys = KeyExchange.generateEphemeralKeyPair()
        val aPub = KeyExchange.encodePublicKey(aKeys.public)
        val bPub = KeyExchange.encodePublicKey(bKeys.public)
        val pool = Executors.newFixedThreadPool(4)
        fun runSession(): ByteArray {
            val aOut = PipedOutputStream(); val bIn = PipedInputStream(aOut, 1 shl 16)
            val bOut = PipedOutputStream(); val aIn = PipedInputStream(bOut, 1 shl 16)
            val aFut = pool.submit<Handshake.Result> { Handshake.performInitiator(aIn, aOut, "a", "A", aKeys.private, aPub) }
            val bFut = pool.submit<Handshake.Result> { Handshake.performResponder(bIn, bOut, "b", "B", bKeys.private, bPub) }
            val r = aFut.get(10, TimeUnit.SECONDS); bFut.get(10, TimeUnit.SECONDS)
            return r.sessionId
        }
        val s1 = runSession(); val s2 = runSession()
        assertThat(s1).isNotEqualTo(s2)
        pool.shutdownNow()
    }

    /** Pinning: a mismatched peer key is rejected. */
    @Test fun pinned_peer_key_mismatch_is_rejected() {
        val aOut = PipedOutputStream(); val bIn = PipedInputStream(aOut, 1 shl 16)
        val bOut = PipedOutputStream(); val aIn = PipedInputStream(bOut, 1 shl 16)
        val aKeys = KeyExchange.generateEphemeralKeyPair(); val bKeys = KeyExchange.generateEphemeralKeyPair()
        val aPub = KeyExchange.encodePublicKey(aKeys.public); val bPub = KeyExchange.encodePublicKey(bKeys.public)
        val wrong = KeyExchange.encodePublicKey(KeyExchange.generateEphemeralKeyPair().public)
        val pool = Executors.newFixedThreadPool(2)
        val aFut = pool.submit<Handshake.Result> { Handshake.performInitiator(aIn, aOut, "a", "A", aKeys.private, aPub, expectedPeerPublicKey = wrong) }
        pool.submit<Handshake.Result> { runCatching { Handshake.performResponder(bIn, bOut, "b", "B", bKeys.private, bPub) } .getOrNull() ?: error("responder") }
        var threw = false
        try { aFut.get(10, TimeUnit.SECONDS) } catch (e: Exception) { threw = true }
        assertThat(threw).isTrue()
        pool.shutdownNow()
    }
}
