package com.phonemail.app.ui.onboarding

import android.Manifest
import android.os.Build
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddAPhoto
import androidx.compose.material.icons.filled.Contacts
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.phonemail.app.AppContainer
import com.phonemail.app.R
import com.phonemail.app.data.ApiException
import com.phonemail.app.data.Files
import com.phonemail.app.data.ProfilePatch
import com.phonemail.app.data.safeCall
import com.phonemail.app.ui.components.Avatar
import com.phonemail.app.ui.components.GreenButton
import com.phonemail.app.ui.theme.Wa
import kotlinx.coroutines.launch

/** After verification: contacts (names in chats) and notifications (new email alerts). */
@Composable
fun PermissionsScreen(container: AppContainer, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        scope.launch { runCatching { container.contacts.refresh() } }
        onDone()
    }
    Column(
        Modifier.fillMaxSize().background(Wa.colors.background).statusBarsPadding().navigationBarsPadding().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(0.5f))
        Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            listOf(Icons.Filled.Contacts, Icons.Filled.Notifications).forEach { icon ->
                Box(Modifier.size(72.dp).clip(CircleShape).background(Wa.colors.green), contentAlignment = Alignment.Center) {
                    Icon(icon, null, tint = Wa.colors.onGreen, modifier = Modifier.size(36.dp))
                }
            }
        }
        Spacer(Modifier.height(28.dp))
        Text(stringResource(R.string.perm_contacts_title), fontSize = 20.sp, fontWeight = FontWeight.Medium, color = Wa.colors.text, textAlign = TextAlign.Center)
        Spacer(Modifier.height(12.dp))
        Text(stringResource(R.string.perm_contacts_body), color = Wa.colors.textSecondary, textAlign = TextAlign.Center)
        Spacer(Modifier.weight(1f))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onDone) { Text(stringResource(R.string.not_now), color = Wa.colors.greenDark) }
            GreenButton(stringResource(R.string.continue_label), onClick = {
                val perms = buildList {
                    add(Manifest.permission.READ_CONTACTS)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
                }
                launcher.launch(perms.toTypedArray())
            })
        }
    }
}

/** WhatsApp's "Profile info": name and an optional photo. */
@Composable
fun ProfileSetupScreen(container: AppContainer, onDone: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val me by container.me.collectAsState()
    var name by rememberSaveable { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var uploading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        val user = me ?: runCatching { container.refreshMe() }.getOrNull()
        if (name.isBlank()) name = user?.displayName.orEmpty()
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        uploading = true
        scope.launch {
            try {
                container.setMe(safeCall { container.api.uploadAvatar(Files.avatarPart(context, uri)) })
            } catch (e: ApiException) {
                error = e.message
            } finally {
                uploading = false
            }
        }
    }

    fun finish() {
        if (name.isBlank()) {
            error = context.getString(R.string.name_required)
            return
        }
        saving = true
        scope.launch {
            try {
                container.setMe(safeCall { container.api.updateMe(ProfilePatch(displayName = name.trim())) })
                container.prefs.setProfileDone(true)
                onDone()
            } catch (e: ApiException) {
                error = e.message
                saving = false
            }
        }
    }

    Column(
        Modifier.fillMaxSize().background(Wa.colors.background).statusBarsPadding().navigationBarsPadding().imePadding().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(stringResource(R.string.profile_info), fontSize = 20.sp, fontWeight = FontWeight.Medium, color = Wa.colors.text)
        Spacer(Modifier.height(16.dp))
        Text(stringResource(R.string.profile_info_body), color = Wa.colors.textSecondary, textAlign = TextAlign.Center)
        Spacer(Modifier.height(28.dp))
        Box(
            Modifier.size(128.dp).clip(CircleShape).background(Wa.colors.chip).clickable {
                picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            },
            contentAlignment = Alignment.Center,
        ) {
            val url = container.client.absolute(me?.avatarUrl)
            when {
                uploading -> CircularProgressIndicator(color = Wa.colors.green)
                url != null -> Avatar(url, name, me?.address ?: "", size = 128.dp)
                else -> Icon(Icons.Filled.AddAPhoto, stringResource(R.string.add_photo), tint = Wa.colors.textSecondary, modifier = Modifier.size(44.dp))
            }
        }
        Spacer(Modifier.height(28.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
            Column(Modifier.weight(1f)) {
                BasicTextField(
                    value = name,
                    onValueChange = { name = it.take(60); error = null },
                    singleLine = true,
                    textStyle = TextStyle(fontSize = 18.sp, color = Wa.colors.text),
                    cursorBrush = SolidColor(Wa.colors.green),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Done),
                    modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                    decorationBox = { inner ->
                        if (name.isEmpty()) Text(stringResource(R.string.type_your_name), color = Wa.colors.textSecondary, fontSize = 18.sp)
                        inner()
                    },
                )
                HorizontalDivider(thickness = 2.dp, color = Wa.colors.green)
            }
            Spacer(Modifier.width(12.dp))
            Text("${60 - name.length}", color = Wa.colors.textSecondary, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 10.dp))
        }
        me?.let {
            Spacer(Modifier.height(16.dp))
            Text(stringResource(R.string.your_address_is, it.address), color = Wa.colors.textSecondary, textAlign = TextAlign.Center, fontSize = 14.sp)
        }
        error?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, color = Wa.colors.danger, fontSize = 14.sp)
        }
        Spacer(Modifier.weight(1f))
        GreenButton(stringResource(R.string.next), onClick = { finish() }, loading = saving)
    }
}
