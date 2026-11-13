package com.nexusx.controller.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore("nexusx_settings")

/** User-tunable settings, persisted with DataStore. */
class SettingsStore(private val context: Context) {
    data class Settings(
        val scanIntervalMs: Long = 60_000,
        val autoScan: Boolean = true,
        val showInferredDevices: Boolean = true,
    )

    private val KEY_INTERVAL = longPreferencesKey("scan_interval_ms")
    private val KEY_AUTOSCAN = booleanPreferencesKey("auto_scan")
    private val KEY_SHOW_INFERRED = booleanPreferencesKey("show_inferred")

    val settings: Flow<Settings> = context.dataStore.data.map { p ->
        Settings(
            scanIntervalMs = p[KEY_INTERVAL] ?: 60_000,
            autoScan = p[KEY_AUTOSCAN] ?: true,
            showInferredDevices = p[KEY_SHOW_INFERRED] ?: true,
        )
    }

    suspend fun setScanInterval(ms: Long) { context.dataStore.edit { it[KEY_INTERVAL] = ms } }
    suspend fun setAutoScan(on: Boolean) { context.dataStore.edit { it[KEY_AUTOSCAN] = on } }
    suspend fun setShowInferred(on: Boolean) { context.dataStore.edit { it[KEY_SHOW_INFERRED] = on } }
}
