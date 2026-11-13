package com.nexusx.core.net.wire

import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.io.InputStream
import java.io.OutputStream

/**
 * Length-prefixed framing for the NEXUS X stream protocol: a 4-byte big-endian length followed by
 * that many bytes. A hard cap guards against a peer claiming an enormous frame. Every byte on the
 * wire is already AES-GCM sealed by [com.nexusx.core.crypto.SecureChannel]; framing just delimits.
 */
object Frame {
    const val MAX_FRAME_BYTES = 8 * 1024 * 1024 // 8 MiB ceiling per frame

    fun write(out: OutputStream, payload: ByteArray) {
        require(payload.size <= MAX_FRAME_BYTES) { "frame exceeds cap: ${payload.size}" }
        val dos = if (out is DataOutputStream) out else DataOutputStream(out)
        dos.writeInt(payload.size)
        dos.write(payload)
        dos.flush()
    }

    /** Reads one frame, or returns null at a clean end of stream. */
    fun read(input: InputStream): ByteArray? {
        val dis = if (input is DataInputStream) input else DataInputStream(input)
        val len = try { dis.readInt() } catch (e: EOFException) { return null }
        require(len in 0..MAX_FRAME_BYTES) { "frame length out of range: $len" }
        val buf = ByteArray(len)
        dis.readFully(buf)
        return buf
    }
}
