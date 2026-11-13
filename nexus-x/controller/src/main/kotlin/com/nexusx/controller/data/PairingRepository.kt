package com.nexusx.controller.data

import com.nexusx.core.crypto.AndroidKeyVault
import com.nexusx.core.crypto.Fingerprint
import com.nexusx.core.crypto.KeyExchange
import com.nexusx.core.db.dao.PairingDao
import com.nexusx.core.db.entity.PairedDeviceEntity
import com.nexusx.core.model.Capability
import com.nexusx.core.model.PairedDevice
import com.nexusx.core.model.PairingStatus
import com.nexusx.core.pairing.PairingCode
import com.nexusx.core.pairing.PairingPayload
import com.nexusx.core.util.Clock
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Owns durable pairings and the issuance of pairing material. The device's identity key lives in the
 * hardware Keystore via [AndroidKeyVault]; we only ever expose its public half. A new pairing is only
 * persisted as ACTIVE after the Companion side has explicitly approved (handled by the session layer).
 */
class PairingRepository(
    private val pairingDao: PairingDao,
    private val keyVault: AndroidKeyVault,
    private val selfId: String,
    private val selfName: String,
    private val clock: Clock = Clock.SYSTEM,
) {
    val paired: Flow<List<PairedDevice>> = pairingDao.observeAll().map { list -> list.map { it.toModel() } }

    fun identityPublicKeyB64(): String =
        PairingPayload.publicKeyToB64(KeyExchange.encodePublicKey(keyVault.identityPublicKey()))

    fun identityFingerprint(): String =
        Fingerprint.formatFingerprint(KeyExchange.encodePublicKey(keyVault.identityPublicKey()))

    /** Build the QR/short-code payload the Companion will scan to begin pairing. */
    fun newPairingPayload(host: String, port: Int): Pair<PairingPayload, String> {
        val token = PairingCode.newToken()
        val payload = PairingPayload(
            deviceId = selfId,
            displayName = selfName,
            host = host,
            port = port,
            publicKeyB64 = identityPublicKeyB64(),
            token = token,
        )
        return payload to PairingCode.shortCode(token)
    }

    suspend fun persistPairing(
        deviceId: String, displayName: String, remotePublicKeyX509: ByteArray,
        validityMs: Long = DEFAULT_VALIDITY_MS, capabilities: Set<Capability> = DEFAULT_CAPS,
    ) {
        val now = clock.nowMs()
        pairingDao.upsert(
            PairedDeviceEntity(
                deviceId = deviceId,
                displayName = displayName,
                remotePublicKey = PairingPayload.publicKeyToB64(remotePublicKeyX509),
                fingerprint = Fingerprint.formatFingerprint(remotePublicKeyX509),
                status = PairingStatus.ACTIVE.name,
                pairedAtEpochMs = now,
                expiresAtEpochMs = now + validityMs,
                lastSeenEpochMs = now,
                grantedCapabilities = capabilities.map { it.name },
            )
        )
    }

    suspend fun revoke(deviceId: String) = pairingDao.setStatus(deviceId, PairingStatus.REVOKED.name)
    suspend fun remove(deviceId: String) = pairingDao.delete(deviceId)
    suspend fun find(deviceId: String): PairedDevice? = pairingDao.find(deviceId)?.toModel()

    companion object {
        const val DEFAULT_VALIDITY_MS: Long = 30L * 24 * 60 * 60 * 1000 // 30 days
        val DEFAULT_CAPS = setOf(Capability.PRESENCE, Capability.FILE_TRANSFER, Capability.SCREEN_SHARE)
    }
}

private fun PairedDeviceEntity.toModel() = PairedDevice(
    deviceId = deviceId, displayName = displayName, remotePublicKey = remotePublicKey, fingerprint = fingerprint,
    status = runCatching { PairingStatus.valueOf(status) }.getOrDefault(PairingStatus.PENDING),
    pairedAtEpochMs = pairedAtEpochMs, expiresAtEpochMs = expiresAtEpochMs, lastSeenEpochMs = lastSeenEpochMs,
    grantedCapabilities = grantedCapabilities.mapNotNull { runCatching { Capability.valueOf(it) }.getOrNull() }.toSet(),
)
