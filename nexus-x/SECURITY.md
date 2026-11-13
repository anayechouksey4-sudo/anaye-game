# NEXUS X — Security & Privacy

NEXUS X is built so that the honest answer to "can it do something I did not
consent to?" is **no**. The guarantees below are structural, not promises.

## Cryptography

- **Identity keys** are EC P-256, generated in and never exported from the
  hardware-backed **Android Keystore** (`core/crypto/AndroidKeyVault`). P-256 is
  chosen over X25519 because it is available on every target API level (26+) and
  on the JVM used for the unit tests.
- **Pairing** performs ECDH between the two identity keys, then derives two
  independent AES-256-GCM keys (one per direction) via **HKDF-SHA256**
  (`core/crypto/Hkdf`, verified against the RFC 5869 test vectors).
- **Channel** (`core/crypto/SecureChannel`): every message is AES-256-GCM sealed
  with a sequence-numbered nonce, and the sequence number is authenticated as
  associated data. Replayed or reordered frames fail to decrypt. Unit tests prove
  the round-trip and the replay/reorder rejection.
- **Man-in-the-middle defence:** a 6-digit **short authentication string**
  derived from both public keys is shown on both screens. If they match, there is
  no interposed attacker.

## Consent

- **No silent pairing.** A pairing only becomes active after an explicit tap on
  the receiving device, and only if the verification codes match.
- **No silent screen capture.** Capture runs through Android `MediaProjection`,
  which always shows the system grant dialog. A persistent notification and an
  in-app banner stay visible for the whole session; the sharing device can stop
  it instantly.
- **No silent file access.** Files are chosen by the user through the Storage
  Access Framework. There is no access to another app's private storage.
- **Revocation & expiry.** Pairings expire (default 30 days) and can be revoked
  at any time from the Controller.

## What NEXUS X deliberately does NOT do

- No root, no privilege escalation, no exploits.
- No accessibility-service abuse to bypass Android security or capture protection.
- No covert/background access — foreground services carry visible notifications.
- No capture of passwords, tokens, or another person's private messages.
- No bypass of end-to-end encryption; the privacy center only reads exports the
  user supplies themselves.

## Permissions (minimised)

**Controller:** `INTERNET` (LAN sockets only — no servers are contacted),
`ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `CHANGE_WIFI_MULTICAST_STATE` (mDNS),
`FOREGROUND_SERVICE(+DATA_SYNC)`, `POST_NOTIFICATIONS`, and optional
`ACCESS_FINE_LOCATION` (only to display the Wi-Fi name).

**Companion:** the same networking set plus
`FOREGROUND_SERVICE_MEDIA_PROJECTION` for approved screen sharing.

## Data at rest

Pairing records and observation history live in a local Room database; the
private key material never leaves the Keystore. `allowBackup` is disabled and
backup/transfer extraction rules exclude app data.

## Honesty about network discovery

A normal Android app is **not** the router and cannot be handed a definitive
client list — on a phone hotspot especially. NEXUS X reflects this: presence is
labelled `CONFIRMED` / `REACHABLE` / `INFERRED` / `STALE`, and "observed for N
minutes" is explicitly *observation*, not proof of continuous connection.
