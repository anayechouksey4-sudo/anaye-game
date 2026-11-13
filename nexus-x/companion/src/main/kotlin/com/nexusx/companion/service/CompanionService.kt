package com.nexusx.companion.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.nexusx.companion.NexusCompanionApp
import com.nexusx.companion.R
import com.nexusx.companion.data.CompanionController
import com.nexusx.core.crypto.Fingerprint
import com.nexusx.core.crypto.KeyExchange
import com.nexusx.core.db.entity.PairedDeviceEntity
import com.nexusx.core.discovery.NsdDiscovery
import com.nexusx.core.model.Capability
import com.nexusx.core.model.PairingStatus
import com.nexusx.core.net.Handshake
import com.nexusx.core.net.NexusConnection
import com.nexusx.core.net.NexusServer
import com.nexusx.core.net.wire.WireMessage
import com.nexusx.core.pairing.PairingPayload
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.launch
import java.net.Socket

/**
 * The Companion's always-honest server. It listens for a Controller, performs the responder side of
 * the mutually-authenticated [Handshake], and — crucially — never completes a pairing without an
 * explicit tap on THIS device. The short authentication string is shown to the user to defeat a
 * machine-in-the-middle. Everything it does is reflected in [CompanionController] so the UI can show
 * exactly what is happening.
 */
class CompanionService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var serverJob: Job? = null
    @Volatile private var server: NexusServer? = null
    @Volatile private var nsd: NsdDiscovery? = null
    @Volatile private var nsdListener: android.net.nsd.NsdManager.RegistrationListener? = null
    private val pairingMutex = Mutex()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, buildNotification())
        if (serverJob == null) serverJob = scope.launch { runServer() }
        return START_STICKY
    }

    private suspend fun runServer() {
        val app = application as NexusCompanionApp
        val srv = runCatching { NexusServer(PORT) }.getOrElse { NexusServer(0) }
        server = srv
        val localIp = localIpv4()
        CompanionController.setServerRunning(true, "${localIp ?: "?"}:${srv.port}")
        CompanionController.setPairedCount(app.database.pairingDao().getAll().size)

        nsd = NsdDiscovery(this).also { d ->
            nsdListener = runCatching { d.registerCompanion("NEXUS X ${app.identity.name}", srv.port) }.getOrNull()
        }

        while (serverJobActive()) {
            val socket = runCatching { srv.accept() }.getOrNull() ?: break
            scope.launch { handleConnection(socket) }
        }
    }

    private fun serverJobActive(): Boolean = serverJob?.isActive == true

    private suspend fun handleConnection(socket: Socket) {
        val app = application as NexusCompanionApp
        socket.use { s ->
            val input = s.getInputStream(); val output = s.getOutputStream()
            val selfPriv = app.keyVault.identityPrivateKey()
            val selfPub = KeyExchange.encodePublicKey(app.keyVault.identityPublicKey())
            val result = runCatching {
                Handshake.performResponder(input, output, app.identity.id, app.identity.name, selfPriv, selfPub)
            }.getOrNull() ?: return
            val conn = NexusConnection(input, output, result.channel, result.peerId, result.peerName)

            // Authorize this connection against a stored pairing. A device is "authorized" only if an
            // ACTIVE pairing exists AND the handshake peer key matches the one we stored at pairing
            // time (key pinning). An impostor reusing a known device id but a different key is rejected.
            val stored = runCatching { app.database.pairingDao().find(result.peerId) }.getOrNull()
            val peerKeyB64 = PairingPayload.publicKeyToB64(result.peerPublicKey)
            if (stored != null && stored.status == PairingStatus.ACTIVE.name && stored.remotePublicKey != peerKeyB64) {
                runCatching { conn.send(WireMessage.ErrorMsg(403, "identity key does not match the stored pairing")) }
                return // reject impostor
            }
            val authorized = stored != null && stored.status == PairingStatus.ACTIVE.name && stored.remotePublicKey == peerKeyB64

            while (!conn.isClosed) {
                val msg = runCatching { conn.receive() }.getOrNull() ?: break
                when (msg) {
                    // PairRequest is the only message allowed from an unpaired peer (it drives the
                    // on-device approval flow). Everything else requires an authorized pairing.
                    is WireMessage.PairRequest -> handlePairRequest(conn, result, app)
                    is WireMessage.Ping -> if (authorized) runCatching { conn.send(WireMessage.Pong(msg.nonce)) }
                    is WireMessage.ScreenStart -> if (authorized)
                        CompanionController.setActiveShare(CompanionController.ActiveShare(result.peerName, System.currentTimeMillis()))
                    is WireMessage.ScreenStop -> if (authorized) CompanionController.setActiveShare(null)
                    else -> if (!authorized) runCatching { conn.send(WireMessage.ErrorMsg(401, "not paired")) }
                }
            }
        }
    }

    private suspend fun handlePairRequest(conn: NexusConnection, hs: Handshake.Result, app: NexusCompanionApp) {
        // Serialize pairing: only one request may own the shared approval UI/callbacks at a time, so a
        // second concurrent Controller cannot clobber the first's continuation and leave it hung.
        pairingMutex.withLock {
            val decision = Channel<Boolean>(1)
            CompanionController.onApprovePairing = { decision.trySend(true) }
            CompanionController.onRejectPairing = { decision.trySend(false) }
            CompanionController.setPendingPairing(
                CompanionController.PendingPairing(hs.peerId, hs.peerName, hs.shortAuthString)
            )
            val approved = try { decision.receive() } finally {
                CompanionController.setPendingPairing(null)
                CompanionController.onApprovePairing = null
                CompanionController.onRejectPairing = null
            }
            persistDecision(conn, hs, app, approved)
        }
    }

    private suspend fun persistDecision(conn: NexusConnection, hs: Handshake.Result, app: NexusCompanionApp, approved: Boolean) {
        if (approved) {
            val now = System.currentTimeMillis()
            app.database.pairingDao().upsert(
                PairedDeviceEntity(
                    deviceId = hs.peerId, displayName = hs.peerName,
                    remotePublicKey = PairingPayload.publicKeyToB64(hs.peerPublicKey),
                    fingerprint = Fingerprint.formatFingerprint(hs.peerPublicKey),
                    status = PairingStatus.ACTIVE.name, pairedAtEpochMs = now,
                    expiresAtEpochMs = now + 30L * 24 * 60 * 60 * 1000, lastSeenEpochMs = now,
                    grantedCapabilities = listOf(Capability.PRESENCE.name, Capability.FILE_TRANSFER.name),
                )
            )
            CompanionController.setPairedCount(app.database.pairingDao().getAll().size)
            runCatching { conn.send(WireMessage.PairResult(true, null)) }
        } else {
            runCatching { conn.send(WireMessage.PairResult(false, "declined on device")) }
        }
    }

    private fun localIpv4(): String? = runCatching {
        java.net.NetworkInterface.getNetworkInterfaces().toList().flatMap { it.inetAddresses.toList() }
            .firstOrNull { !it.isLoopbackAddress && it is java.net.Inet4Address }?.hostAddress
    }.getOrNull()

    override fun onDestroy() {
        super.onDestroy()
        nsdListener?.let { l -> nsd?.unregister(l) }
        runCatching { server?.close() }
        serverJob?.cancel()
        scope.cancel() // cancels the accept loop AND all per-connection handler coroutines
        CompanionController.setServerRunning(false, null)
    }

    private fun buildNotification(): android.app.Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
                mgr.createNotificationChannel(NotificationChannel(CHANNEL_ID, getString(R.string.companion_channel), NotificationManager.IMPORTANCE_LOW))
            }
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.app_name))
            .setContentText("Ready to pair — approvals happen on this device")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true).setPriority(NotificationCompat.PRIORITY_LOW).build()
    }

    companion object {
        const val PORT = 62080
        private const val CHANNEL_ID = "nexusx_companion"
        private const val NOTIFICATION_ID = 7301
        fun start(context: Context) {
            val i = Intent(context, CompanionService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(i) else context.startService(i)
        }
    }
}
