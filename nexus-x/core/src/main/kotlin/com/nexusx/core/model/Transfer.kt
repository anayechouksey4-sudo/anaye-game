package com.nexusx.core.model

enum class TransferDirection { SEND, RECEIVE }
enum class TransferStatus { PENDING, ACTIVE, PAUSED, COMPLETED, FAILED, CANCELLED, VERIFYING }

/** A file transfer between two paired devices, chunked and integrity-checked. */
data class FileTransfer(
    val transferId: String,
    val peerDeviceId: String,
    val fileName: String,
    val mimeType: String?,
    val totalBytes: Long,
    val transferredBytes: Long,
    val direction: TransferDirection,
    val status: TransferStatus,
    /** SHA-256 of the complete file, hex. Known up front for sends, verified for receives. */
    val sha256: String?,
    val startedAtEpochMs: Long,
    val updatedAtEpochMs: Long,
    val error: String? = null,
) {
    val progress: Float
        get() = if (totalBytes <= 0) 0f else (transferredBytes.toFloat() / totalBytes).coerceIn(0f, 1f)
}
