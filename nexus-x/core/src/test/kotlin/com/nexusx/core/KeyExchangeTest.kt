package com.nexusx.core

import com.google.common.truth.Truth.assertThat
import com.nexusx.core.crypto.KeyExchange
import org.junit.Test

class KeyExchangeTest {
    @Test fun both_sides_derive_identical_secret() {
        val alice = KeyExchange.generateEphemeralKeyPair()
        val bob = KeyExchange.generateEphemeralKeyPair()
        val aShared = KeyExchange.sharedSecret(alice.private, bob.public)
        val bShared = KeyExchange.sharedSecret(bob.private, alice.public)
        assertThat(aShared).isEqualTo(bShared)
    }

    @Test fun session_keys_are_distinct_per_direction() {
        val a = KeyExchange.generateEphemeralKeyPair()
        val b = KeyExchange.generateEphemeralKeyPair()
        val secret = KeyExchange.sharedSecret(a.private, b.public)
        val keys = KeyExchange.deriveSessionKeys(secret, "transcript".toByteArray())
        assertThat(keys.initiatorToResponder).isNotEqualTo(keys.responderToInitiator)
        assertThat(keys.initiatorToResponder.size).isEqualTo(32)
    }

    @Test fun public_key_encode_decode_roundtrip() {
        val kp = KeyExchange.generateEphemeralKeyPair()
        val enc = KeyExchange.encodePublicKey(kp.public)
        val dec = KeyExchange.decodePublicKey(enc)
        assertThat(dec).isEqualTo(kp.public)
    }
}
