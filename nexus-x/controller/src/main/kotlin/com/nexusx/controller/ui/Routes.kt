package com.nexusx.controller.ui

object Routes {
    const val ONBOARDING = "onboarding"
    const val PERMISSIONS = "permissions"
    const val OVERVIEW = "overview"
    const val DISCOVERY = "discovery"
    const val DEVICE_DETAIL = "device/{deviceId}"
    const val HISTORY = "history"
    const val PAIRING = "pairing"
    const val REMOTE = "remote"
    const val TRANSFER = "transfer"
    const val PRIVACY = "privacy"
    const val SETTINGS = "settings"
    const val DIAGNOSTICS = "diagnostics"
    const val MORE = "more"

    fun deviceDetail(id: String) = "device/$id"
}
