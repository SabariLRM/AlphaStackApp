package com.phonemail.app.data

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.phonemail.app.BuildConfig
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "phonemail")

/** Small persistent settings: session token, server URL and onboarding progress. */
class Prefs(private val context: Context) {
    private object Keys {
        val token = stringPreferencesKey("token")
        val serverUrl = stringPreferencesKey("server_url")
        val languageChosen = booleanPreferencesKey("language_chosen")
        val termsAccepted = booleanPreferencesKey("terms_accepted")
        val profileDone = booleanPreferencesKey("profile_done")
        val lastSync = stringPreferencesKey("last_sync")
        val notifications = booleanPreferencesKey("notifications_enabled")
        val phone = stringPreferencesKey("phone")
    }

    data class Snapshot(
        val token: String?,
        val serverUrl: String,
        val languageChosen: Boolean,
        val termsAccepted: Boolean,
        val profileDone: Boolean,
        val notificationsEnabled: Boolean,
    )

    private fun Preferences.snapshot() = Snapshot(
        token = this[Keys.token],
        serverUrl = this[Keys.serverUrl] ?: BuildConfig.DEFAULT_SERVER_URL,
        languageChosen = this[Keys.languageChosen] ?: false,
        termsAccepted = this[Keys.termsAccepted] ?: false,
        profileDone = this[Keys.profileDone] ?: false,
        notificationsEnabled = this[Keys.notifications] ?: true,
    )

    val flow = context.dataStore.data.map { it.snapshot() }

    suspend fun snapshot(): Snapshot = flow.first()

    suspend fun setToken(token: String?) = context.dataStore.edit {
        if (token == null) it.remove(Keys.token) else it[Keys.token] = token
    }

    suspend fun setServerUrl(url: String) = context.dataStore.edit { it[Keys.serverUrl] = url }
    suspend fun setLanguageChosen() = context.dataStore.edit { it[Keys.languageChosen] = true }
    suspend fun setTermsAccepted() = context.dataStore.edit { it[Keys.termsAccepted] = true }
    suspend fun setProfileDone(done: Boolean) = context.dataStore.edit { it[Keys.profileDone] = done }
    suspend fun setNotificationsEnabled(enabled: Boolean) = context.dataStore.edit { it[Keys.notifications] = enabled }
    suspend fun lastSync(): String? = context.dataStore.data.first()[Keys.lastSync]
    suspend fun setLastSync(value: String) = context.dataStore.edit { it[Keys.lastSync] = value }
    suspend fun lastPhone(): String? = context.dataStore.data.first()[Keys.phone]
    suspend fun setLastPhone(value: String) = context.dataStore.edit { it[Keys.phone] = value }

    /** Signs out locally but keeps language/terms/server choices. */
    suspend fun clearSession() = context.dataStore.edit {
        it.remove(Keys.token)
        it.remove(Keys.profileDone)
        it.remove(Keys.lastSync)
    }
}
