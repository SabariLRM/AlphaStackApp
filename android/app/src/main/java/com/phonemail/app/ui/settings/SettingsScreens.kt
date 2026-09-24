package com.phonemail.app.ui.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AlternateEmail
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.phonemail.app.AppContainer
import com.phonemail.app.AppLanguage
import com.phonemail.app.BuildConfig
import com.phonemail.app.R
import com.phonemail.app.data.AliasRequest
import com.phonemail.app.data.ApiException
import com.phonemail.app.data.DeleteAccountRequest
import com.phonemail.app.data.Files
import com.phonemail.app.data.ProfilePatch
import com.phonemail.app.data.SessionInfo
import com.phonemail.app.data.safeCall
import com.phonemail.app.ui.components.Avatar
import com.phonemail.app.ui.components.ConfirmDialog
import com.phonemail.app.ui.components.LoadingBox
import com.phonemail.app.ui.onboarding.ServerDialog
import com.phonemail.app.ui.theme.Wa
import com.phonemail.app.util.fullDateTime
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsScaffold(title: String, onBack: () -> Unit, snackbar: SnackbarHostState? = null, fab: @Composable () -> Unit = {}, content: @Composable (Modifier) -> Unit) {
    Scaffold(
        containerColor = Wa.colors.background,
        snackbarHost = { snackbar?.let { SnackbarHost(it) } },
        floatingActionButton = fab,
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back), tint = Wa.colors.onTopBar) } },
                title = { Text(title, color = Wa.colors.text) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Wa.colors.topBar),
            )
        },
    ) { padding -> content(Modifier.padding(padding)) }
}

@Composable
private fun SettingRow(icon: ImageVector, title: String, subtitle: String? = null, danger: Boolean = false, trailing: (@Composable () -> Unit)? = null, onClick: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().let { if (onClick != null) it.clickable(onClick = onClick) else it }.padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = if (danger) Wa.colors.danger else Wa.colors.textSecondary)
        Spacer(Modifier.width(24.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = if (danger) Wa.colors.danger else Wa.colors.text, fontSize = 16.sp)
            if (subtitle != null) Text(subtitle, color = Wa.colors.textSecondary, fontSize = 14.sp)
        }
        trailing?.invoke()
    }
}

/** Account settings (opened from the profile icon on Home). */
@Composable
fun SettingsScreen(
    container: AppContainer,
    onBack: () -> Unit,
    onProfile: () -> Unit,
    onAliases: () -> Unit,
    onSessions: () -> Unit,
    onSignedOut: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val me by container.me.collectAsState()
    val prefs by container.prefs.flow.collectAsState(initial = null)
    var languageDialog by remember { mutableStateOf(false) }
    var serverDialog by remember { mutableStateOf(false) }
    var confirmLogout by remember { mutableStateOf(false) }
    var deleteDialog by remember { mutableStateOf(false) }
    var about by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { runCatching { container.refreshMe() } }

    SettingsScaffold(stringResource(R.string.settings), onBack, snackbar) { modifier ->
        Column(modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Row(Modifier.fillMaxWidth().clickable(onClick = onProfile).padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                Avatar(container.client.absolute(me?.avatarUrl), me?.displayName ?: "", me?.address ?: "me", size = 64.dp)
                Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f)) {
                    Text(me?.displayName?.ifBlank { null } ?: stringResource(R.string.add_your_name), color = Wa.colors.text, fontSize = 20.sp)
                    Text(me?.about?.ifBlank { null } ?: me?.address.orEmpty(), color = Wa.colors.textSecondary, fontSize = 14.sp, maxLines = 1)
                }
            }
            HorizontalDivider(color = Wa.colors.divider)
            SettingRow(Icons.Filled.Person, stringResource(R.string.profile), stringResource(R.string.profile_sub), onClick = onProfile)
            SettingRow(Icons.Filled.AlternateEmail, stringResource(R.string.alias_ids), stringResource(R.string.alias_ids_sub, me?.aliases?.size ?: 0), onClick = onAliases)
            SettingRow(
                Icons.Filled.Language,
                stringResource(R.string.app_language),
                AppLanguage.supported.firstOrNull { it.code == AppLanguage.current() }?.nativeName,
                onClick = { languageDialog = true },
            )
            SettingRow(
                Icons.Filled.Notifications,
                stringResource(R.string.notifications),
                stringResource(R.string.notifications_sub),
                trailing = {
                    Switch(
                        checked = prefs?.notificationsEnabled ?: true,
                        onCheckedChange = { on -> scope.launch { container.prefs.setNotificationsEnabled(on) } },
                        colors = SwitchDefaults.colors(checkedThumbColor = Wa.colors.onGreen, checkedTrackColor = Wa.colors.green),
                    )
                },
            )
            SettingRow(Icons.Filled.Devices, stringResource(R.string.linked_devices), stringResource(R.string.linked_devices_sub), onClick = onSessions)
            SettingRow(Icons.Filled.Dns, stringResource(R.string.server_settings), container.client.baseUrl.trimEnd('/'), onClick = { serverDialog = true })
            SettingRow(Icons.Filled.Info, stringResource(R.string.help_about), stringResource(R.string.version, BuildConfig.VERSION_NAME), onClick = { about = true })
            HorizontalDivider(Modifier.padding(vertical = 8.dp), color = Wa.colors.divider)
            SettingRow(Icons.AutoMirrored.Filled.Logout, stringResource(R.string.log_out), onClick = { confirmLogout = true })
            SettingRow(Icons.Filled.DeleteForever, stringResource(R.string.delete_account), danger = true, onClick = { deleteDialog = true })
            Spacer(Modifier.height(24.dp))
            Text(stringResource(R.string.from_phonemail), color = Wa.colors.textSecondary, fontSize = 13.sp, modifier = Modifier.align(Alignment.CenterHorizontally))
            Spacer(Modifier.height(24.dp))
        }
    }

    if (languageDialog) {
        AlertDialog(
            onDismissRequest = { languageDialog = false },
            title = { Text(stringResource(R.string.app_language)) },
            text = {
                Column {
                    AppLanguage.supported.forEach { lang ->
                        Row(
                            Modifier.fillMaxWidth().clickable {
                                languageDialog = false
                                container.scope.launch { runCatching { container.setMe(safeCall { container.api.updateMe(ProfilePatch(language = lang.code)) }) } }
                                AppLanguage.apply(lang.code)
                            }.padding(vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = AppLanguage.current() == lang.code, onClick = null, colors = RadioButtonDefaults.colors(selectedColor = Wa.colors.green))
                            Spacer(Modifier.width(16.dp))
                            Column {
                                Text(lang.nativeName, color = Wa.colors.text)
                                Text(lang.englishName, color = Wa.colors.textSecondary, fontSize = 13.sp)
                            }
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { languageDialog = false }) { Text(stringResource(R.string.cancel), color = Wa.colors.greenDark) } },
            containerColor = Wa.colors.surface,
        )
    }
    if (serverDialog) ServerDialog(container) { serverDialog = false }
    if (about) {
        AlertDialog(
            onDismissRequest = { about = false },
            title = { Text(stringResource(R.string.app_name)) },
            text = { Text(stringResource(R.string.about_text, me?.address ?: ""), color = Wa.colors.textSecondary) },
            confirmButton = { TextButton(onClick = { about = false }) { Text(stringResource(R.string.ok), color = Wa.colors.greenDark) } },
            containerColor = Wa.colors.surface,
        )
    }
    if (confirmLogout) {
        ConfirmDialog(
            title = stringResource(R.string.log_out_q),
            text = stringResource(R.string.log_out_body),
            confirm = stringResource(R.string.log_out),
            dismiss = stringResource(R.string.cancel),
            onConfirm = {
                confirmLogout = false
                scope.launch {
                    container.signOut(callServer = true)
                    onSignedOut()
                }
            },
            onDismiss = { confirmLogout = false },
        )
    }
    if (deleteDialog) {
        var phone by remember { mutableStateOf("") }
        var error by remember { mutableStateOf<String?>(null) }
        var busy by remember { mutableStateOf(false) }
        AlertDialog(
            onDismissRequest = { if (!busy) deleteDialog = false },
            title = { Text(stringResource(R.string.delete_account)) },
            text = {
                Column {
                    Text(stringResource(R.string.delete_account_body), color = Wa.colors.textSecondary)
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = phone,
                        onValueChange = { phone = it; error = null },
                        singleLine = true,
                        label = { Text(stringResource(R.string.phone_number)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Wa.colors.danger, focusedLabelColor = Wa.colors.danger),
                    )
                    error?.let { Text(it, color = Wa.colors.danger, fontSize = 13.sp) }
                }
            },
            confirmButton = {
                TextButton(enabled = phone.isNotBlank() && !busy, onClick = {
                    busy = true
                    scope.launch {
                        try {
                            safeCall { container.api.deleteAccount(DeleteAccountRequest(phone)) }
                            container.signOut(callServer = false)
                            deleteDialog = false
                            onSignedOut()
                        } catch (e: ApiException) {
                            error = e.message
                        } finally {
                            busy = false
                        }
                    }
                }) { Text(stringResource(R.string.delete_account), color = Wa.colors.danger) }
            },
            dismissButton = { TextButton(onClick = { deleteDialog = false }) { Text(stringResource(R.string.cancel), color = Wa.colors.greenDark) } },
            containerColor = Wa.colors.surface,
        )
    }
}

/** Profile: photo, name, about and the (read-only) phone number and address. */
@Composable
fun ProfileScreen(container: AppContainer, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val me by container.me.collectAsState()
    var uploading by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<String?>(null) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        uploading = true
        scope.launch {
            try {
                container.setMe(safeCall { container.api.uploadAvatar(Files.avatarPart(context, uri)) })
            } catch (e: ApiException) {
                snackbar.showSnackbar(e.message)
            } finally {
                uploading = false
            }
        }
    }

    SettingsScaffold(stringResource(R.string.profile), onBack, snackbar) { modifier ->
        Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.height(24.dp))
            Box {
                Avatar(container.client.absolute(me?.avatarUrl), me?.displayName ?: "", me?.address ?: "me", size = 150.dp)
                Box(
                    Modifier.align(Alignment.BottomEnd).size(48.dp).clip(CircleShape).background(Wa.colors.green)
                        .clickable { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    contentAlignment = Alignment.Center,
                ) {
                    if (uploading) androidx.compose.material3.CircularProgressIndicator(Modifier.size(22.dp), color = Wa.colors.onGreen, strokeWidth = 2.dp)
                    else Icon(Icons.Filled.CameraAlt, stringResource(R.string.change_photo), tint = Wa.colors.onGreen)
                }
            }
            if (me?.avatarUrl != null) {
                TextButton(onClick = {
                    scope.launch { runCatching { container.setMe(safeCall { container.api.removeAvatar() }) }.onFailure { snackbar.showSnackbar(it.message ?: "") } }
                }) { Text(stringResource(R.string.remove_photo), color = Wa.colors.danger) }
            }
            Spacer(Modifier.height(16.dp))
            SettingRow(Icons.Filled.Person, stringResource(R.string.name), me?.displayName?.ifBlank { null } ?: "—", trailing = { Icon(Icons.Filled.Edit, null, tint = Wa.colors.green) }) { editing = "name" }
            SettingRow(Icons.Filled.Info, stringResource(R.string.about), me?.about?.ifBlank { null } ?: stringResource(R.string.about_default), trailing = { Icon(Icons.Filled.Edit, null, tint = Wa.colors.green) }) { editing = "about" }
            SettingRow(Icons.Filled.Phone, stringResource(R.string.phone), me?.phone?.let(container.phones::formatInternational).orEmpty())
            SettingRow(Icons.Filled.AlternateEmail, stringResource(R.string.email_address), me?.address.orEmpty())
        }
    }

    editing?.let { field ->
        var value by remember(field) { mutableStateOf(if (field == "name") me?.displayName.orEmpty() else me?.about.orEmpty()) }
        AlertDialog(
            onDismissRequest = { editing = null },
            title = { Text(stringResource(if (field == "name") R.string.enter_your_name else R.string.about)) },
            text = {
                OutlinedTextField(
                    value = value,
                    onValueChange = { value = it.take(if (field == "name") 60 else 140) },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Wa.colors.green, cursorColor = Wa.colors.green),
                )
            },
            confirmButton = {
                TextButton(enabled = field != "name" || value.isNotBlank(), onClick = {
                    editing = null
                    scope.launch {
                        runCatching {
                            val patch = if (field == "name") ProfilePatch(displayName = value.trim()) else ProfilePatch(about = value.trim())
                            container.setMe(safeCall { container.api.updateMe(patch) })
                        }.onFailure { snackbar.showSnackbar(it.message ?: "") }
                    }
                }) { Text(stringResource(R.string.save), color = Wa.colors.greenDark) }
            },
            dismissButton = { TextButton(onClick = { editing = null }) { Text(stringResource(R.string.cancel), color = Wa.colors.greenDark) } },
            containerColor = Wa.colors.surface,
        )
    }
}

/** Manage alias IDs (extra addresses for the same mailbox). */
@Composable
fun AliasesScreen(container: AppContainer, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val me by container.me.collectAsState()
    val config by container.config.collectAsState()
    var adding by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<String?>(null) }
    val aliases = me?.aliases.orEmpty()

    SettingsScaffold(
        stringResource(R.string.alias_ids),
        onBack,
        snackbar,
        fab = {
            if (aliases.size < 5) {
                FloatingActionButton(onClick = { adding = true }, containerColor = Wa.colors.green, contentColor = Wa.colors.onGreen) {
                    Icon(Icons.Filled.Add, stringResource(R.string.add_alias))
                }
            }
        },
    ) { modifier ->
        LazyColumn(modifier.fillMaxSize()) {
            item {
                Text(stringResource(R.string.alias_help, config.mailDomain), color = Wa.colors.textSecondary, fontSize = 14.sp, modifier = Modifier.padding(20.dp))
            }
            item { SettingRow(Icons.Filled.Phone, me?.address.orEmpty(), stringResource(R.string.primary_address)) }
            items(aliases, key = { it }) { a ->
                SettingRow(Icons.Filled.AlternateEmail, a, stringResource(R.string.alias), trailing = {
                    IconButton(onClick = { removing = a }) { Icon(Icons.Filled.Delete, stringResource(R.string.remove), tint = Wa.colors.textSecondary) }
                })
            }
        }
    }

    if (adding) {
        var value by remember { mutableStateOf("") }
        var error by remember { mutableStateOf<String?>(null) }
        AlertDialog(
            onDismissRequest = { adding = false },
            title = { Text(stringResource(R.string.add_alias)) },
            text = {
                Column {
                    OutlinedTextField(
                        value = value,
                        onValueChange = { value = it.lowercase().filter { c -> c.isLetterOrDigit() || c in "._-" }.take(32); error = null },
                        singleLine = true,
                        suffix = { Text("@${config.mailDomain}", color = Wa.colors.textSecondary) },
                        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Wa.colors.green, cursorColor = Wa.colors.green),
                    )
                    error?.let { Text(it, color = Wa.colors.danger, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp)) }
                }
            },
            confirmButton = {
                TextButton(enabled = value.length >= 3, onClick = {
                    scope.launch {
                        try {
                            safeCall { container.api.addAlias(AliasRequest(value)) }
                            container.refreshMe()
                            adding = false
                        } catch (e: ApiException) {
                            error = e.message
                        }
                    }
                }) { Text(stringResource(R.string.add), color = Wa.colors.greenDark) }
            },
            dismissButton = { TextButton(onClick = { adding = false }) { Text(stringResource(R.string.cancel), color = Wa.colors.greenDark) } },
            containerColor = Wa.colors.surface,
        )
    }
    removing?.let { a ->
        ConfirmDialog(
            title = stringResource(R.string.remove_alias_q, a),
            text = stringResource(R.string.remove_alias_body),
            confirm = stringResource(R.string.remove),
            dismiss = stringResource(R.string.cancel),
            danger = true,
            onConfirm = {
                removing = null
                scope.launch {
                    runCatching {
                        safeCall { container.api.removeAlias(a) }
                        container.refreshMe()
                    }.onFailure { snackbar.showSnackbar(it.message ?: "") }
                }
            },
            onDismiss = { removing = null },
        )
    }
}

/** Devices signed in to this account (like WhatsApp's Linked devices). */
@Composable
fun SessionsScreen(container: AppContainer, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var sessions by remember { mutableStateOf<List<SessionInfo>?>(null) }
    suspend fun load() {
        sessions = runCatching { safeCall { container.api.sessions() }.items }.getOrElse { snackbar.showSnackbar(it.message ?: ""); emptyList() }
    }
    LaunchedEffect(Unit) { load() }
    SettingsScaffold(stringResource(R.string.linked_devices), onBack, snackbar) { modifier ->
        val list = sessions
        if (list == null) {
            LoadingBox(modifier)
            return@SettingsScaffold
        }
        LazyColumn(modifier.fillMaxSize(), verticalArrangement = Arrangement.Top) {
            item { Text(stringResource(R.string.sessions_help), color = Wa.colors.textSecondary, fontSize = 14.sp, modifier = Modifier.padding(20.dp)) }
            items(list, key = { it.id }) { s ->
                SettingRow(
                    if (s.client == "mobile") Icons.Filled.PhoneAndroid else Icons.Filled.Computer,
                    s.deviceName.ifBlank { s.client } + if (s.current) " · " + stringResource(R.string.this_device) else "",
                    stringResource(R.string.last_active, fullDateTime(s.lastSeenAt)),
                    trailing = {
                        if (!s.current) {
                            TextButton(onClick = {
                                scope.launch {
                                    runCatching { safeCall { container.api.revokeSession(s.id) } }.onFailure { snackbar.showSnackbar(it.message ?: "") }
                                    load()
                                }
                            }) { Text(stringResource(R.string.log_out), color = Wa.colors.danger, fontWeight = FontWeight.Medium) }
                        }
                    },
                )
            }
        }
    }
}
