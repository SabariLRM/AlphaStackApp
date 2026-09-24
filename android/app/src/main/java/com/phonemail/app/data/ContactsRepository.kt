package com.phonemail.app.data

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import com.phonemail.app.util.PhoneNumbers
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext

data class DeviceContact(val name: String, val e164: String)

/**
 * Reads the phone book (after the user grants access) so chats show contact names, and asks the
 * server which contacts already have PhoneMail. Contacts never leave the device except for that
 * one lookup, and the server does not store them.
 */
class ContactsRepository(private val context: Context, private val client: ApiClient, private val phones: PhoneNumbers) {
    private val _names = MutableStateFlow<Map<String, String>>(emptyMap())
    /** E.164 number → contact name. */
    val names: StateFlow<Map<String, String>> = _names

    private val _onPhoneMail = MutableStateFlow<List<ContactMatch>>(emptyList())
    val onPhoneMail: StateFlow<List<ContactMatch>> = _onPhoneMail

    private val _all = MutableStateFlow<List<DeviceContact>>(emptyList())
    val all: StateFlow<List<DeviceContact>> = _all

    fun hasPermission() = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED

    suspend fun refresh() {
        if (!hasPermission()) return
        val contacts = withContext(Dispatchers.IO) { readContacts() }
        _all.value = contacts
        _names.value = contacts.associate { it.e164 to it.name }
        if (contacts.isEmpty() || client.token == null) return
        runCatching {
            val matches = contacts.map { it.e164 }.distinct().chunked(1000).flatMap { chunk ->
                safeCall { client.api.matchContacts(ContactsMatchRequest(chunk)) }.items
            }
            _onPhoneMail.value = matches.sortedBy { (_names.value[it.phone] ?: it.name).lowercase() }
        }
    }

    private fun readContacts(): List<DeviceContact> {
        val region = phones.defaultRegion()
        val out = LinkedHashMap<String, DeviceContact>()
        val projection = arrayOf(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER)
        runCatching {
            context.contentResolver.query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI, projection, null, null, null)?.use { c ->
                val nameIdx = c.getColumnIndex(projection[0])
                val numIdx = c.getColumnIndex(projection[1])
                while (c.moveToNext()) {
                    val name = c.getString(nameIdx)?.trim().orEmpty()
                    val number = c.getString(numIdx) ?: continue
                    val e164 = phones.toE164(number, region) ?: continue
                    if (name.isNotEmpty() && e164 !in out) out[e164] = DeviceContact(name, e164)
                }
            }
        }
        return out.values.sortedBy { it.name.lowercase() }
    }
}
