package com.nexusx.core.crypto

import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Authenticated encryption with AES-256-GCM. Each sealed message carries its own 12-byte nonce
 * prepended to the ciphertext. GCM provides confidentiality and integrity; associated data binds
 * the ciphertext to a context (e.g. the session id) so frames cannot be replayed across sessions.
 */
object CryptoBox {
    private const val TRANSFORM = "AES/GCM/NoPadding"
    const val NONCE_LEN = 12
    private const val TAG_BITS = 128
    private val rng = SecureRandom()

    fun randomKey(): ByteArray = ByteArray(32).also { rng.nextBytes(it) }

    /** Returns nonce(12) || ciphertext || tag(16). */
    fun seal(key: ByteArray, plaintext: ByteArray, aad: ByteArray? = null): ByteArray {
        require(key.size == 32) { "AES-256 key must be 32 bytes" }
        val nonce = ByteArray(NONCE_LEN).also { rng.nextBytes(it) }
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, nonce))
        if (aad != null) cipher.updateAAD(aad)
        val ct = cipher.doFinal(plaintext)
        return nonce + ct
    }

    /** Seal with a caller-provided nonce (used by [SecureChannel]'s deterministic counter). */
    fun sealWithNonce(key: ByteArray, nonce: ByteArray, plaintext: ByteArray, aad: ByteArray? = null): ByteArray {
        require(key.size == 32) { "AES-256 key must be 32 bytes" }
        require(nonce.size == NONCE_LEN) { "nonce must be 12 bytes" }
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, nonce))
        if (aad != null) cipher.updateAAD(aad)
        return cipher.doFinal(plaintext)
    }

    fun open(key: ByteArray, sealed: ByteArray, aad: ByteArray? = null): ByteArray {
        require(sealed.size > NONCE_LEN) { "sealed message too short" }
        val nonce = sealed.copyOfRange(0, NONCE_LEN)
        val ct = sealed.copyOfRange(NONCE_LEN, sealed.size)
        return openWithNonce(key, nonce, ct, aad)
    }

    fun openWithNonce(key: ByteArray, nonce: ByteArray, ciphertext: ByteArray, aad: ByteArray? = null): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, nonce))
        if (aad != null) cipher.updateAAD(aad)
        return cipher.doFinal(ciphertext)
    }
}
