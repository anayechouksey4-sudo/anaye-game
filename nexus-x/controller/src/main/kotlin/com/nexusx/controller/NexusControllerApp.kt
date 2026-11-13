package com.nexusx.controller

import android.app.Application
import com.nexusx.controller.di.AppContainer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class NexusControllerApp : Application() {
    lateinit var container: AppContainer
        private set

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        appScope.launch {
            val s = container.settings.settings.first()
            container.deviceRepository.setAutoScan(s.autoScan, s.scanIntervalMs)
        }
    }
}
