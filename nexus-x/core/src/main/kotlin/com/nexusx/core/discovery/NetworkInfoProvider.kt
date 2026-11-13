package com.nexusx.core.discovery

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import com.nexusx.core.model.NetworkInfo
import com.nexusx.core.model.NetworkTransport
import com.nexusx.core.util.Subnet
import java.net.Inet4Address

/**
 * Reports what Android actually exposes about the current network. It is careful not to overclaim:
 * on a phone acting as a hotspot the platform does not hand a normal app the client list, so
 * [NetworkInfo.clientListAvailable] is false and the UI relies on active discovery instead.
 */
class NetworkInfoProvider(private val context: Context) {

    private val cm get() = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    fun current(): NetworkInfo {
        val network = cm.activeNetwork ?: return NetworkInfo(NetworkTransport.NONE)
        val caps = cm.getNetworkCapabilities(network)
        val link = cm.getLinkProperties(network)

        val transport = when {
            caps == null -> NetworkTransport.UNKNOWN
            caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> NetworkTransport.VPN
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> NetworkTransport.WIFI
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> NetworkTransport.ETHERNET
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> NetworkTransport.CELLULAR
            else -> NetworkTransport.UNKNOWN
        }

        val ipv4 = link?.linkAddresses?.firstOrNull { it.address is Inet4Address }
        val localIp = ipv4?.address?.hostAddress
        val prefix = ipv4?.prefixLength
        val gateway = link?.routes?.firstOrNull { it.isDefaultRoute && it.gateway is Inet4Address }
            ?.gateway?.hostAddress
        val dns = link?.dnsServers?.mapNotNull { it.hostAddress }.orEmpty()

        val isVpn = caps?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true
        val metered = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == false

        return NetworkInfo(
            transport = transport,
            ssid = readSsid(caps),
            localIp = localIp,
            gatewayIp = gateway,
            subnetPrefixLength = prefix,
            dnsServers = dns,
            isMetered = metered,
            isVpnActive = isVpn,
            // A regular app can enumerate clients only when it is the router, which it is not here.
            clientListAvailable = false,
            hostCount = prefix?.let { runCatching { Subnet.hostCount(it) }.getOrNull() },
        )
    }

    @Suppress("DEPRECATION")
    private fun readSsid(caps: NetworkCapabilities?): String? {
        // SSID requires location permission at runtime; returns null without it, which we surface honestly.
        return try {
            val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            wifi?.connectionInfo?.ssid?.trim('"')?.takeIf { it.isNotBlank() && it != "<unknown ssid>" }
        } catch (_: Throwable) { null }
    }
}
