package com.nexusx.core.model

/** The transport the device is currently attached to. */
enum class NetworkTransport { WIFI, HOTSPOT_LOCAL_ONLY, ETHERNET, CELLULAR, VPN, NONE, UNKNOWN }

/**
 * Snapshot of the local network. Values are only populated where Android actually exposes them
 * without privileged access. On a tethering hotspot, for example, the full client list is not
 * available to a normal app, and [clientListAvailable] reflects that.
 */
data class NetworkInfo(
    val transport: NetworkTransport,
    val ssid: String? = null,
    val localIp: String? = null,
    val gatewayIp: String? = null,
    val subnetPrefixLength: Int? = null,
    val dnsServers: List<String> = emptyList(),
    val isMetered: Boolean = false,
    val isVpnActive: Boolean = false,
    /** True only when the platform can enumerate clients (it usually cannot off-router). */
    val clientListAvailable: Boolean = false,
    /** Number of usable host addresses in the subnet, when a prefix is known. */
    val hostCount: Int? = null,
)
