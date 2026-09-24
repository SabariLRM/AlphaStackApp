package com.phonemail.app

import android.content.Context
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import com.phonemail.app.data.ApiClient
import com.phonemail.app.data.AppConfig
import com.phonemail.app.data.ContactsRepository
import com.phonemail.app.data.Me
import com.phonemail.app.data.Participant
import com.phonemail.app.data.Prefs
import com.phonemail.app.data.ProfilePatch
import com.phonemail.app.data.Realtime
import com.phonemail.app.data.safeCall
import com.phonemail.app.util.Notifications
import com.phonemail.app.util.PhoneNumbers
import com.phonemail.app.util.SyncWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.util.Locale

/** Text carried from a chat's composer to the traditional compose screen. */
data class ComposeHandoff(val conversationId: String, val subject: String, val body: String, val attachments: List<com.phonemail.app.data.Attachment>)

data class Language(val code: String, val nativeName: String, val englishName: String)

object AppLanguage {
    val supported = listOf(
        Language("en", "English", "English"),
        Language("hi", "हिन्दी", "Hindi"),
        Language("ta", "தமிழ்", "Tamil"),
        Language("te", "తెలుగు", "Telugu"),
    )

    fun current(): String {
        val tag = AppCompatDelegate.getApplicationLocales().toLanguageTags()
        val lang = (if (tag.isNotBlank()) tag else Locale.getDefault().toLanguageTag()).substringBefore('-').substringBefore(',')
        return supported.firstOrNull { it.code == lang }?.code ?: "en"
    }

    fun apply(code: String) {
        if (code == current() && AppCompatDelegate.getApplicationLocales().toLanguageTags().isNotBlank()) return
        AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(code))
    }
}

/** Manual dependency container shared by the UI, the background worker and notifications. */
class AppContainer(val context: Context) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val prefs = Prefs(context)
    val client = ApiClient(BuildConfig.DEFAULT_SERVER_URL)
    val realtime = Realtime(client, scope)
    val phones = PhoneNumbers(context)
    val contacts = ContactsRepository(context, client, phones)

    private val _me = MutableStateFlow<Me?>(null)
    val me: StateFlow<Me?> = _me
    private val _config = MutableStateFlow(AppConfig())
    val config: StateFlow<AppConfig> = _config

    /** Consumed once by the compose screen. */
    @Volatile var composeHandoff: ComposeHandoff? = null

    fun setMe(value: Me?) {
        _me.value = value
    }

    val api get() = client.api

    suspend fun loadConfig(): AppConfig = safeCall { api.config() }.also { _config.value = it }

    suspend fun refreshMe(): Me = safeCall { api.me() }.also { _me.value = it }

    suspend fun signedIn(token: String, user: Me) {
        prefs.setToken(token)
        client.token = token
        _me.value = user
        realtime.start()
        SyncWorker.schedule(context)
        // Keep the server's language preference in sync with the app.
        val lang = AppLanguage.current()
        if (user.language != lang) scope.launch { runCatching { _me.value = safeCall { api.updateMe(ProfilePatch(language = lang)) } } }
        scope.launch { contacts.refresh() }
    }

    suspend fun signOut(callServer: Boolean) {
        if (callServer) runCatching { safeCall { api.logout() } }
        prefs.clearSession()
        client.token = null
        _me.value = null
        realtime.stop()
        SyncWorker.cancel(context)
        Notifications.clearAll(context)
    }

    /** Contact name from the phone book, then the PhoneMail profile name, then the number/address. */
    fun participantName(p: Participant): String {
        val contact = p.phone?.let { contacts.names.value[it] }
        return contact ?: p.name.ifBlank { p.phone?.let { phones.formatInternational(it) } ?: p.address }
    }

    fun displayNameFor(address: String, name: String): String {
        val phone = phoneForAddress(address)
        val contact = phone?.let { contacts.names.value[it] }
        return contact ?: name.ifBlank { phone?.let { phones.formatInternational(it) } ?: address }
    }

    /** Best-effort E.164 for a numeric PhoneMail address (e.g. 9876543210@phonemail.com). */
    fun phoneForAddress(address: String): String? {
        val local = address.substringBefore('@')
        val domain = address.substringAfter('@', "")
        val cfg = config.value
        if (domain != cfg.mailDomain || local.isEmpty() || !local.all { it.isDigit() }) return null
        if (local.startsWith("00")) return "+" + local.drop(2)
        // Home-country numbers use the national number; everyone else uses full international digits.
        val home = phones.toE164(local, cfg.defaultCountry)
        return if (home != null && home == "+${cfg.defaultCallingCode}$local") home else "+$local"
    }
}
