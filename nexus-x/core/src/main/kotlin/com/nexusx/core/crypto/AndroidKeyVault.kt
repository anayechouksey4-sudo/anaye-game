package com.nexusx.core.crypto

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.PublicKey

/**
 * Stores the device's long-term identity key pair in the hardware-backed Android Keystore. The
 * private key never leaves the Keystore and is non-exportable; we only read the public key out to
 * share during pairing. This is the on-device companion to [KeyExchange]; it is not unit-tested on
 * the JVM because it depends on the Android Keystore provider (see instrumented tests).
 */
class AndroidKeyVault(private val alias: String = DEFAULT_ALIAS) {

    private val keyStore: KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    fun ensureIdentityKey(): PublicKey {
        if (!keyStore.containsAlias(alias)) generateIdentityKey()
        return (keyStore.getCertificate(alias)?.publicKey)
            ?: (keyStore.getEntry(alias, null) as KeyStore.PrivateKeyEntry).certificate.publicKey
    }

    fun identityPrivateKey(): PrivateKey =
        (keyStore.getEntry(alias, null) as KeyStore.PrivateKeyEntry).privateKey

    fun identityPublicKey(): PublicKey = ensureIdentityKey()

    fun hasIdentity(): Boolean = keyStore.containsAlias(alias)

    fun deleteIdentity() { if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias) }

    private fun generateIdentityKey() {
        val kpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE)
        val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_AGREE_KEY)
            .setAlgorithmParameterSpec(java.security.spec.ECGenParameterSpec(KeyExchange.CURVE))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .build()
        kpg.initialize(spec)
        kpg.generateKeyPair()
    }

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val DEFAULT_ALIAS = "nexusx.identity.v1"
    }
}
