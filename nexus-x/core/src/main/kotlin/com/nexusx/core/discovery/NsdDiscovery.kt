package com.nexusx.core.discovery

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

/**
 * Multicast DNS / DNS-SD discovery via Android's NsdManager. It finds NEXUS X Companions (which
 * advertise the `_nexusx._tcp` service) and can also list other mDNS services on the LAN so the
 * dashboard shows named services (printers, media, etc.) that advertise themselves. mDNS presence is
 * reported honestly as service advertisement, not as a confirmed device session.
 */
class NsdDiscovery(context: Context) {
    private val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager

    data class Found(val serviceName: String, val serviceType: String, val host: String?, val port: Int?)

    fun discover(serviceType: String = NEXUSX_SERVICE_TYPE): Flow<Found> = callbackFlow {
        // NsdManager.resolveService handles only one resolve at a time on many Android versions;
        // concurrent calls fail with FAILURE_ALREADY_ACTIVE and silently drop services. Serialize them.
        val queue = java.util.concurrent.ConcurrentLinkedQueue<NsdServiceInfo>()
        val resolving = java.util.concurrent.atomic.AtomicBoolean(false)

        fun pump() {
            if (!resolving.compareAndSet(false, true)) return
            val next = queue.poll()
            if (next == null) { resolving.set(false); return }
            nsd.resolveService(next, object : NsdManager.ResolveListener {
                override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                    resolving.set(false); pump()
                }
                override fun onServiceResolved(resolved: NsdServiceInfo) {
                    trySend(
                        Found(
                            serviceName = resolved.serviceName,
                            serviceType = resolved.serviceType,
                            host = resolved.host?.hostAddress,
                            port = resolved.port,
                        )
                    )
                    resolving.set(false); pump()
                }
            })
        }

        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {}
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) { close() }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onServiceLost(serviceInfo: NsdServiceInfo) {}
            override fun onServiceFound(serviceInfo: NsdServiceInfo) { queue.add(serviceInfo); pump() }
        }
        nsd.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, listener)
        awaitClose { runCatching { nsd.stopServiceDiscovery(listener) } }
    }

    fun registerCompanion(serviceName: String, port: Int): NsdManager.RegistrationListener {
        val info = NsdServiceInfo().apply {
            this.serviceName = serviceName
            this.serviceType = NEXUSX_SERVICE_TYPE
            this.port = port
        }
        val listener = object : NsdManager.RegistrationListener {
            override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {}
            override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {}
            override fun onServiceRegistered(serviceInfo: NsdServiceInfo) {}
            override fun onServiceUnregistered(serviceInfo: NsdServiceInfo) {}
        }
        nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
        return listener
    }

    fun unregister(listener: NsdManager.RegistrationListener) = runCatching { nsd.unregisterService(listener) }

    companion object { const val NEXUSX_SERVICE_TYPE = "_nexusx._tcp." }
}
