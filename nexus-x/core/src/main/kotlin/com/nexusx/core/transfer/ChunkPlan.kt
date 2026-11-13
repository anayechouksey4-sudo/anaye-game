package com.nexusx.core.transfer

/**
 * Pure chunking arithmetic for file transfer, independent of IO so it can be unit-tested.
 * A transfer is divided into fixed-size chunks; the last chunk may be short. Resume is expressed as
 * a byte offset, which maps to the chunk index to restart from.
 */
object ChunkPlan {
    const val DEFAULT_CHUNK_SIZE = 64 * 1024 // 64 KiB

    fun chunkCount(totalBytes: Long, chunkSize: Int = DEFAULT_CHUNK_SIZE): Long {
        require(chunkSize > 0)
        if (totalBytes <= 0) return 0
        return (totalBytes + chunkSize - 1) / chunkSize
    }

    fun chunkIndexForOffset(offset: Long, chunkSize: Int = DEFAULT_CHUNK_SIZE): Long {
        require(offset >= 0 && chunkSize > 0)
        return offset / chunkSize
    }

    fun offsetForChunk(index: Long, chunkSize: Int = DEFAULT_CHUNK_SIZE): Long = index * chunkSize

    fun sizeOfChunk(index: Long, totalBytes: Long, chunkSize: Int = DEFAULT_CHUNK_SIZE): Int {
        val start = offsetForChunk(index, chunkSize)
        if (start >= totalBytes) return 0
        return minOf(chunkSize.toLong(), totalBytes - start).toInt()
    }

    fun progress(transferredBytes: Long, totalBytes: Long): Float =
        if (totalBytes <= 0) 0f else (transferredBytes.toFloat() / totalBytes).coerceIn(0f, 1f)
}
