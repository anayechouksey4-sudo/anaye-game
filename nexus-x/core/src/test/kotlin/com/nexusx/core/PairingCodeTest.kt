package com.nexusx.core

import com.google.common.truth.Truth.assertThat
import com.nexusx.core.pairing.PairingCode
import org.junit.Test

class PairingCodeTest {
    @Test fun short_code_is_grouped_nine_digits_and_deterministic() {
        val token = "0123456789abcdef0123456789abcdef"
        val code = PairingCode.shortCode(token)
        assertThat(code).matches("\\d{3} \\d{3} \\d{3}")
        assertThat(PairingCode.shortCode(token)).isEqualTo(code)
    }

    @Test fun matching_accepts_spaces_and_rejects_wrong() {
        val token = PairingCode.newToken()
        val code = PairingCode.shortCode(token)
        assertThat(PairingCode.shortCodeMatches(token, code)).isTrue()
        assertThat(PairingCode.shortCodeMatches(token, "000 000 000")).isFalse()
    }

    @Test fun tokens_are_unique() {
        val tokens = (1..100).map { PairingCode.newToken() }.toSet()
        assertThat(tokens).hasSize(100)
    }
}
