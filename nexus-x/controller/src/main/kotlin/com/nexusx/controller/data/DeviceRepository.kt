package com.nexusx.controller.data

import com.nexusx.core.db.dao.DeviceDao
import com.nexusx.core.db.dao.ObservationDao
import com.nexusx.core.db.dao.PairingDao
import com.nexusx.core.db.entity.DeviceEntity
import com.nexusx.core.db.entity.ObservationWindowEntity
import com.nexusx.core.discovery.NetworkInfoProvider
import com.nexusx.core.discovery.NetworkScanner
import com.nexusx.core.model.DiscoveredDevice
import com.nexusx.core.model.NetworkInfo
import com.nexusx.core.model.NetworkTransport
import com.nexusx.core.model.ObservationSummary
import com.nexusx.core.monitor.ConnectionMonitor
import com.nexusx.core.util.Clock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The dashboard's single source of truth for discovered devices. It drives the [NetworkScanner],
 * feeds sightings into the [ConnectionMonitor] (Module 2), and persists both devices and observation
 * windows so history survives restarts. Everything it reports is measured, never fabricated.
 */
class DeviceRepository(
    private val scanner: NetworkScanner,
    private val networkInfoProvider: NetworkInfoProvider,
    private val monitor: ConnectionMonitor,
    private val deviceDao: DeviceDao,
    private val observationDao: ObservationDao,
    private val pairingDao: PairingDao,
    private val clock: Clock = Clock.SYSTEM,
) {
    private val _devices = MutableStateFlow<List<DiscoveredDevice>>(emptyList())
    val devices: StateFlow<List<DiscoveredDevice>> = _devices.asStateFlow()

    private val _networkInfo = MutableStateFlow(NetworkInfo(NetworkTransport.UNKNOWN))
    val networkInfo: StateFlow<NetworkInfo> = _networkInfo.asStateFlow()

    private val _summaries = MutableStateFlow<Map<String, ObservationSummary>>(emptyMap())
    val summaries: StateFlow<Map<String, ObservationSummary>> = _summaries.asStateFlow()

    private val _scanning = MutableStateFlow(false)
    val scanning: StateFlow<Boolean> = _scanning.asStateFlow()

    private val repoScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var loopJob: Job? = null

    /** Starts (or restarts) the periodic scan loop at [intervalMs], or stops it when [enabled] is false. */
    fun setAutoScan(enabled: Boolean, intervalMs: Long) {
        loopJob?.cancel()
        if (!enabled) return
        loopJob = repoScope.launch {
            runCatching { loadPersisted() }
            while (isActive) {
                runCatching { scanOnce() }
                delay(intervalMs.coerceAtLeast(15_000))
            }
        }
    }

    suspend fun loadPersisted() {
        deviceDao.getAll().forEach { e ->
            observationDao.windowsFor(e.id).map {
                com.nexusx.core.model.ObservationWindow(it.id, it.deviceId, it.startEpochMs, it.endEpochMs, it.confirmed)
            }.takeIf { it.isNotEmpty() }?.let { monitor.loadWindows(e.id, it) }
        }
        recomputeSummaries()
    }

    suspend fun scanOnce() {
        _scanning.value = true
        try {
            _networkInfo.value = networkInfoProvider.current()
            val paired = pairingDao.getAll().map { it.remotePublicKey }.toSet()
            val found = scanner.scanOnce(paired)
            val now = clock.nowMs()
            // Only devices actually observed THIS scan get a sighting. scanOnce() returns the full
            // accumulated map (including devices aged to STALE); recording sightings for those would
            // fabricate continuous observation. A device seen this round has lastSeenEpochMs == now.
            val observedNow = found.filter { it.lastSeenEpochMs == now }
            observedNow.forEach { d ->
                monitor.recordSighting(d.id, now, confirmed = d.isPaired)
            }
            persist(found, observedNow)
            _devices.value = found
            recomputeSummaries()
        } finally {
            _scanning.value = false
        }
    }

    private suspend fun persist(devices: List<DiscoveredDevice>, observedNow: List<DiscoveredDevice>) {
        deviceDao.upsertAll(devices.map { it.toEntity() })
        // Persist observation windows only for devices whose windows changed this scan.
        observedNow.forEach { d ->
            val windows = monitor.windowsFor(d.id)
            if (windows.isNotEmpty()) {
                observationDao.deleteForDevice(d.id)
                observationDao.insertAll(windows.map {
                    ObservationWindowEntity(deviceId = it.deviceId, startEpochMs = it.startEpochMs, endEpochMs = it.endEpochMs, confirmed = it.confirmed)
                })
            }
        }
    }

    private fun recomputeSummaries() {
        _summaries.value = monitor.allSummaries().associateBy { it.deviceId }
    }

    fun deviceById(id: String): DiscoveredDevice? = _devices.value.firstOrNull { it.id == id }
    fun summaryFor(id: String): ObservationSummary? = _summaries.value[id]
    fun windowsFor(id: String) = monitor.windowsFor(id)
}

private fun DiscoveredDevice.toEntity() = DeviceEntity(
    id = id, ipAddress = ipAddress, macAddress = macAddress, hostname = hostname, vendor = vendor,
    source = source.name, confidence = confidence.name, reachability = reachability.name,
    latencyMs = latencyMs, openPorts = openPorts, firstSeenEpochMs = firstSeenEpochMs,
    lastSeenEpochMs = lastSeenEpochMs, isPaired = isPaired,
)
