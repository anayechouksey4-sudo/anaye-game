package com.nexusx.core.net.wire

/**
 * The NEXUS X application protocol. Each message is a type byte followed by a typed body. Messages
 * are encoded with [WireWriter]/[WireReader], framed by [Frame], and (except the pairing handshake's
 * key-establishment messages) carried inside a [com.nexusx.core.crypto.SecureChannel].
 *
 * The protocol is deliberately explicit: there is no "silent" control message. Screen sharing and
 * file transfer each begin with an offer the receiving side must accept.
 */
sealed class WireMessage {
    abstract val type: Int

    /** First message on any connection: who I am and what I can do. */
    data class Hello(
        val deviceId: String,
        val displayName: String,
        val protocolVersion: Int,
        val publicKey: ByteArray,
        /** Per-session random nonce mixed into key derivation so session keys are never reused. */
        val sessionNonce: ByteArray,
    ) : WireMessage() { override val type = HELLO }

    /** Controller -> Companion: begin pairing, proving possession of the issued token. */
    data class PairRequest(
        val deviceId: String,
        val displayName: String,
        val publicKey: ByteArray,
        val token: String,
    ) : WireMessage() { override val type = PAIR_REQUEST }

    /** Companion -> Controller: its identity + the SAS it computed, pending user approval. */
    data class PairResponse(
        val deviceId: String,
        val displayName: String,
        val publicKey: ByteArray,
        val shortAuthString: String,
    ) : WireMessage() { override val type = PAIR_RESPONSE }

    /** Companion -> Controller: the user tapped Approve (or Reject). */
    data class PairResult(val approved: Boolean, val reason: String?) : WireMessage() { override val type = PAIR_RESULT }

    data class Ping(val nonce: Long) : WireMessage() { override val type = PING }
    data class Pong(val nonce: Long) : WireMessage() { override val type = PONG }

    /** Request to start screen sharing; the receiver must grant MediaProjection + approve. */
    data class ScreenStart(val sessionId: String, val reason: String) : WireMessage() { override val type = SCREEN_START }
    data class ScreenStop(val sessionId: String) : WireMessage() { override val type = SCREEN_STOP }
    data class ScreenConfig(val width: Int, val height: Int, val fps: Int) : WireMessage() { override val type = SCREEN_CONFIG }
    /** One encoded frame (e.g. JPEG) of the shared screen. */
    data class ScreenFrame(val seq: Long, val tsMs: Long, val image: ByteArray) : WireMessage() { override val type = SCREEN_FRAME }

    data class FileOffer(
        val transferId: String, val fileName: String, val mimeType: String?, val totalBytes: Long, val sha256: String,
    ) : WireMessage() { override val type = FILE_OFFER }
    data class FileAccept(val transferId: String, val resumeFromByte: Long) : WireMessage() { override val type = FILE_ACCEPT }
    data class FileReject(val transferId: String, val reason: String) : WireMessage() { override val type = FILE_REJECT }
    data class FileChunk(val transferId: String, val offset: Long, val data: ByteArray) : WireMessage() { override val type = FILE_CHUNK }
    data class FileComplete(val transferId: String, val sha256: String) : WireMessage() { override val type = FILE_COMPLETE }

    data class ErrorMsg(val code: Int, val message: String) : WireMessage() { override val type = ERROR }

    companion object {
        const val PROTOCOL_VERSION = 1

        const val HELLO = 1
        const val PAIR_REQUEST = 2
        const val PAIR_RESPONSE = 3
        const val PAIR_RESULT = 4
        const val PING = 5
        const val PONG = 6
        const val SCREEN_START = 10
        const val SCREEN_STOP = 11
        const val SCREEN_CONFIG = 12
        const val SCREEN_FRAME = 13
        const val FILE_OFFER = 20
        const val FILE_ACCEPT = 21
        const val FILE_REJECT = 22
        const val FILE_CHUNK = 23
        const val FILE_COMPLETE = 24
        const val ERROR = 99

        fun encode(m: WireMessage): ByteArray {
            val w = WireWriter().u8(m.type)
            when (m) {
                is Hello -> w.str(m.deviceId).str(m.displayName).int(m.protocolVersion).bytes(m.publicKey).bytes(m.sessionNonce)
                is PairRequest -> w.str(m.deviceId).str(m.displayName).bytes(m.publicKey).str(m.token)
                is PairResponse -> w.str(m.deviceId).str(m.displayName).bytes(m.publicKey).str(m.shortAuthString)
                is PairResult -> w.bool(m.approved).strOrNull(m.reason)
                is Ping -> w.long(m.nonce)
                is Pong -> w.long(m.nonce)
                is ScreenStart -> w.str(m.sessionId).str(m.reason)
                is ScreenStop -> w.str(m.sessionId)
                is ScreenConfig -> w.int(m.width).int(m.height).int(m.fps)
                is ScreenFrame -> w.long(m.seq).long(m.tsMs).bytes(m.image)
                is FileOffer -> w.str(m.transferId).str(m.fileName).strOrNull(m.mimeType).long(m.totalBytes).str(m.sha256)
                is FileAccept -> w.str(m.transferId).long(m.resumeFromByte)
                is FileReject -> w.str(m.transferId).str(m.reason)
                is FileChunk -> w.str(m.transferId).long(m.offset).bytes(m.data)
                is FileComplete -> w.str(m.transferId).str(m.sha256)
                is ErrorMsg -> w.int(m.code).str(m.message)
            }
            return w.toByteArray()
        }

        fun decode(data: ByteArray): WireMessage {
            val r = WireReader(data)
            return when (val t = r.u8()) {
                HELLO -> Hello(r.str(), r.str(), r.int(), r.bytes(), r.bytes())
                PAIR_REQUEST -> PairRequest(r.str(), r.str(), r.bytes(), r.str())
                PAIR_RESPONSE -> PairResponse(r.str(), r.str(), r.bytes(), r.str())
                PAIR_RESULT -> PairResult(r.bool(), r.strOrNull())
                PING -> Ping(r.long())
                PONG -> Pong(r.long())
                SCREEN_START -> ScreenStart(r.str(), r.str())
                SCREEN_STOP -> ScreenStop(r.str())
                SCREEN_CONFIG -> ScreenConfig(r.int(), r.int(), r.int())
                SCREEN_FRAME -> ScreenFrame(r.long(), r.long(), r.bytes())
                FILE_OFFER -> FileOffer(r.str(), r.str(), r.strOrNull(), r.long(), r.str())
                FILE_ACCEPT -> FileAccept(r.str(), r.long())
                FILE_REJECT -> FileReject(r.str(), r.str())
                FILE_CHUNK -> FileChunk(r.str(), r.long(), r.bytes())
                FILE_COMPLETE -> FileComplete(r.str(), r.str())
                ERROR -> ErrorMsg(r.int(), r.str())
                else -> throw IllegalArgumentException("unknown message type $t")
            }
        }
    }
}
