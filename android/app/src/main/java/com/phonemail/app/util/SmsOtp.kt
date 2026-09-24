package com.phonemail.app.util

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Telephony
import android.util.Base64
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.core.os.BundleCompat
import com.google.android.gms.auth.api.phone.SmsRetriever
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Status
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

fun extractOtp(text: String?, length: Int): String? {
    if (text.isNullOrBlank()) return null
    return Regex("(?<!\\d)(\\d{$length})(?!\\d)").find(text)?.groupValues?.get(1)
}

/**
 * Listens for the verification SMS while the OTP screen is visible, two ways at once:
 *  1. RECEIVE_SMS permission (requested during onboarding) — reads any incoming SMS.
 *  2. Google's SMS Retriever API — no permission, works when the SMS ends with our app hash.
 */
@Composable
fun SmsOtpListener(length: Int, onCode: (String) -> Unit) {
    val context = LocalContext.current
    val callback = rememberUpdatedState(onCode)
    DisposableEffect(length) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                val body = when (intent.action) {
                    Telephony.Sms.Intents.SMS_RECEIVED_ACTION ->
                        runCatching { Telephony.Sms.Intents.getMessagesFromIntent(intent).joinToString("") { it.messageBody ?: "" } }.getOrNull()
                    SmsRetriever.SMS_RETRIEVED_ACTION -> {
                        val extras = intent.extras
                        val status = extras?.let { BundleCompat.getParcelable(it, SmsRetriever.EXTRA_STATUS, Status::class.java) }
                        if (status?.statusCode == CommonStatusCodes.SUCCESS) extras.getString(SmsRetriever.EXTRA_SMS_MESSAGE) else null
                    }
                    else -> null
                }
                extractOtp(body, length)?.let { callback.value(it) }
            }
        }
        val registered = mutableListOf<BroadcastReceiver>()
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED) {
            val filter = IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION).apply { priority = 999 }
            ContextCompat.registerReceiver(context, receiver, filter, Manifest.permission.BROADCAST_SMS, null, ContextCompat.RECEIVER_EXPORTED)
            registered += receiver
        }
        val retriever = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) = receiver.onReceive(ctx, intent)
        }
        runCatching {
            SmsRetriever.getClient(context).startSmsRetriever()
            ContextCompat.registerReceiver(
                context, retriever, IntentFilter(SmsRetriever.SMS_RETRIEVED_ACTION), SmsRetriever.SEND_PERMISSION, null, ContextCompat.RECEIVER_EXPORTED,
            )
            registered += retriever
        }
        onDispose {
            registered.forEach { runCatching { context.unregisterReceiver(it) } }
        }
    }
}

/** The 11-character hash the SMS Retriever API expects at the end of the OTP message. */
fun appSignatureHash(context: Context): String? = runCatching {
    val pm = context.packageManager
    val pkg = context.packageName
    val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners
    } else {
        @Suppress("DEPRECATION")
        pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES).signatures
    }
    val signature = signatures?.firstOrNull()?.toCharsString() ?: return null
    val digest = MessageDigest.getInstance("SHA-256").digest("$pkg $signature".toByteArray(StandardCharsets.UTF_8))
    Base64.encodeToString(digest.copyOfRange(0, 9), Base64.NO_PADDING or Base64.NO_WRAP).substring(0, 11)
}.getOrNull()
