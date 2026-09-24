package com.phonemail.app.ui.onboarding

import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.phonemail.app.AppContainer
import com.phonemail.app.AppLanguage
import com.phonemail.app.R
import com.phonemail.app.data.ApiClient
import com.phonemail.app.data.ApiException
import com.phonemail.app.data.safeCall
import com.phonemail.app.ui.components.GreenButton
import com.phonemail.app.ui.theme.Wa
import kotlinx.coroutines.launch

/** Screen 1: language selection. */
@Composable
fun LanguageScreen(container: AppContainer, onNext: () -> Unit) {
    val scope = rememberCoroutineScope()
    var selected by remember { mutableStateOf(AppLanguage.current()) }
    var serverDialog by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().background(Wa.colors.background).statusBarsPadding().navigationBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(4.dp), horizontalArrangement = Arrangement.End) {
            IconButton(onClick = { serverDialog = true }) {
                Icon(Icons.Filled.Dns, contentDescription = stringResource(R.string.server_settings), tint = Wa.colors.onTopBar)
            }
        }
        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Image(painterResource(R.drawable.ic_logo), null, Modifier.size(88.dp))
            Spacer(Modifier.height(20.dp))
            Text(stringResource(R.string.welcome_title), style = MaterialTheme.typography.headlineSmall, color = Wa.colors.text, textAlign = TextAlign.Center)
            Spacer(Modifier.height(8.dp))
            Text(stringResource(R.string.choose_language), color = Wa.colors.textSecondary, textAlign = TextAlign.Center)
        }
        Spacer(Modifier.height(16.dp))
        LazyColumn(Modifier.weight(1f)) {
            items(AppLanguage.supported, key = { it.code }) { lang ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clickable {
                            selected = lang.code
                            AppLanguage.apply(lang.code)
                        }
                        .padding(horizontal = 24.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(
                        selected = selected == lang.code,
                        onClick = null,
                        colors = RadioButtonDefaults.colors(selectedColor = Wa.colors.green, unselectedColor = Wa.colors.textSecondary),
                    )
                    Spacer(Modifier.width(20.dp))
                    Column {
                        Text(lang.nativeName, fontSize = 17.sp, color = Wa.colors.text, fontWeight = FontWeight.Medium)
                        Text(lang.englishName, fontSize = 14.sp, color = Wa.colors.textSecondary)
                    }
                }
            }
        }
        Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
            GreenButton(stringResource(R.string.next), onClick = {
                scope.launch { container.prefs.setLanguageChosen() }
                onNext()
            })
        }
    }
    if (serverDialog) ServerDialog(container) { serverDialog = false }
}

/** Screen 2: Terms & Conditions (WhatsApp's "Welcome" screen). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TermsScreen(onAgree: () -> Unit) {
    var sheet by remember { mutableStateOf<Int?>(null) }
    val linkStyle = TextLinkStyles(SpanStyle(color = Wa.colors.link))
    val privacy = stringResource(R.string.privacy_policy)
    val terms = stringResource(R.string.terms_of_service)
    val privacyLine = stringResource(R.string.terms_privacy_line)
    val acceptLine = stringResource(R.string.terms_accept_line)
    val text = buildAnnotatedString {
        // Templates contain %1$s where the link goes, so translations can reorder words freely.
        fun linked(template: String, label: String, tag: String, target: Int) {
            val parts = template.split("%1\$s")
            append(parts.first())
            withLink(LinkAnnotation.Clickable(tag, linkStyle) { sheet = target }) { append(label) }
            append(parts.drop(1).joinToString(label))
        }
        linked(privacyLine, privacy, "privacy", R.string.privacy_text)
        append(" ")
        linked(acceptLine, terms, "terms", R.string.terms_text)
    }
    Column(
        Modifier.fillMaxSize().background(Wa.colors.background).statusBarsPadding().navigationBarsPadding().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(0.6f))
        Box(Modifier.size(240.dp).clip(CircleShape).background(Wa.colors.chipSelected), contentAlignment = Alignment.Center) {
            Image(painterResource(R.drawable.ic_logo), null, Modifier.size(140.dp))
        }
        Spacer(Modifier.height(40.dp))
        Text(stringResource(R.string.welcome_title), style = MaterialTheme.typography.headlineSmall, color = Wa.colors.text, fontWeight = FontWeight.Medium)
        Spacer(Modifier.height(16.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium.copy(color = Wa.colors.textSecondary, textAlign = TextAlign.Center))
        Spacer(Modifier.weight(1f))
        GreenButton(stringResource(R.string.agree_and_continue), onClick = onAgree, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(12.dp))
        Text(stringResource(R.string.from_phonemail), color = Wa.colors.textSecondary, fontSize = 13.sp)
    }
    sheet?.let { res ->
        ModalBottomSheet(onDismissRequest = { sheet = null }, containerColor = Wa.colors.surface) {
            Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 32.dp).verticalScroll(rememberScrollState())) {
                Text(
                    if (res == R.string.privacy_text) privacy else terms,
                    style = MaterialTheme.typography.titleLarge,
                    color = Wa.colors.text,
                )
                Spacer(Modifier.height(12.dp))
                Text(stringResource(res), color = Wa.colors.textSecondary, lineHeight = 22.sp)
            }
        }
    }
}

/** Lets testers point the app at their own server (e.g. http://192.168.1.20:8088). */
@Composable
fun ServerDialog(container: AppContainer, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var url by remember { mutableStateOf(container.client.baseUrl.trimEnd('/')) }
    var status by remember { mutableStateOf<String?>(null) }
    var checking by remember { mutableStateOf(false) }
    val okText = stringResource(R.string.server_ok)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.server_settings)) },
        text = {
            Column {
                Text(stringResource(R.string.server_help), color = Wa.colors.textSecondary, fontSize = 14.sp)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it; status = null },
                    singleLine = true,
                    label = { Text(stringResource(R.string.server_url)) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                )
                status?.let { Spacer(Modifier.height(8.dp)); Text(it, fontSize = 13.sp, color = if (it == okText) Wa.colors.greenDark else Wa.colors.danger) }
            }
        },
        confirmButton = {
            TextButton(enabled = !checking, onClick = {
                checking = true
                scope.launch {
                    val previous = container.client.baseUrl
                    container.client.setBaseUrl(url)
                    try {
                        safeCall { container.loadConfig() }
                        container.prefs.setServerUrl(ApiClient.normalize(url))
                        status = okText
                        onDismiss()
                    } catch (e: ApiException) {
                        container.client.setBaseUrl(previous)
                        status = e.message
                    } finally {
                        checking = false
                    }
                }
            }) { Text(stringResource(R.string.save), color = Wa.colors.greenDark) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel), color = Wa.colors.greenDark) } },
        containerColor = Wa.colors.surface,
    )
}
