package com.nexusx.companion

import android.app.Application
import com.nexusx.companion.data.CompanionIdentity
import com.nexusx.core.crypto.AndroidKeyVault
import com.nexusx.core.db.NexusDatabase

class NexusCompanionApp : Application() {
    lateinit var database: NexusDatabase; private set
    lateinit var identity: CompanionIdentity; private set
    lateinit var keyVault: AndroidKeyVault; private set

    override fun onCreate() {
        super.onCreate()
        database = NexusDatabase.get(this)
        identity = CompanionIdentity(this)
        keyVault = AndroidKeyVault()
    }
}
