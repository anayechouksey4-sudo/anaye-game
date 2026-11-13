package com.nexusx.controller.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.nexusx.controller.NexusControllerApp
import com.nexusx.controller.R

/**
 * Keeps network discovery running while the user wants it, with a persistent foreground notification
 * so the activity is always visible to the user (no hidden background scanning). The actual scan loop
 * lives in [com.nexusx.controller.data.DeviceRepository]; this service just keeps the process alive
 * and honest about what it is doing.
 */
class DiscoveryService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ensureChannel()
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.discovery_active))
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        startForeground(NOTIFICATION_ID, notification)

        val container = (application as NexusControllerApp).container
        container.deviceRepository.setAutoScan(true, 60_000)
        return START_STICKY
    }

    /**
     * Android 15 (API 35) enforces a ~6-hour cap on dataSync foreground services and calls this; not
     * handling it throws. We stop the foreground gracefully. Background scanning resumes next time the
     * user opens the app.
     */
    override fun onTimeout(startId: Int, fgsType: Int) {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
                mgr.createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, getString(R.string.discovery_channel_name), NotificationManager.IMPORTANCE_LOW)
                )
            }
        }
    }

    companion object {
        private const val CHANNEL_ID = "nexusx_discovery"
        private const val NOTIFICATION_ID = 4201

        fun start(context: Context) {
            val intent = Intent(context, DiscoveryService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
        }
        fun stop(context: Context) { context.stopService(Intent(context, DiscoveryService::class.java)) }
    }
}
