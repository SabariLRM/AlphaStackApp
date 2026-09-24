package com.phonemail.app.ui.onboarding

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Message
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.phonemail.app.AppContainer
import com.phonemail.app.R
import com.phonemail.app.data.ApiException
import com.phonemail.app.data.OtpRequest
import com.phonemail.app.data.OtpVerifyRequest
import com.phonemail.app.data.safeCall
import com.phonemail.app.ui.theme.Wa
import com.phonemail.app.util.SmsOtpListener
import com.phonemail.app.util.appSignatureHash
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Screen 4: OTP — detected automatically from the incoming SMS and verified without a tap. */
@Composable
fun OtpScreen(container: AppContainer, phone: String, onWrongNumber: () -> Unit, onVerified: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val config by container.config.collectAsState()
    val length = config.otpLength
    var code by rememberSaveable { mutableStateOf("") }
    var verifying by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var info by remember { mutableStateOf<String?>(null) }
    var resendIn by rememberSaveable { mutableIntStateOf(config.otpResendSeconds) }
    var autoDetected by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }

    LaunchedEffect(resendIn) {
        if (resendIn > 0) {
            delay(1000)
            resendIn -= 1
        }
    }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

    fun verify(value: String) {
        if (verifying || value.length != length) return
        verifying = true
        error = null
        scope.launch {
            try {
                val deviceName = listOf(Build.MANUFACTURER.replaceFirstChar { it.uppercase() }, Build.MODEL).distinct().joinToString(" ")
                val res = safeCall { container.api.verifyOtp(OtpVerifyRequest(phone = phone, code = value, deviceName = deviceName)) }
                val token = res.token ?: throw ApiException(-1, "no_token", context.getString(R.string.generic_error))
                container.prefs.setProfileDone(false)
                container.signedIn(token, res.user)
                onVerified()
            } catch (e: ApiException) {
                error = e.message
                code = ""
                verifying = false
            }
        }
    }

    SmsOtpListener(length) { detected ->
        if (!verifying) {
            autoDetected = true
            code = detected
            verify(detected)
        }
    }

    fun resend() {
        if (resendIn > 0) return
        scope.launch {
            try {
                val res = safeCall { container.api.requestOtp(OtpRequest(phone, appSignatureHash(context))) }
                resendIn = res.resendIn
                info = context.getString(R.string.code_resent)
                error = null
            } catch (e: ApiException) {
                error = e.message
            }
        }
    }

    val formatted = remember(phone) { container.phones.formatInternational(phone) }
    val linkStyle = TextLinkStyles(SpanStyle(color = Wa.colors.link))

    Column(
        Modifier.fillMaxSize().background(Wa.colors.background).statusBarsPadding().navigationBarsPadding().imePadding(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(20.dp))
        Text(stringResource(R.string.verifying_title), fontSize = 20.sp, fontWeight = FontWeight.Medium, color = Wa.colors.text)
        Spacer(Modifier.height(20.dp))
        Text(
            buildAnnotatedString {
                append(stringResource(R.string.waiting_for_sms) + " ")
                withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(formatted) }
                append(". ")
                withLink(LinkAnnotation.Clickable("wrong", linkStyle) { onWrongNumber() }) { append(stringResource(R.string.wrong_number)) }
            },
            modifier = Modifier.padding(horizontal = 32.dp),
            style = MaterialTheme.typography.bodyMedium.copy(textAlign = TextAlign.Center, color = Wa.colors.text),
        )
        Spacer(Modifier.height(28.dp))

        // A hidden text field drives WhatsApp-style digit boxes: "_ _ _  _ _ _".
        BasicTextField(
            value = code,
            onValueChange = { v ->
                val digits = v.filter { it.isDigit() }.take(length)
                code = digits
                error = null
                if (digits.length == length) verify(digits)
            },
            enabled = !verifying,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            textStyle = TextStyle(color = Color.Transparent),
            modifier = Modifier.focusRequester(focus),
            decorationBox = {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    for (i in 0 until length) {
                        if (length == 6 && i == 3) Spacer(Modifier.width(10.dp))
                        val ch = code.getOrNull(i)
                        Column(Modifier.width(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                ch?.toString() ?: "–",
                                fontSize = 24.sp,
                                color = if (ch != null) Wa.colors.text else Wa.colors.textSecondary,
                                fontWeight = FontWeight.Medium,
                            )
                            HorizontalDivider(thickness = 2.dp, color = if (i == code.length && !verifying) Wa.colors.green else Wa.colors.green.copy(alpha = 0.55f))
                        }
                    }
                }
            },
        )
        Spacer(Modifier.height(12.dp))
        Text(stringResource(R.string.enter_digit_code, length), color = Wa.colors.textSecondary, fontSize = 14.sp)
        if (autoDetected) {
            Spacer(Modifier.height(6.dp))
            Text(stringResource(R.string.code_detected), color = Wa.colors.greenDark, fontSize = 13.sp)
        }
        error?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, color = Wa.colors.danger, fontSize = 14.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 32.dp))
        }
        info?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = Wa.colors.greenDark, fontSize = 13.sp)
        }
        Spacer(Modifier.height(28.dp))
        HorizontalDivider(Modifier.padding(horizontal = 24.dp), color = Wa.colors.divider)
        Row(
            Modifier.fillMaxWidth().clickable(enabled = resendIn == 0) { resend() }.padding(horizontal = 24.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.AutoMirrored.Filled.Message, null, tint = if (resendIn == 0) Wa.colors.green else Wa.colors.textSecondary)
            Spacer(Modifier.width(20.dp))
            Text(
                stringResource(R.string.resend_sms),
                modifier = Modifier.weight(1f),
                color = if (resendIn == 0) Wa.colors.green else Wa.colors.textSecondary,
                fontWeight = FontWeight.Medium,
            )
            if (resendIn > 0) Text("%d:%02d".format(resendIn / 60, resendIn % 60), color = Wa.colors.textSecondary)
        }
        HorizontalDivider(Modifier.padding(horizontal = 24.dp), color = Wa.colors.divider)
        if (config.devSmsOutbox) {
            Spacer(Modifier.height(20.dp))
            Box(
                Modifier.padding(horizontal = 24.dp).background(Wa.colors.chip, RoundedCornerShape(10.dp)).border(1.dp, Wa.colors.divider, RoundedCornerShape(10.dp)).padding(12.dp),
            ) {
                Text(stringResource(R.string.dev_outbox_hint, (container.client.baseUrl + "api/dev/phone").replace("//10.0.2.2", "//localhost")), color = Wa.colors.textSecondary, fontSize = 12.sp)
            }
        }
    }

    if (verifying) {
        AlertDialog(
            onDismissRequest = {},
            confirmButton = {},
            text = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(28.dp), color = Wa.colors.green, strokeWidth = 3.dp)
                    Spacer(Modifier.width(20.dp))
                    Text(stringResource(R.string.verifying), color = Wa.colors.text)
                }
            },
            containerColor = Wa.colors.surface,
        )
    }
}
