package com.phonemail.app.ui

import android.net.Uri
import android.widget.Toast
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.phonemail.app.AppContainer
import com.phonemail.app.R
import com.phonemail.app.Routes
import com.phonemail.app.ui.chat.ChatScreen
import com.phonemail.app.ui.compose.ComposeArgs
import com.phonemail.app.ui.compose.ComposeScreen
import com.phonemail.app.ui.email.EmailDetailScreen
import com.phonemail.app.ui.folders.FolderScreen
import com.phonemail.app.ui.home.HomeScreen
import com.phonemail.app.ui.home.NewChatScreen
import com.phonemail.app.ui.onboarding.LanguageScreen
import com.phonemail.app.ui.onboarding.OtpScreen
import com.phonemail.app.ui.onboarding.PermissionsScreen
import com.phonemail.app.ui.onboarding.PhoneScreen
import com.phonemail.app.ui.onboarding.ProfileSetupScreen
import com.phonemail.app.ui.onboarding.TermsScreen
import com.phonemail.app.ui.settings.AliasesScreen
import com.phonemail.app.ui.settings.ProfileScreen
import com.phonemail.app.ui.settings.SessionsScreen
import com.phonemail.app.ui.settings.SettingsScreen
import kotlinx.coroutines.launch

fun NavHostController.openChat(id: String) = navigate("${Routes.CHAT}/$id") { launchSingleTop = true }
fun NavHostController.openEmail(id: String) = navigate("${Routes.EMAIL}/$id")
fun NavHostController.openCompose(args: ComposeArgs = ComposeArgs()) = navigate(args.route())

private fun NavHostController.resetTo(route: String) = navigate(route) {
    popUpTo(0) { inclusive = true }
    launchSingleTop = true
}

@Composable
fun AppNav(container: AppContainer, startDestination: String, pendingConversation: MutableState<String?>) {
    val nav = rememberNavController()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    // A revoked or expired session sends the user back to phone verification.
    LaunchedEffect(Unit) {
        container.client.unauthorized.collect {
            container.signOut(callServer = false)
            Toast.makeText(context, R.string.session_expired, Toast.LENGTH_LONG).show()
            nav.resetTo(Routes.PHONE)
        }
    }

    // Tapped notification → open that chat (once signed in).
    LaunchedEffect(pendingConversation.value) {
        val id = pendingConversation.value ?: return@LaunchedEffect
        if (container.client.token != null) {
            if (nav.currentDestination?.route != Routes.HOME) nav.popBackStack(Routes.HOME, inclusive = false)
            nav.openChat(id)
        }
        pendingConversation.value = null
    }

    NavHost(
        navController = nav,
        startDestination = startDestination,
        enterTransition = { slideInHorizontally(tween(260)) { it / 3 } + fadeIn(tween(260)) },
        exitTransition = { fadeOut(tween(200)) },
        popEnterTransition = { fadeIn(tween(200)) },
        popExitTransition = { slideOutHorizontally(tween(260)) { it / 3 } + fadeOut(tween(260)) },
    ) {
        composable(Routes.LANGUAGE) {
            LanguageScreen(container = container, onNext = { nav.navigate(Routes.TERMS) })
        }
        composable(Routes.TERMS) {
            TermsScreen(onAgree = {
                scope.launch { container.prefs.setTermsAccepted() }
                nav.navigate(Routes.PHONE)
            })
        }
        composable(Routes.PHONE) {
            PhoneScreen(container = container, onCodeSent = { phone -> nav.navigate("${Routes.OTP}/${Uri.encode(phone)}") })
        }
        composable("${Routes.OTP}/{phone}", arguments = listOf(navArgument("phone") { type = NavType.StringType })) { entry ->
            OtpScreen(
                container = container,
                phone = entry.arguments?.getString("phone").orEmpty(),
                onWrongNumber = { nav.popBackStack() },
                onVerified = { nav.resetTo(Routes.PERMISSIONS) },
            )
        }
        composable(Routes.PERMISSIONS) {
            PermissionsScreen(container = container, onDone = { nav.resetTo(Routes.PROFILE_SETUP) })
        }
        composable(Routes.PROFILE_SETUP) {
            ProfileSetupScreen(container = container, onDone = { nav.resetTo(Routes.HOME) })
        }
        composable(Routes.HOME) {
            HomeScreen(
                container = container,
                onOpenChat = { nav.openChat(it) },
                onCompose = { nav.openCompose() },
                onNewChat = { nav.navigate(Routes.NEW_CHAT) },
                onFolder = { nav.navigate("${Routes.FOLDER}/$it") },
                onSettings = { nav.navigate(Routes.SETTINGS) },
            )
        }
        composable(Routes.NEW_CHAT) {
            NewChatScreen(
                container = container,
                onBack = { nav.popBackStack() },
                onOpenChat = { id ->
                    nav.popBackStack()
                    nav.openChat(id)
                },
                onNewGroup = {
                    nav.popBackStack()
                    nav.openCompose()
                },
            )
        }
        composable("${Routes.CHAT}/{id}", arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
            ChatScreen(
                container = container,
                conversationId = entry.arguments?.getString("id").orEmpty(),
                onBack = { nav.popBackStack() },
                onOpenEmail = { nav.openEmail(it) },
                onCompose = { nav.openCompose(it) },
            )
        }
        composable("${Routes.EMAIL}/{id}", arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
            EmailDetailScreen(
                container = container,
                entryId = entry.arguments?.getString("id").orEmpty(),
                onBack = { nav.popBackStack() },
                onReply = { nav.openCompose(it) },
                onOpenEmail = { nav.openEmail(it) },
            )
        }
        composable(
            ComposeArgs.ROUTE,
            arguments = ComposeArgs.NAMES.map { name -> navArgument(name) { type = NavType.StringType; nullable = true; defaultValue = null } },
        ) { entry ->
            ComposeScreen(
                container = container,
                args = ComposeArgs.from(entry.arguments),
                onClose = { nav.popBackStack() },
                onSentToChat = { conversationId ->
                    nav.popBackStack()
                    // After a new email from Home, jump into the (possibly new group) chat like WhatsApp.
                    if (nav.currentDestination?.route == Routes.HOME) nav.openChat(conversationId)
                },
            )
        }
        composable("${Routes.FOLDER}/{name}", arguments = listOf(navArgument("name") { type = NavType.StringType })) { entry ->
            FolderScreen(
                container = container,
                folder = entry.arguments?.getString("name").orEmpty(),
                onBack = { nav.popBackStack() },
                onOpenEmail = { nav.openEmail(it) },
                onOpenDraft = { nav.openCompose(ComposeArgs(draftId = it)) },
            )
        }
        composable(Routes.SETTINGS) {
            SettingsScreen(
                container = container,
                onBack = { nav.popBackStack() },
                onProfile = { nav.navigate(Routes.PROFILE) },
                onAliases = { nav.navigate(Routes.ALIASES) },
                onSessions = { nav.navigate(Routes.SESSIONS) },
                onSignedOut = { nav.resetTo(Routes.PHONE) },
            )
        }
        composable(Routes.PROFILE) { ProfileScreen(container = container, onBack = { nav.popBackStack() }) }
        composable(Routes.ALIASES) { AliasesScreen(container = container, onBack = { nav.popBackStack() }) }
        composable(Routes.SESSIONS) { SessionsScreen(container = container, onBack = { nav.popBackStack() }) }
    }
}
