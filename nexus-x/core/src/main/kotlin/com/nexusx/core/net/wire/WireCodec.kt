package com.nexusx.core.net.wire

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream

/** Minimal, dependency-free typed reader/writer used to (de)serialize [WireMessage] bodies. */
class WireWriter {
    private val bos = ByteArrayOutputStream()
    private val dos = DataOutputStream(bos)
    fun u8(v: Int) = apply { dos.writeByte(v) }
    fun int(v: Int) = apply { dos.writeInt(v) }
    fun long(v: Long) = apply { dos.writeLong(v) }
    fun bool(v: Boolean) = apply { dos.writeBoolean(v) }
    fun str(v: String) = apply { val b = v.toByteArray(Charsets.UTF_8); dos.writeInt(b.size); dos.write(b) }
    fun strOrNull(v: String?) = apply { bool(v != null); if (v != null) str(v) }
    fun bytes(v: ByteArray) = apply { dos.writeInt(v.size); dos.write(v) }
    fun toByteArray(): ByteArray { dos.flush(); return bos.toByteArray() }
}

class WireReader(data: ByteArray) {
    private val dis = DataInputStream(ByteArrayInputStream(data))
    fun u8(): Int = dis.readUnsignedByte()
    fun int(): Int = dis.readInt()
    fun long(): Long = dis.readLong()
    fun bool(): Boolean = dis.readBoolean()
    fun str(): String { val n = dis.readInt(); val b = ByteArray(n); dis.readFully(b); return String(b, Charsets.UTF_8) }
    fun strOrNull(): String? = if (bool()) str() else null
    fun bytes(): ByteArray { val n = dis.readInt(); val b = ByteArray(n); dis.readFully(b); return b }
}
