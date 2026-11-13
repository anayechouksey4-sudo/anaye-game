package com.nexusx.core.util

/** Injectable clock so time-dependent logic (monitor, sessions, expiry) is testable. */
fun interface Clock {
    fun nowMs(): Long
    companion object {
        val SYSTEM = Clock { System.currentTimeMillis() }
    }
}
