package com.nexusx.core

import com.google.common.truth.Truth.assertThat
import com.nexusx.core.net.wire.WireMessage
import org.junit.Test

class WireMessageTest {
    private fun roundtrip(m: WireMessage): WireMessage = WireMessage.decode(WireMessage.encode(m))

    @Test fun hello_roundtrip() {
        val m = WireMessage.Hello("id1", "Pixel", 1, byteArrayOf(9, 8, 7), byteArrayOf(1, 2, 3, 4))
        val d = roundtrip(m) as WireMessage.Hello
        assertThat(d.deviceId).isEqualTo("id1")
        assertThat(d.displayName).isEqualTo("Pixel")
        assertThat(d.publicKey).isEqualTo(byteArrayOf(9, 8, 7))
        assertThat(d.sessionNonce).isEqualTo(byteArrayOf(1, 2, 3, 4))
    }

    @Test fun file_offer_with_null_mime() {
        val m = WireMessage.FileOffer("tx1", "a.bin", null, 1234L, "abc")
        val d = roundtrip(m) as WireMessage.FileOffer
        assertThat(d.mimeType).isNull()
        assertThat(d.totalBytes).isEqualTo(1234L)
    }

    @Test fun screen_frame_roundtrip() {
        val img = ByteArray(500) { it.toByte() }
        val d = roundtrip(WireMessage.ScreenFrame(5L, 100L, img)) as WireMessage.ScreenFrame
        assertThat(d.seq).isEqualTo(5L)
        assertThat(d.image).isEqualTo(img)
    }

    @Test fun pair_result_roundtrip() {
        val d = roundtrip(WireMessage.PairResult(true, null)) as WireMessage.PairResult
        assertThat(d.approved).isTrue(); assertThat(d.reason).isNull()
    }
}
