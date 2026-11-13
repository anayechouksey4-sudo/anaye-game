package com.nexusx.core

import com.google.common.truth.Truth.assertThat
import com.nexusx.core.net.wire.Frame
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

class FrameTest {
    @Test fun write_then_read() {
        val bos = ByteArrayOutputStream()
        Frame.write(bos, "frame-one".toByteArray())
        Frame.write(bos, "frame-two".toByteArray())
        val input = ByteArrayInputStream(bos.toByteArray())
        assertThat(String(Frame.read(input)!!)).isEqualTo("frame-one")
        assertThat(String(Frame.read(input)!!)).isEqualTo("frame-two")
        assertThat(Frame.read(input)).isNull() // clean EOF
    }

    @Test(expected = IllegalArgumentException::class)
    fun oversize_write_rejected() {
        Frame.write(ByteArrayOutputStream(), ByteArray(Frame.MAX_FRAME_BYTES + 1))
    }
}
