package com.phonemail.app.ui.onboarding

import android.Manifest
import android.app.Activity
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.google.android.gms.auth.api.identity.GetPhoneNumberHintIntentRequest
import com.google.android.gms.auth.api.identity.Identity
import com.phonemail.app.AppContainer
import com.phonemail.app.R
import com.phonemail.app.data.ApiException
import com.phonemail.app.data.OtpRequest
import com.phonemail.app.data.safeCall
import com.phonemail.app.ui.components.GreenButton
import com.phonemail.app.ui.theme.Wa
import com.phonemail.app.util.Country
import com.phonemail.app.util.appSignatureHash
import kotlinx.coroutines.launch

/** Permissions asked on the phone screen: SIM number detection and OTP auto-read. */
fun phonePermissions(): Array<String> = buildList {
    add(Manifest.permission.READ_PHONE_STATE)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) add(Manifest.permission.READ_PHONE_NUMBERS)
    add(Manifest.permission.RECEIVE_SMS)
}.toTypedArray()

/** Screen 3: phone number, detected from the SIM and pre-filled (editable). */
@Composable
fun PhoneScreen(container: AppContainer, onCodeSent: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val phones = container.phones
    var region by rememberSaveable { mutableStateOf(phones.defaultRegion()) }
    var number by rememberSaveable { mutableStateOf("") }
    var askedPermissions by rememberSaveable { mutableStateOf(false) }
    var hintTried by rememberSaveable { mutableStateOf(false) }
    var showRationale by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    var countryPicker by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var serverDialog by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    val country = remember(region) { phones.country(region) }

    fun prefill(raw: String?) {
        if (raw.isNullOrBlank()) return
        phones.parse(raw, region)?.let {
            region = it.region
            number = it.national
        }
    }

    val hintLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            runCatching { Identity.getSignInClient(context).getPhoneNumberFromIntent(result.data) }.getOrNull()?.let { prefill(it) }
        }
    }

    fun launchPhoneHint() {
        hintTried = true
        val activity = context as? Activity ?: return
        Identity.getSignInClient(activity)
            .getPhoneNumberHintIntent(GetPhoneNumberHintIntentRequest.builder().build())
            .addOnSuccessListener { pending ->
                runCatching { hintLauncher.launch(IntentSenderRequest.Builder(pending.intentSender).build()) }
            }
    }

    fun detect() {
        val sim = phones.simNumber()
        if (!sim.isNullOrBlank()) prefill(sim) else if (!hintTried) launchPhoneHint()
    }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        detect()
        runCatching { focus.requestFocus() }
    }

    LaunchedEffect(Unit) {
        if (number.isBlank()) container.prefs.lastPhone()?.let { prefill(it) }
        if (!askedPermissions) {
            askedPermissions = true
            if (number.isBlank()) showRationale = true
        }
    }

    fun submit() {
        val e164 = phones.toE164(number, region)
        if (e164 == null) {
            error = context.getString(R.string.invalid_phone, country.name)
            return
        }
        confirm = e164
    }

    fun requestCode(e164: String) {
        loading = true
        scope.launch {
            try {
                val res = safeCall { container.api.requestOtp(OtpRequest(e164, appSignatureHash(context))) }
                container.prefs.setLastPhone(res.phone)
                onCodeSent(res.phone)
            } catch (e: ApiException) {
                error = e.message
            } finally {
                loading = false
            }
        }
    }

    Column(Modifier.fillMaxSize().background(Wa.colors.background).statusBarsPadding().navigationBarsPadding().imePadding()) {
        Box(Modifier.fillMaxWidth().padding(top = 20.dp, start = 16.dp, end = 4.dp)) {
            Text(
                stringResource(R.string.enter_phone_title),
                modifier = Modifier.align(Alignment.Center),
                fontSize = 20.sp,
                fontWeight = FontWeight.Medium,
                color = Wa.colors.text,
            )
            Box(Modifier.align(Alignment.CenterEnd)) {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, stringResource(R.string.more_options), tint = Wa.colors.onTopBar) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.server_settings)) }, onClick = { menu = false; serverDialog = true })
                    DropdownMenuItem(text = { Text(stringResource(R.string.whats_my_number)) }, onClick = { menu = false; launchPhoneHint() })
                }
            }
        }
        Spacer(Modifier.height(20.dp))
        val linkStyle = TextLinkStyles(SpanStyle(color = Wa.colors.link))
        Text(
            buildAnnotatedString {
                append(stringResource(R.string.enter_phone_body) + " ")
                withLink(LinkAnnotation.Clickable("mine", linkStyle) { launchPhoneHint() }) { append(stringResource(R.string.whats_my_number)) }
            },
            modifier = Modifier.padding(horizontal = 32.dp).fillMaxWidth(),
            style = MaterialTheme.typography.bodyMedium.copy(textAlign = TextAlign.Center, color = Wa.colors.text),
        )
        Spacer(Modifier.height(24.dp))
        Column(Modifier.fillMaxWidth().padding(horizontal = 56.dp)) {
            Row(
                Modifier.fillMaxWidth().clickable { countryPicker = true }.padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(country.name, modifier = Modifier.weight(1f), textAlign = TextAlign.Center, fontSize = 17.sp, color = Wa.colors.text)
                Icon(Icons.Filled.ArrowDropDown, null, tint = Wa.colors.green)
            }
            HorizontalDivider(thickness = 1.5.dp, color = Wa.colors.green)
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.Bottom) {
                Column(Modifier.width(72.dp).clickable { countryPicker = true }) {
                    Row(Modifier.padding(vertical = 8.dp)) {
                        Text("+", color = Wa.colors.textSecondary, fontSize = 18.sp)
                        Spacer(Modifier.width(10.dp))
                        Text(country.dialCode.toString(), color = Wa.colors.text, fontSize = 18.sp)
                    }
                    HorizontalDivider(thickness = 1.5.dp, color = Wa.colors.green)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    BasicTextField(
                        value = number,
                        onValueChange = { v -> number = v.filter { it.isDigit() || it == ' ' || it == '-' }.take(20); error = null },
                        singleLine = true,
                        textStyle = TextStyle(fontSize = 18.sp, color = Wa.colors.text, letterSpacing = 1.sp),
                        cursorBrush = SolidColor(Wa.colors.green),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { submit() }),
                        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp).focusRequester(focus),
                        decorationBox = { inner ->
                            if (number.isEmpty()) Text(stringResource(R.string.phone_number), color = Wa.colors.textSecondary, fontSize = 18.sp)
                            inner()
                        },
                    )
                    HorizontalDivider(thickness = 1.5.dp, color = Wa.colors.green)
                }
            }
            Spacer(Modifier.height(12.dp))
            Text(stringResource(R.string.carrier_charges), color = Wa.colors.textSecondary, fontSize = 13.sp, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = Wa.colors.danger, fontSize = 14.sp, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
            }
        }
        Spacer(Modifier.weight(1f))
        Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
            GreenButton(stringResource(R.string.next), onClick = { submit() }, loading = loading)
        }
    }

    if (showRationale) {
        AlertDialog(
            onDismissRequest = { showRationale = false },
            title = { Text(stringResource(R.string.perm_phone_title)) },
            text = { Text(stringResource(R.string.perm_phone_body), color = Wa.colors.textSecondary) },
            confirmButton = {
                TextButton(onClick = {
                    showRationale = false
                    permissionLauncher.launch(phonePermissions())
                }) { Text(stringResource(R.string.continue_label), color = Wa.colors.greenDark) }
            },
            dismissButton = {
                TextButton(onClick = {
                    showRationale = false
                    launchPhoneHint()
                }) { Text(stringResource(R.string.not_now), color = Wa.colors.greenDark) }
            },
            containerColor = Wa.colors.surface,
        )
    }

    confirm?.let { e164 ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            text = {
                Column {
                    Text(stringResource(R.string.confirm_number_intro), color = Wa.colors.textSecondary)
                    Spacer(Modifier.height(12.dp))
                    Text(phones.formatInternational(e164), fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Wa.colors.text)
                    Spacer(Modifier.height(12.dp))
                    Text(stringResource(R.string.confirm_number_question), color = Wa.colors.textSecondary)
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    confirm = null
                    requestCode(e164)
                }) { Text(stringResource(R.string.yes), color = Wa.colors.greenDark) }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text(stringResource(R.string.edit), color = Wa.colors.greenDark) } },
            containerColor = Wa.colors.surface,
        )
    }

    if (countryPicker) {
        CountryPicker(
            countries = remember { phones.countries() },
            onPick = {
                region = it.region
                countryPicker = false
            },
            onDismiss = { countryPicker = false },
        )
    }
    if (serverDialog) ServerDialog(container) { serverDialog = false }
}

@Composable
private fun CountryPicker(countries: List<Country>, onPick: (Country) -> Unit, onDismiss: () -> Unit) {
    var query by remember { mutableStateOf("") }
    val filtered = remember(query, countries) {
        val q = query.trim().lowercase()
        if (q.isEmpty()) countries else countries.filter { it.name.lowercase().contains(q) || it.dialCode.toString().startsWith(q.removePrefix("+")) }
    }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(Wa.colors.background).statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onDismiss) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back), tint = Wa.colors.onTopBar) }
                Text(stringResource(R.string.choose_country), fontSize = 20.sp, color = Wa.colors.text, fontWeight = FontWeight.Medium)
            }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).background(Wa.colors.searchBar, MaterialTheme.shapes.extraLarge).padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Search, null, tint = Wa.colors.textSecondary)
                Spacer(Modifier.width(12.dp))
                BasicTextField(
                    value = query,
                    onValueChange = { query = it },
                    singleLine = true,
                    textStyle = TextStyle(fontSize = 16.sp, color = Wa.colors.text),
                    cursorBrush = SolidColor(Wa.colors.green),
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        if (query.isEmpty()) Text(stringResource(R.string.search_countries), color = Wa.colors.textSecondary)
                        inner()
                    },
                )
            }
            LazyColumn(Modifier.weight(1f)) {
                items(filtered, key = { it.region }) { c ->
                    Row(
                        Modifier.fillMaxWidth().clickable { onPick(c) }.padding(horizontal = 20.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Text(c.flag, fontSize = 22.sp, modifier = Modifier.size(32.dp))
                        Text(c.name, modifier = Modifier.weight(1f), fontSize = 16.sp, color = Wa.colors.text)
                        Text("+${c.dialCode}", color = Wa.colors.textSecondary, fontSize = 15.sp)
                    }
                }
            }
        }
    }
}
