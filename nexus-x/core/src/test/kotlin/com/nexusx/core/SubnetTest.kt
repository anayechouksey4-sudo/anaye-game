package com.nexusx.core

import com.google.common.truth.Truth.assertThat
import com.nexusx.core.util.Subnet
import org.junit.Test

class SubnetTest {
    @Test fun ip_int_roundtrip() {
        val v = Subnet.ipToInt("192.168.1.42")
        assertThat(Subnet.intToIp(v)).isEqualTo("192.168.1.42")
    }

    @Test fun slash24_has_254_hosts_excluding_self() {
        val hosts = Subnet.hostAddresses("192.168.1.100", 24)
        assertThat(hosts).hasSize(254)
        assertThat(hosts).contains("192.168.1.1")
        assertThat(hosts).contains("192.168.1.254")
        assertThat(hosts).doesNotContain("192.168.1.0")
        assertThat(hosts).doesNotContain("192.168.1.255")
    }

    @Test(expected = IllegalArgumentException::class)
    fun refuses_wider_than_slash16() {
        Subnet.hostAddresses("10.0.0.1", 8)
    }
}
