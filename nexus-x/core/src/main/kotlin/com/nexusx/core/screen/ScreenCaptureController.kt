package com.nexusx.core.screen

import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.os.Handler
import android.os.HandlerThread
import java.io.ByteArrayOutputStream

/**
 * Captures the screen through Android [MediaProjection] and emits encoded JPEG frames. Screen capture
 * on Android ALWAYS requires the user to grant projection through the system dialog first; this class
 * only runs once the app has that grant, and the owning app shows a persistent capture indicator and
 * a foreground-service notification for the entire session. There is no way to capture without the
 * grant, and we do not attempt one.
 *
 * Frames are produced by rendering the display into an [ImageReader] surface and compressing the
 * latest image. The encoded frames are sent over the already-authenticated [com.nexusx.core.net]
 * channel. (A production build can upgrade the transport to WebRTC/H.264 for adaptive bitrate; the
 * frame-producer contract here is the same.) Device-only: not exercised by JVM unit tests.
 */
class ScreenCaptureController(
    private val projection: MediaProjection,
    private val width: Int,
    private val height: Int,
    private val densityDpi: Int,
    private val jpegQuality: Int = 55,
) {
    private var imageReader: ImageReader? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var frameSeq = 0L
    private var handlerThread: HandlerThread? = null

    fun start(onFrame: (jpeg: ByteArray, seq: Long, tsMs: Long) -> Unit) {
        val thread = HandlerThread("NexusXCapture").also { it.start() }
        handlerThread = thread
        val handler = Handler(thread.looper)
        val reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        imageReader = reader
        reader.setOnImageAvailableListener({ r ->
            val image = r.acquireLatestImage() ?: return@setOnImageAvailableListener
            try {
                val jpeg = encode(image)
                onFrame(jpeg, frameSeq++, System.currentTimeMillis())
            } catch (_: Throwable) {
                // Drop a bad frame rather than tearing down the session.
            } finally {
                image.close()
            }
        }, handler)

        virtualDisplay = projection.createVirtualDisplay(
            "NexusXScreen",
            width, height, densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.surface, null, null,
        )
    }

    fun stop() {
        runCatching { virtualDisplay?.release() }
        runCatching { imageReader?.close() }
        runCatching { projection.stop() }
        runCatching { handlerThread?.quitSafely() }
        virtualDisplay = null
        imageReader = null
        handlerThread = null
    }

    private fun encode(image: Image): ByteArray {
        val plane = image.planes[0]
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val rowPadding = rowStride - pixelStride * width
        val bmp = Bitmap.createBitmap(width + rowPadding / pixelStride, height, Bitmap.Config.ARGB_8888)
        bmp.copyPixelsFromBuffer(plane.buffer)
        val cropped = if (rowPadding == 0) bmp else Bitmap.createBitmap(bmp, 0, 0, width, height)
        val bos = ByteArrayOutputStream()
        cropped.compress(Bitmap.CompressFormat.JPEG, jpegQuality, bos)
        if (cropped !== bmp) cropped.recycle()
        bmp.recycle()
        return bos.toByteArray()
    }
}
