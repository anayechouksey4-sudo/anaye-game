package com.nexusx.core.model

/** Lifecycle of a pairing between the Controller and a Companion. */
enum class PairingStatus {
    PENDING,      // code/QR issued, awaiting the other side
    AWAITING_APPROVAL, // handshake reached the Companion; its user must approve
    ACTIVE,       // mutually authenticated, authorization valid
    EXPIRED,      // past its validity window
    REVOKED,      // the owner or Companion revoked it
    REJECTED,     // the Companion user declined
}

/**
 * A durable authorization between two devices. The long-term keys live in the Android Keystore;
 * only the public material and metadata are stored here. There is no silent pairing: a Companion
 * record only reaches ACTIVE after an explicit tap on the receiving device.
 */
data class PairedDevice(
    val deviceId: String,
    val displayName: String,
    /** Remote device long-term public key (EC P-256, X.509 SubjectPublicKeyInfo, Base64). */
    val remotePublicKey: String,
    /** SHA-256 fingerprint of the remote public key, shown to users for verification. */
    val fingerprint: String,
    val status: PairingStatus,
    val pairedAtEpochMs: Long,
    val expiresAtEpochMs: Long,
    val lastSeenEpochMs: Long,
    /** Capabilities this pairing has consented to, e.g. SCREEN_SHARE, FILE_TRANSFER. */
    val grantedCapabilities: Set<Capability> = emptySet(),
) {
    fun isExpired(nowMs: Long): Boolean = nowMs >= expiresAtEpochMs
    fun isUsable(nowMs: Long): Boolean = status == PairingStatus.ACTIVE && !isExpired(nowMs)
}

/** Consent-scoped capabilities a pairing can grant. Each is independently revocable. */
enum class Capability { FILE_TRANSFER, SCREEN_SHARE, REMOTE_INPUT, PRESENCE }
