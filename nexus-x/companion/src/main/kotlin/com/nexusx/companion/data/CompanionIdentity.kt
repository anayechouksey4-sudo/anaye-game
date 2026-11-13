package com.nexusx.companion.data

import android.content.Context
import android.os.Build
import com.nexusx.core.util.Ids

class CompanionIdentity(context: Context) {
    private val prefs = context.getSharedPreferences("nexusx_companion_identity", Context.MODE_PRIVATE)
    val id: String by lazy {
        prefs.getString("id", null) ?: Ids.random("comp").also { prefs.edit().putString("id", it).apply() }
    }
    val name: String by lazy {
        listOf(Build.MANUFACTURER, Build.MODEL).filter { it.isNotBlank() }.joinToString(" ").ifBlank { "NEXUS X Companion" }
    }
}
