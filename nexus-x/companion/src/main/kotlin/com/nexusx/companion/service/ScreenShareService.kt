package com.nexusx.companion.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.nexusx.companion.R
import com.nexusx.companion.data.CompanionController
import com.nexusx.core.screen.ScreenCaptureController

/**
 * Runs screen capture via [MediaProjection] inside a foreground service of type mediaProjection, as
 * Android requires. The projection token can only be obtained from the system capture dialog shown to
 * the user (handed to this service via [EXTRA_RESULT_CODE]/[EXTRA_DATA]); there is no way to capture
 * without it. A persistent notification and the in-app banner stay visible for the whole session, and
 * the user can stop it instantly ([ACTION_STOP] or the in-app button).
 */
class ScreenShareService : Service() {
    private var projection: MediaProjection? = null
    private var capture: ScreenCaptureController? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { stopEverything(); return START_NOT_STICKY }

        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, 0) ?: 0
        val data = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
            intent?.getParcelableExtra(EXTRA_DATA, Intent::class.java)
        else @Suppress("DEPRECATION") intent?.getParcelableExtra(EXTRA_DATA)
        val peer = intent?.getStringExtra(EXTRA_PEER) ?: "a paired device"

        // A MediaProjection grant is single-use and cannot survive process death, so this service must
        // NOT be sticky. On a null-intent restart (no token) we stop instead of showing a false
        // "sharing" notification, which on API 34+ would also trip media-projection FGS enforcement.
        if (resultCode == 0 || data == null) { stopSelf(); return START_NOT_STICKY }

        startForeground(NOTIFICATION_ID, buildNotification())
        val mgr = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val proj = mgr.getMediaProjection(resultCode, data)
        projection = proj
        proj.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() { stopEverything() }
        }, null)
        val dm = resources.displayMetrics
        capture = ScreenCaptureController(proj, dm.widthPixels, dm.heightPixels, dm.densityDpi).also {
            it.start { _, _, _ -> /* frames are forwarded to the active NexusConnection by the session layer */ }
        }
        CompanionController.setActiveShare(CompanionController.ActiveShare(peer, System.currentTimeMillis()))
        CompanionController.onStopShare = { stopEverything() }
        return START_NOT_STICKY
    }

    private fun stopEverything() {
        runCatching { capture?.stop() }
        runCatching { projection?.stop() }
        capture = null; projection = null
        CompanionController.setActiveShare(null)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() { super.onDestroy(); runCatching { capture?.stop() }; CompanionController.setActiveShare(null) }

    private fun buildNotification(): android.app.Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
                mgr.createNotificationChannel(NotificationChannel(CHANNEL_ID, getString(R.string.screen_share_active), NotificationManager.IMPORTANCE_HIGH))
            }
        }
        val stopIntent = Intent(this, ScreenShareService::class.java).apply { action = ACTION_STOP }
        val stopPending = android.app.PendingIntent.getService(
            this, 0, stopIntent,
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.screen_share_active))
            .setContentText("Your screen is being shared")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopPending)
            .setOngoing(true).setPriority(NotificationCompat.PRIORITY_HIGH).build()
    }

    companion object {
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_DATA = "result_data"
        const val EXTRA_PEER = "peer"
        const val ACTION_STOP = "com.nexusx.companion.STOP_SHARE"
        private const val CHANNEL_ID = "nexusx_screen"
        private const val NOTIFICATION_ID = 7302
    }
}
