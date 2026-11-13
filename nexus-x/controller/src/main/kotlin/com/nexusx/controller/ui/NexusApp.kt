package com.nexusx.controller.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Hub
import androidx.compose.material.icons.filled.Lan
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.ScreenShare
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.nexusx.controller.ui.screens.DeviceDetailScreen
import com.nexusx.controller.ui.screens.DiagnosticsScreen
import com.nexusx.controller.ui.screens.DiscoveryScreen
import com.nexusx.controller.ui.screens.HistoryScreen
import com.nexusx.controller.ui.screens.MoreScreen
import com.nexusx.controller.ui.screens.OnboardingScreen
import com.nexusx.controller.ui.screens.OverviewScreen
import com.nexusx.controller.ui.screens.PairingScreen
import com.nexusx.controller.ui.screens.PermissionsScreen
import com.nexusx.controller.ui.screens.PrivacyScreen
import com.nexusx.controller.ui.screens.RemoteScreen
import com.nexusx.controller.ui.screens.SettingsScreen
import com.nexusx.controller.ui.screens.TransferScreen
import com.nexusx.controller.ui.theme.NexusColors

private data class NavItem(val route: String, val label: String, val icon: ImageVector)

private val bottomItems = listOf(
    NavItem(Routes.OVERVIEW, "Overview", Icons.Outlined.Dashboard),
    NavItem(Routes.DISCOVERY, "Devices", Icons.Filled.Lan),
    NavItem(Routes.PAIRING, "Pair", Icons.Filled.QrCodeScanner),
    NavItem(Routes.REMOTE, "Remote", Icons.Filled.ScreenShare),
    NavItem(Routes.MORE, "More", Icons.Filled.Hub),
)

@Composable
fun NexusApp(startOnboarding: Boolean, onOnboarded: () -> Unit) {
    val navController = rememberNavController()
    val backStack by navController.currentBackStackEntryAsState()
    val currentRoute = backStack?.destination?.route
    val showBar = currentRoute in bottomItems.map { it.route }

    Scaffold(
        containerColor = NexusColors.Black,
        bottomBar = {
            if (showBar) NavigationBar(containerColor = NexusColors.Obsidian) {
                bottomItems.forEach { item ->
                    val selected = backStack?.destination?.hierarchy?.any { it.route == item.route } == true
                    NavigationBarItem(
                        selected = selected,
                        onClick = {
                            navController.navigate(item.route) {
                                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true; restoreState = true
                            }
                        },
                        icon = { Icon(item.icon, contentDescription = item.label) },
                        label = { Text(item.label) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = NexusColors.Cyan,
                            selectedTextColor = NexusColors.Cyan,
                            indicatorColor = NexusColors.SurfaceElevated,
                            unselectedIconColor = NexusColors.TextMuted,
                            unselectedTextColor = NexusColors.TextMuted,
                        ),
                    )
                }
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = if (startOnboarding) Routes.ONBOARDING else Routes.OVERVIEW,
            modifier = Modifier.padding(padding),
        ) {
            composable(Routes.ONBOARDING) {
                OnboardingScreen(onContinue = { navController.navigate(Routes.PERMISSIONS) })
            }
            composable(Routes.PERMISSIONS) {
                PermissionsScreen(onDone = {
                    onOnboarded()
                    navController.navigate(Routes.OVERVIEW) { popUpTo(Routes.ONBOARDING) { inclusive = true } }
                })
            }
            composable(Routes.OVERVIEW) {
                OverviewScreen(
                    onOpenDevice = { navController.navigate(Routes.deviceDetail(it)) },
                    onSeeAll = { navController.navigate(Routes.DISCOVERY) },
                )
            }
            composable(Routes.DISCOVERY) {
                DiscoveryScreen(onOpenDevice = { navController.navigate(Routes.deviceDetail(it)) })
            }
            composable(Routes.DEVICE_DETAIL) { entry ->
                DeviceDetailScreen(
                    deviceId = entry.arguments?.getString("deviceId").orEmpty(),
                    onBack = { navController.popBackStack() },
                    onPair = { navController.navigate(Routes.PAIRING) },
                )
            }
            composable(Routes.PAIRING) { PairingScreen() }
            composable(Routes.REMOTE) { RemoteScreen() }
            composable(Routes.MORE) {
                MoreScreen(onNavigate = { navController.navigate(it) })
            }
            composable(Routes.HISTORY) { HistoryScreen(onBack = { navController.popBackStack() }) }
            composable(Routes.TRANSFER) { TransferScreen(onBack = { navController.popBackStack() }) }
            composable(Routes.PRIVACY) { PrivacyScreen(onBack = { navController.popBackStack() }) }
            composable(Routes.SETTINGS) { SettingsScreen(onBack = { navController.popBackStack() }) }
            composable(Routes.DIAGNOSTICS) { DiagnosticsScreen(onBack = { navController.popBackStack() }) }
        }
    }
}
