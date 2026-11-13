package com.nexusx.controller.ui

import androidx.compose.runtime.compositionLocalOf
import androidx.lifecycle.ViewModelProvider

/** Supplies the shared ViewModel factory to the composition. */
val LocalVmFactory = compositionLocalOf<ViewModelProvider.Factory> {
    error("LocalVmFactory not provided")
}
