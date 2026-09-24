package com.phonemail.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.runtime.mutableStateOf
import com.phonemail.app.ui.AppNav
import com.phonemail.app.ui.theme.PhoneMailTheme
import com.phonemail.app.util.Notifications
import kotlinx.coroutines.runBlocking

class MainActivity : AppCompatActivity() {
    /** A chat to open, from a tapped notification. */
    private val pendingConversation = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val container = (application as PhoneMailApp).container
        val prefs = runBlocking { container.prefs.snapshot() }
        val start = when {
            prefs.token != null && prefs.profileDone -> Routes.HOME
            prefs.token != null -> Routes.PROFILE_SETUP
            !prefs.languageChosen -> Routes.LANGUAGE
            !prefs.termsAccepted -> Routes.TERMS
            else -> Routes.PHONE
        }
        if (savedInstanceState == null) pendingConversation.value = intent.getStringExtra(Notifications.EXTRA_CONVERSATION_ID)
        setContent {
            PhoneMailTheme {
                AppNav(container = container, startDestination = start, pendingConversation = pendingConversation)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra(Notifications.EXTRA_CONVERSATION_ID)?.let { pendingConversation.value = it }
    }
}

object Routes {
    const val LANGUAGE = "language"
    const val TERMS = "terms"
    const val PHONE = "phone"
    const val OTP = "otp"
    const val PERMISSIONS = "permissions"
    const val PROFILE_SETUP = "profileSetup"
    const val HOME = "home"
    const val CHAT = "chat"
    const val EMAIL = "email"
    const val COMPOSE = "compose"
    const val FOLDER = "folder"
    const val SETTINGS = "settings"
    const val PROFILE = "profile"
    const val ALIASES = "aliases"
    const val SESSIONS = "sessions"
    const val NEW_CHAT = "newChat"
}
