package com.nexusx.controller.di

import android.content.Context
import com.nexusx.controller.data.DeviceIdentity
import com.nexusx.controller.data.DeviceRepository
import com.nexusx.controller.data.PairingRepository
import com.nexusx.controller.data.PrivacyRepository
import com.nexusx.controller.data.SessionRepository
import com.nexusx.controller.data.SettingsStore
import com.nexusx.controller.data.TransferRepository
import com.nexusx.core.crypto.AndroidKeyVault
import com.nexusx.core.db.NexusDatabase
import com.nexusx.core.discovery.NetworkInfoProvider
import com.nexusx.core.discovery.NetworkScanner
import com.nexusx.core.monitor.ConnectionMonitor

/** Simple manual dependency container held by the Application; avoids an annotation-processor DI lib. */
class AppContainer(context: Context) {
    private val appContext = context.applicationContext

    val database = NexusDatabase.get(appContext)
    val identity = DeviceIdentity(appContext)
    val keyVault = AndroidKeyVault()
    val settings = SettingsStore(appContext)

    private val networkInfoProvider = NetworkInfoProvider(appContext)
    private val scanner = NetworkScanner(appContext, networkInfoProvider)
    private val monitor = ConnectionMonitor()

    val deviceRepository = DeviceRepository(
        scanner, networkInfoProvider, monitor,
        database.deviceDao(), database.observationDao(), database.pairingDao(),
    )
    val pairingRepository = PairingRepository(database.pairingDao(), keyVault, identity.id, identity.name)
    val sessionRepository = SessionRepository(database.sessionDao())
    val transferRepository = TransferRepository(database.transferDao())
    val privacyRepository = PrivacyRepository(appContext, database.privacyDao())
}
