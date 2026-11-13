package com.nexusx.controller.ui.util

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object Format {
    fun duration(ms: Long): String {
        if (ms <= 0) return "0s"
        val s = ms / 1000; val h = s / 3600; val m = (s % 3600) / 60; val sec = s % 60
        return when {
            h > 0 -> "${h}h ${m}m"
            m > 0 -> "${m}m ${sec}s"
            else -> "${sec}s"
        }
    }

    fun relativeTime(epochMs: Long, nowMs: Long = System.currentTimeMillis()): String {
        val diff = nowMs - epochMs
        return when {
            diff < 60_000 -> "just now"
            diff < 3_600_000 -> "${diff / 60_000}m ago"
            diff < 86_400_000 -> "${diff / 3_600_000}h ago"
            else -> "${diff / 86_400_000}d ago"
        }
    }

    private val clock = SimpleDateFormat("HH:mm", Locale.getDefault())
    private val dayClock = SimpleDateFormat("MMM d, HH:mm", Locale.getDefault())
    fun time(epochMs: Long): String = clock.format(Date(epochMs))
    fun dayTime(epochMs: Long?): String = if (epochMs == null) "—" else dayClock.format(Date(epochMs))

    fun bytes(n: Long): String {
        if (n < 1024) return "$n B"
        val kb = n / 1024.0
        if (kb < 1024) return "%.0f KB".format(kb)
        val mb = kb / 1024.0
        if (mb < 1024) return "%.1f MB".format(mb)
        return "%.2f GB".format(mb / 1024.0)
    }
}
