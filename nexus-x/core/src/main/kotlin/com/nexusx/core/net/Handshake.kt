package com.nexusx.core.net

import com.nexusx.core.crypto.Fingerprint
import com.nexusx.core.crypto.KeyExchange
import com.nexusx.core.crypto.SecureChannel
import com.nexusx.core.net.wire.Frame
import com.nexusx.core.net.wire.WireMessage
import java.io.InputStream
import java.io.OutputStream
import java.security.PrivateKey
import java.security.SecureRandom

/**
 * The mutually-authenticated key establishment that precedes every NEXUS X session.
 *
 * Both peers exchange their identity public keys and a fresh 16-byte per-session nonce, each computes
 * the ECDH shared secret with its own Keystore-held private key, and both derive the same pair of
 * directional AES-256-GCM keys via HKDF over a transcript that binds BOTH public keys AND BOTH session
 * nonces. The nonces are essential: without them, two sessions between the same pair of static
 * identity keys would derive identical keys and (because each [SecureChannel] restarts its sequence
 * counter at 0) reuse the same (key, GCM-nonce) pair across sessions — the one failure AES-GCM must
 * never have. Mixing fresh nonces makes every session's keys and session id unique.
 *
 * The returned [Result.shortAuthString] is shown on both screens so a human rules out a
 * machine-in-the-middle. For a device that is already paired, pass [expectedPeerPublicKey] so the
 * handshake additionally pins the peer to the stored identity key and rejects any mismatch.
 */
object Handshake {
    private val rng = SecureRandom()
    private const val NONCE_LEN = 16

    data class Result(
        val channel: SecureChannel,
        val peerId: String,
        val peerName: String,
        val peerPublicKey: ByteArray,
        val shortAuthString: String,
        val sessionId: ByteArray,
    )

    fun performInitiator(
        input: InputStream, output: OutputStream,
        selfId: String, selfName: String,
        selfPrivate: PrivateKey, selfPublicKey: ByteArray,
        expectedPeerPublicKey: ByteArray? = null,
    ): Result = perform(input, output, selfId, selfName, selfPrivate, selfPublicKey, true, expectedPeerPublicKey)

    fun performResponder(
        input: InputStream, output: OutputStream,
        selfId: String, selfName: String,
        selfPrivate: PrivateKey, selfPublicKey: ByteArray,
        expectedPeerPublicKey: ByteArray? = null,
    ): Result = perform(input, output, selfId, selfName, selfPrivate, selfPublicKey, false, expectedPeerPublicKey)

    private fun perform(
        input: InputStream, output: OutputStream,
        selfId: String, selfName: String,
        selfPrivate: PrivateKey, selfPublicKey: ByteArray,
        initiator: Boolean,
        expectedPeerPublicKey: ByteArray?,
    ): Result {
        val selfNonce = ByteArray(NONCE_LEN).also { rng.nextBytes(it) }
        val myHello = WireMessage.Hello(selfId, selfName, WireMessage.PROTOCOL_VERSION, selfPublicKey, selfNonce)
        val peerHello: WireMessage.Hello
        if (initiator) {
            Frame.write(output, WireMessage.encode(myHello))
            peerHello = readHello(input)
        } else {
            peerHello = readHello(input)
            Frame.write(output, WireMessage.encode(myHello))
        }
        require(peerHello.protocolVersion == WireMessage.PROTOCOL_VERSION) {
            "protocol mismatch: ${peerHello.protocolVersion}"
        }
        if (expectedPeerPublicKey != null) {
            check(peerHello.publicKey.contentEquals(expectedPeerPublicKey)) {
                "peer public key does not match the paired identity — possible impostor"
            }
        }

        val remotePub = KeyExchange.decodePublicKey(peerHello.publicKey)
        val secret = KeyExchange.sharedSecret(selfPrivate, remotePub)

        val initiatorPub = if (initiator) selfPublicKey else peerHello.publicKey
        val responderPub = if (initiator) peerHello.publicKey else selfPublicKey
        val initiatorNonce = if (initiator) selfNonce else peerHello.sessionNonce
        val responderNonce = if (initiator) peerHello.sessionNonce else selfNonce

        // Transcript binds both identities AND both fresh nonces -> unique keys & session id per session.
        val transcript = Fingerprint.sha256(initiatorPub + responderPub + initiatorNonce + responderNonce)
        val keys = KeyExchange.deriveSessionKeys(secret, transcript)
        val sessionId = transcript.copyOfRange(0, 16)

        val channel = if (initiator) {
            SecureChannel(sendKey = keys.initiatorToResponder, recvKey = keys.responderToInitiator, sessionId = sessionId)
        } else {
            SecureChannel(sendKey = keys.responderToInitiator, recvKey = keys.initiatorToResponder, sessionId = sessionId)
        }
        // The SAS binds the two identities (nonces are integrity-covered by the derived keys).
        val sas = Fingerprint.shortAuthString(initiatorPub, responderPub)
        return Result(channel, peerHello.deviceId, peerHello.displayName, peerHello.publicKey, sas, sessionId)
    }

    private fun readHello(input: InputStream): WireMessage.Hello {
        val frame = Frame.read(input) ?: error("peer closed before Hello")
        val msg = WireMessage.decode(frame)
        return msg as? WireMessage.Hello ?: error("expected Hello, got ${msg.type}")
    }

    fun sessionIdHex(sessionId: ByteArray): String = sessionId.joinToString("") { "%02x".format(it) }
}
