package com.nexusx.controller.data

import android.content.Context
import android.os.Build
import com.nexusx.core.util.Ids

/** A stable local identity for this installation: a random device id and a human display name. */
class DeviceIdentity(context: Context) {
    private val prefs = context.getSharedPreferences("nexusx_identity", Context.MODE_PRIVATE)

    val id: String by lazy {
        prefs.getString(KEY_ID, null) ?: Ids.random("ctrl").also { prefs.edit().putString(KEY_ID, it).apply() }
    }

    val name: String by lazy {
        prefs.getString(KEY_NAME, null) ?: defaultName().also { prefs.edit().putString(KEY_NAME, it).apply() }
    }

    fun rename(newName: String) = prefs.edit().putString(KEY_NAME, newName).apply()

    var onboarded: Boolean
        get() = prefs.getBoolean(KEY_ONBOARDED, false)
        set(value) { prefs.edit().putBoolean(KEY_ONBOARDED, value).apply() }

    private fun defaultName(): String =
        listOf(Build.MANUFACTURER, Build.MODEL).filter { it.isNotBlank() }.joinToString(" ").ifBlank { "NEXUS X Controller" }

    companion object {
        private const val KEY_ID = "device_id"
        private const val KEY_NAME = "device_name"
        private const val KEY_ONBOARDED = "onboarded"
    }
}
