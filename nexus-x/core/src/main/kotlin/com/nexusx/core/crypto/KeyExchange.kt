package com.nexusx.core.crypto

import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.PublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.KeyAgreement

/**
 * Elliptic-curve Diffie-Hellman over NIST P-256 (secp256r1). P-256 is chosen over X25519 because
 * it is available through the JCA on every target API level (26+) and on the JVM used for unit
 * tests, whereas XDH/X25519 only appears on newer Android. The derived shared secret is run
 * through HKDF to produce separate send/receive AES-256-GCM keys.
 */
object KeyExchange {
    const val CURVE = "secp256r1"
    private const val KEY_ALG = "EC"

    fun generateEphemeralKeyPair(): KeyPair {
        val kpg = KeyPairGenerator.getInstance(KEY_ALG)
        kpg.initialize(ECGenParameterSpec(CURVE))
        return kpg.generateKeyPair()
    }

    fun encodePublicKey(key: PublicKey): ByteArray = key.encoded // X.509 SubjectPublicKeyInfo

    fun decodePublicKey(x509: ByteArray): PublicKey =
        KeyFactory.getInstance(KEY_ALG).generatePublic(X509EncodedKeySpec(x509))

    fun sharedSecret(privateKey: PrivateKey, remotePublicKey: PublicKey): ByteArray {
        val ka = KeyAgreement.getInstance("ECDH")
        ka.init(privateKey)
        ka.doPhase(remotePublicKey, true)
        return ka.generateSecret()
    }

    /**
     * Derives a pair of directional 32-byte keys from a shared secret. Both sides compute the same
     * pair; the initiator uses (initiatorSend, responderSend) and the responder swaps them, so each
     * direction has an independent key.
     */
    data class SessionKeys(val initiatorToResponder: ByteArray, val responderToInitiator: ByteArray)

    fun deriveSessionKeys(sharedSecret: ByteArray, transcript: ByteArray): SessionKeys {
        val prk = Hkdf.extract(salt = "nexusx-v1".toByteArray(), ikm = sharedSecret)
        val i2r = Hkdf.expand(prk, "i2r".toByteArray() + transcript, 32)
        val r2i = Hkdf.expand(prk, "r2i".toByteArray() + transcript, 32)
        return SessionKeys(i2r, r2i)
    }
}
