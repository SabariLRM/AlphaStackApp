package com.phonemail.app.util

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import io.michaelrocks.libphonenumber.android.NumberParseException
import io.michaelrocks.libphonenumber.android.PhoneNumberUtil
import java.util.Locale

data class Country(val region: String, val name: String, val dialCode: Int) {
    val flag: String
        get() = if (region.length == 2) region.uppercase().map { Character.toChars(0x1F1E6 + (it - 'A')).concatToString() }.joinToString("") else "🌐"
}

data class ParsedPhone(val region: String, val national: String)

/** Phone number parsing/formatting (libphonenumber) and SIM number detection. */
class PhoneNumbers(private val context: Context) {
    val util: PhoneNumberUtil by lazy { PhoneNumberUtil.createInstance(context) }

    /** Country of the SIM, then the network, then the device locale. Falls back to India. */
    fun defaultRegion(): String {
        val tm = context.getSystemService(TelephonyManager::class.java)
        val candidates = listOf(tm?.simCountryIso, tm?.networkCountryIso, Locale.getDefault().country)
        return candidates.firstOrNull { !it.isNullOrBlank() && it.length == 2 }?.uppercase() ?: "IN"
    }

    fun countries(): List<Country> {
        val locale = Locale.getDefault()
        return util.supportedRegions
            .map { Country(it, Locale("", it).getDisplayCountry(locale).ifBlank { it }, util.getCountryCodeForRegion(it)) }
            .sortedBy { it.name }
    }

    fun country(region: String): Country =
        Country(region, Locale("", region).getDisplayCountry(Locale.getDefault()).ifBlank { region }, util.getCountryCodeForRegion(region))

    /** Returns E.164 when the number could be a real number in [region]. */
    fun toE164(raw: String, region: String): String? = try {
        val n = util.parse(raw, region)
        if (util.isPossibleNumber(n)) util.format(n, PhoneNumberUtil.PhoneNumberFormat.E164) else null
    } catch (_: NumberParseException) {
        null
    }

    fun parse(raw: String, fallbackRegion: String): ParsedPhone? = try {
        val n = util.parse(raw, fallbackRegion)
        val region = util.getRegionCodeForNumber(n) ?: fallbackRegion
        ParsedPhone(region, util.getNationalSignificantNumber(n))
    } catch (_: NumberParseException) {
        null
    }

    fun formatInternational(e164: String): String = try {
        util.format(util.parse(e164, null), PhoneNumberUtil.PhoneNumberFormat.INTERNATIONAL)
    } catch (_: NumberParseException) {
        e164
    }

    fun formatNational(national: String, region: String): String = try {
        util.format(util.parse(national, region), PhoneNumberUtil.PhoneNumberFormat.NATIONAL)
    } catch (_: NumberParseException) {
        national
    }

    fun hasPhonePermission(): Boolean {
        val numbers = Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_NUMBERS) == PackageManager.PERMISSION_GRANTED
        val state = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED
        return numbers || state
    }

    /** The number stored on the SIM, when the carrier provides it (needs the phone permissions). */
    @SuppressLint("MissingPermission", "HardwareIds")
    fun simNumber(): String? {
        if (!hasPhonePermission()) return null
        val tm = context.getSystemService(TelephonyManager::class.java) ?: return null
        @Suppress("DEPRECATION")
        runCatching { tm.line1Number }.getOrNull()?.takeIf { it.isNotBlank() }?.let { return it }
        val canReadState = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED
        if (!canReadState) return null
        val sm = context.getSystemService(SubscriptionManager::class.java) ?: return null
        val subs = runCatching { sm.activeSubscriptionInfoList }.getOrNull().orEmpty()
        for (sub in subs) {
            val number = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                runCatching { sm.getPhoneNumber(sub.subscriptionId) }.getOrNull()
            } else {
                @Suppress("DEPRECATION") sub.number
            }
            if (!number.isNullOrBlank()) return number
        }
        return null
    }
}
