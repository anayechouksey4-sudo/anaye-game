package com.nexusx.controller

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.nexusx.controller.ui.LocalVmFactory
import com.nexusx.controller.ui.NexusApp
import com.nexusx.controller.ui.theme.NexusTheme
import com.nexusx.controller.vm.NexusViewModelFactory

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as NexusControllerApp).container
        val factory = NexusViewModelFactory(container)

        setContent {
            NexusTheme {
                var onboarded by remember { mutableStateOf(container.identity.onboarded) }
                CompositionLocalProvider(LocalVmFactory provides factory) {
                    NexusApp(
                        startOnboarding = !onboarded,
                        onOnboarded = {
                            container.identity.onboarded = true
                            onboarded = true
                        },
                    )
                }
            }
        }
    }
}
