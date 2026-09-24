package com.phonemail.app.ui.home

import android.Manifest
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Contacts
import androidx.compose.material.icons.filled.Dialpad
import androidx.compose.material.icons.filled.GroupAdd
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.phonemail.app.AppContainer
import com.phonemail.app.R
import com.phonemail.app.data.ApiException
import com.phonemail.app.data.OpenConversationRequest
import com.phonemail.app.data.safeCall
import com.phonemail.app.ui.components.Avatar
import com.phonemail.app.ui.theme.Wa
import kotlinx.coroutines.launch

/** WhatsApp's "Select contact": contacts on PhoneMail, a number pad entry and invites. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewChatScreen(container: AppContainer, onBack: () -> Unit, onOpenChat: (String) -> Unit, onNewGroup: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val matches by container.contacts.onPhoneMail.collectAsState()
    val all by container.contacts.all.collectAsState()
    val names by container.contacts.names.collectAsState()
    var hasPermission by remember { mutableStateOf(container.contacts.hasPermission()) }
    var query by remember { mutableStateOf("") }
    var searching by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        hasPermission = granted
        if (granted) scope.launch { container.contacts.refresh() }
    }
    LaunchedEffect(Unit) { if (hasPermission) container.contacts.refresh() }

    fun open(target: String) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                onOpenChat(safeCall { container.api.openConversation(OpenConversationRequest(target)) }.id)
            } catch (e: ApiException) {
                snackbar.showSnackbar(e.message)
            } finally {
                busy = false
            }
        }
    }

    val q = query.trim()
    val onPhoneMail = matches.filter { m -> q.isEmpty() || (names[m.phone] ?: m.name).contains(q, true) || m.phone.contains(q.filter { it.isDigit() }.ifEmpty { "\u0000" }) }
    val registered = matches.map { it.phone }.toSet()
    val invite = all.filter { it.e164 !in registered && (q.isEmpty() || it.name.contains(q, true) || it.e164.contains(q.filter { c -> c.isDigit() }.ifEmpty { "\u0000" })) }

    Scaffold(
        containerColor = Wa.colors.background,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = { if (searching) { searching = false; query = "" } else onBack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back), tint = Wa.colors.onTopBar) } },
                title = {
                    if (searching) {
                        BasicTextField(
                            value = query,
                            onValueChange = { query = it },
                            singleLine = true,
                            textStyle = TextStyle(color = Wa.colors.text, fontSize = 18.sp),
                            cursorBrush = SolidColor(Wa.colors.green),
                            decorationBox = { inner ->
                                if (query.isEmpty()) Text(stringResource(R.string.search_name_or_number), color = Wa.colors.textSecondary, fontSize = 18.sp)
                                inner()
                            },
                        )
                    } else {
                        Column {
                            Text(stringResource(R.string.select_contact), color = Wa.colors.text, fontSize = 19.sp)
                            if (hasPermission) Text(stringResource(R.string.n_contacts, matches.size), color = Wa.colors.textSecondary, fontSize = 13.sp)
                        }
                    }
                },
                actions = { if (!searching) IconButton(onClick = { searching = true }) { Icon(Icons.Filled.Search, stringResource(R.string.search), tint = Wa.colors.onTopBar) } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Wa.colors.topBar),
            )
        },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            item { ActionRow(Icons.Filled.GroupAdd, stringResource(R.string.new_group_email), onNewGroup) }
            if (looksLikePhone(q) || looksLikeEmail(q)) {
                item { ActionRow(Icons.Filled.Dialpad, stringResource(R.string.chat_with, q)) { open(q) } }
            }
            if (!hasPermission) {
                item { ActionRow(Icons.Filled.Contacts, stringResource(R.string.allow_contacts)) { permission.launch(Manifest.permission.READ_CONTACTS) } }
            }
            if (onPhoneMail.isNotEmpty()) {
                item { Header(stringResource(R.string.contacts_on_phonemail)) }
                items(onPhoneMail, key = { "m" + it.phone }) { m ->
                    val name = names[m.phone] ?: m.name.ifBlank { m.address }
                    PersonRow(container.client.absolute(m.avatarUrl), name, m.about.ifBlank { m.address }, m.address) { open(m.address) }
                }
            }
            if (invite.isNotEmpty()) {
                item { Header(stringResource(R.string.invite_to_phonemail)) }
                items(invite.take(300), key = { "i" + it.e164 }) { c ->
                    PersonRow(null, c.name, container.phones.formatInternational(c.e164), c.e164, trailing = stringResource(R.string.invite)) {
                        val sms = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:${c.e164}")).putExtra("sms_body", context.getString(R.string.invite_text))
                        runCatching { context.startActivity(sms) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ActionRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(44.dp).clip(CircleShape).background(Wa.colors.green), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = Wa.colors.onGreen)
        }
        Spacer(Modifier.width(16.dp))
        Text(label, color = Wa.colors.text, fontSize = 16.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun Header(text: String) {
    Text(text, modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 6.dp), color = Wa.colors.textSecondary, fontSize = 14.sp)
}

@Composable
private fun PersonRow(avatar: String?, name: String, subtitle: String, key: String, trailing: String? = null, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Avatar(avatar, name, key, size = 44.dp)
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f)) {
            Text(name, color = Wa.colors.text, fontSize = 16.sp, maxLines = 1)
            Text(subtitle, color = Wa.colors.textSecondary, fontSize = 14.sp, maxLines = 1)
        }
        trailing?.let { Text(it, color = Wa.colors.greenDark, fontWeight = FontWeight.Medium) }
    }
}
