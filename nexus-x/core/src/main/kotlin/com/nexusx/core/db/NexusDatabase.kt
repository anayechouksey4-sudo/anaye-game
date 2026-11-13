package com.nexusx.core.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.nexusx.core.db.dao.DeviceDao
import com.nexusx.core.db.dao.ObservationDao
import com.nexusx.core.db.dao.PairingDao
import com.nexusx.core.db.dao.PrivacyDao
import com.nexusx.core.db.dao.SessionDao
import com.nexusx.core.db.dao.TransferDao
import com.nexusx.core.db.entity.DeviceEntity
import com.nexusx.core.db.entity.ObservationWindowEntity
import com.nexusx.core.db.entity.PairedDeviceEntity
import com.nexusx.core.db.entity.PrivacyMessageEntity
import com.nexusx.core.db.entity.SessionLogEntity
import com.nexusx.core.db.entity.TransferEntity

@Database(
    entities = [
        DeviceEntity::class,
        ObservationWindowEntity::class,
        PairedDeviceEntity::class,
        SessionLogEntity::class,
        TransferEntity::class,
        PrivacyMessageEntity::class,
    ],
    version = 1,
    exportSchema = false,
)
@TypeConverters(Converters::class)
abstract class NexusDatabase : RoomDatabase() {
    abstract fun deviceDao(): DeviceDao
    abstract fun observationDao(): ObservationDao
    abstract fun pairingDao(): PairingDao
    abstract fun sessionDao(): SessionDao
    abstract fun transferDao(): TransferDao
    abstract fun privacyDao(): PrivacyDao

    companion object {
        @Volatile private var instance: NexusDatabase? = null

        fun get(context: Context): NexusDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    NexusDatabase::class.java,
                    "nexusx.db",
                ).fallbackToDestructiveMigration().build().also { instance = it }
            }
    }
}
