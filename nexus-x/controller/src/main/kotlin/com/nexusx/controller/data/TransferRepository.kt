package com.nexusx.controller.data

import com.nexusx.core.db.dao.TransferDao
import com.nexusx.core.db.entity.TransferEntity
import com.nexusx.core.model.FileTransfer
import com.nexusx.core.model.TransferDirection
import com.nexusx.core.model.TransferStatus
import com.nexusx.core.util.Clock
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/** Persists and observes file transfers (Module 6). The byte movement runs in the session layer. */
class TransferRepository(
    private val transferDao: TransferDao,
    private val clock: Clock = Clock.SYSTEM,
) {
    val transfers: Flow<List<FileTransfer>> = transferDao.observeAll().map { list -> list.map { it.toModel() } }

    suspend fun start(transfer: FileTransfer) = transferDao.upsert(transfer.toEntity())

    suspend fun progress(id: String, bytes: Long, status: TransferStatus) =
        transferDao.progress(id, bytes, status.name, clock.nowMs())

    suspend fun find(id: String): FileTransfer? = transferDao.find(id)?.toModel()
}

private fun FileTransfer.toEntity() = TransferEntity(
    transferId = transferId, peerDeviceId = peerDeviceId, fileName = fileName, mimeType = mimeType,
    totalBytes = totalBytes, transferredBytes = transferredBytes, direction = direction.name, status = status.name,
    sha256 = sha256, startedAtEpochMs = startedAtEpochMs, updatedAtEpochMs = updatedAtEpochMs, error = error,
)

private fun TransferEntity.toModel() = FileTransfer(
    transferId = transferId, peerDeviceId = peerDeviceId, fileName = fileName, mimeType = mimeType,
    totalBytes = totalBytes, transferredBytes = transferredBytes,
    direction = runCatching { TransferDirection.valueOf(direction) }.getOrDefault(TransferDirection.SEND),
    status = runCatching { TransferStatus.valueOf(status) }.getOrDefault(TransferStatus.PENDING),
    sha256 = sha256, startedAtEpochMs = startedAtEpochMs, updatedAtEpochMs = updatedAtEpochMs, error = error,
)
