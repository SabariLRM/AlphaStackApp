package com.phonemail.app.ui.compose

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.phonemail.app.AppContainer
import com.phonemail.app.R
import com.phonemail.app.ui.components.ConfirmDialog
import com.phonemail.app.ui.components.LoadingBox
import com.phonemail.app.ui.theme.Wa
import com.phonemail.app.util.fileSize

/** Traditional email view for writing: From / To / Cc / Subject / body, like a regular mail app. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ComposeScreen(container: AppContainer, args: ComposeArgs, onClose: () -> Unit, onSentToChat: (String) -> Unit) {
    val vm: ComposeViewModel = viewModel(key = "compose-${args.route()}") { ComposeViewModel(container, args) }
    val state by vm.state.collectAsState()
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    var menu by remember { mutableStateOf(false) }
    var fromMenu by remember { mutableStateOf(false) }
    var confirmDiscard by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { vm.events.collect { snackbar.showSnackbar(it) } }

    val attachLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) vm.attach(context, uris)
    }

    fun close() {
        if (vm.saveDraftOnExit()) Toast.makeText(context, R.string.draft_saved, Toast.LENGTH_SHORT).show()
        onClose()
    }
    BackHandler { close() }

    val title = when {
        state.replyTo != null -> stringResource(R.string.reply)
        state.draftId != null -> stringResource(R.string.draft)
        else -> stringResource(R.string.compose)
    }

    Scaffold(
        containerColor = Wa.colors.background,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = ::close) { Icon(Icons.Filled.Close, stringResource(R.string.close), tint = Wa.colors.onTopBar) } },
                title = { Text(title, color = Wa.colors.text) },
                actions = {
                    IconButton(onClick = { attachLauncher.launch(arrayOf("*/*")) }) { Icon(Icons.Filled.AttachFile, stringResource(R.string.attach), tint = Wa.colors.onTopBar) }
                    IconButton(onClick = { vm.send(onSentToChat) }, enabled = !state.sending && state.uploading == 0) {
                        if (state.sending) CircularProgressIndicator(Modifier.size(22.dp), color = Wa.colors.green, strokeWidth = 2.dp)
                        else Icon(Icons.AutoMirrored.Filled.Send, stringResource(R.string.send), tint = Wa.colors.green)
                    }
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, stringResource(R.string.more_options), tint = Wa.colors.onTopBar) }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text(stringResource(R.string.save_draft)) }, onClick = { menu = false; close() })
                            DropdownMenuItem(text = { Text(stringResource(R.string.discard)) }, onClick = { menu = false; confirmDiscard = true })
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Wa.colors.topBar),
            )
        },
    ) { padding ->
        if (state.loading) {
            LoadingBox(Modifier.padding(padding))
            return@Scaffold
        }
        Column(
            Modifier.fillMaxSize().padding(padding).navigationBarsPadding().imePadding().verticalScroll(rememberScrollState()),
        ) {
            if (state.fromOptions.size > 1) {
                FieldRow(stringResource(R.string.from_label)) {
                    Box(Modifier.weight(1f)) {
                        Row(Modifier.clickable { fromMenu = true }.padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(state.from, color = Wa.colors.text, fontSize = 16.sp, modifier = Modifier.weight(1f, fill = false))
                            Icon(Icons.Filled.ArrowDropDown, null, tint = Wa.colors.textSecondary)
                        }
                        DropdownMenu(expanded = fromMenu, onDismissRequest = { fromMenu = false }) {
                            state.fromOptions.forEach { a -> DropdownMenuItem(text = { Text(a) }, onClick = { fromMenu = false; vm.setFrom(a) }) }
                        }
                    }
                }
            }
            RecipientField(
                label = stringResource(R.string.to_label),
                recipients = state.to,
                locked = state.locked,
                text = state.pendingTo,
                onText = { vm.setPending(it, cc = false) },
                onCommit = { vm.commitPending(cc = false) },
                onRemove = { vm.removeRecipient(it, cc = false) },
                // A new email starts in the To field, like any mail app.
                autoFocus = !state.locked && state.to.isEmpty() && state.draftId == null,
                trailing = {
                    if (!state.locked) {
                        IconButton(onClick = vm::toggleCc) { Icon(if (state.showCc) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, stringResource(R.string.cc_label), tint = Wa.colors.textSecondary) }
                    }
                },
            )
            if (state.locked) {
                Text(stringResource(R.string.recipients_locked_note), color = Wa.colors.textSecondary, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
                HorizontalDivider(color = Wa.colors.divider)
            }
            if (state.showCc && !state.locked) {
                RecipientField(
                    label = stringResource(R.string.cc_label),
                    recipients = state.cc,
                    locked = false,
                    text = state.pendingCc,
                    onText = { vm.setPending(it, cc = true) },
                    onCommit = { vm.commitPending(cc = true) },
                    onRemove = { vm.removeRecipient(it, cc = true) },
                )
            }
            if (state.replyTo != null) {
                FieldRow(stringResource(R.string.subject)) {
                    val original = state.replyTo!!.subject
                    Text(if (original.startsWith("Re:", true)) original else "Re: $original", color = Wa.colors.textSecondary, fontSize = 16.sp, modifier = Modifier.padding(vertical = 12.dp))
                }
            } else {
                FieldRow(null) {
                    PlainField(state.subject, vm::setSubject, stringResource(R.string.subject), single = true, modifier = Modifier.weight(1f).padding(vertical = 12.dp))
                }
            }
            PlainField(
                state.body,
                vm::setBody,
                stringResource(R.string.compose_email),
                single = false,
                modifier = Modifier.fillMaxWidth().heightIn(min = 220.dp).padding(horizontal = 16.dp, vertical = 12.dp),
            )
            if (state.attachments.isNotEmpty() || state.uploading > 0) {
                Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    state.attachments.forEach { a ->
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Wa.colors.chip).padding(start = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.AutoMirrored.Filled.InsertDriveFile, null, tint = Wa.colors.danger)
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(a.filename, color = Wa.colors.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(fileSize(a.size), color = Wa.colors.textSecondary, fontSize = 12.sp)
                            }
                            IconButton(onClick = { vm.removeAttachment(a.id) }) { Icon(Icons.Filled.Close, stringResource(R.string.remove), tint = Wa.colors.textSecondary) }
                        }
                    }
                    if (state.uploading > 0) Text(stringResource(R.string.uploading), color = Wa.colors.textSecondary, fontSize = 13.sp)
                }
            }
            state.replyTo?.let { o ->
                Column(Modifier.padding(16.dp).fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Wa.colors.chip).padding(12.dp)) {
                    Text(
                        stringResource(R.string.original_message_from, container.displayNameFor(o.from.address, o.from.name)),
                        color = Wa.colors.textSecondary,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium,
                    )
                    Spacer(Modifier.size(4.dp))
                    Text(o.text.ifBlank { o.snippet }, color = Wa.colors.textSecondary, fontSize = 13.sp, maxLines = 8, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }

    if (confirmDiscard) {
        ConfirmDialog(
            title = stringResource(R.string.discard_q),
            text = null,
            confirm = stringResource(R.string.discard),
            dismiss = stringResource(R.string.cancel),
            danger = true,
            onConfirm = { confirmDiscard = false; vm.discard(onClose) },
            onDismiss = { confirmDiscard = false },
        )
    }
}

@Composable
private fun FieldRow(label: String?, content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        if (label != null) {
            Text(label, color = Wa.colors.textSecondary, fontSize = 16.sp, modifier = Modifier.widthIn(min = 56.dp).padding(end = 12.dp))
        }
        content()
    }
    HorizontalDivider(color = Wa.colors.divider)
}

@Composable
private fun PlainField(value: String, onChange: (String) -> Unit, placeholder: String, single: Boolean, modifier: Modifier = Modifier) {
    BasicTextField(
        value = value,
        onValueChange = onChange,
        singleLine = single,
        textStyle = TextStyle(fontSize = 16.sp, color = Wa.colors.text, lineHeight = 22.sp),
        cursorBrush = SolidColor(Wa.colors.green),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        modifier = modifier,
        decorationBox = { inner ->
            Box {
                if (value.isEmpty()) Text(placeholder, color = Wa.colors.textSecondary, fontSize = 16.sp)
                inner()
            }
        },
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RecipientField(
    label: String,
    recipients: List<Recipient>,
    locked: Boolean,
    text: String,
    onText: (String) -> Unit,
    onCommit: () -> Unit,
    onRemove: (Recipient) -> Unit,
    autoFocus: Boolean = false,
    trailing: (@Composable () -> Unit)? = null,
) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(autoFocus) { if (autoFocus) runCatching { focus.requestFocus() } }
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = Wa.colors.textSecondary, fontSize = 16.sp, modifier = Modifier.widthIn(min = 56.dp).padding(end = 12.dp))
        FlowRow(Modifier.weight(1f).padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            recipients.forEach { r ->
                Row(
                    Modifier
                        .clip(RoundedCornerShape(16.dp))
                        .background(if (r.invalid) Wa.colors.danger.copy(alpha = 0.12f) else Wa.colors.chipSelected)
                        .padding(start = 12.dp, end = if (locked) 12.dp else 4.dp, top = 5.dp, bottom = 5.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(r.label, color = if (r.invalid) Wa.colors.danger else Wa.colors.chipSelectedText, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 220.dp))
                    if (!locked) {
                        Icon(Icons.Filled.Close, stringResource(R.string.remove), tint = Wa.colors.textSecondary, modifier = Modifier.padding(start = 4.dp).size(18.dp).clickable { onRemove(r) })
                    }
                }
            }
            if (!locked) {
                BasicTextField(
                    value = text,
                    onValueChange = onText,
                    singleLine = true,
                    textStyle = TextStyle(fontSize = 16.sp, color = Wa.colors.text),
                    cursorBrush = SolidColor(Wa.colors.green),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = { onCommit() }),
                    modifier = Modifier.widthIn(min = 120.dp).padding(vertical = 5.dp).focusRequester(focus).onFocusChanged { if (!it.isFocused) onCommit() },
                    decorationBox = { inner ->
                        Box {
                            if (text.isEmpty() && recipients.isEmpty()) Text(stringResource(R.string.recipient_hint), color = Wa.colors.textSecondary, fontSize = 16.sp)
                            inner()
                        }
                    },
                )
            }
        }
        if (locked) Icon(Icons.Filled.Lock, stringResource(R.string.locked), tint = Wa.colors.textSecondary, modifier = Modifier.padding(end = 12.dp).size(18.dp))
        trailing?.invoke()
    }
    HorizontalDivider(color = Wa.colors.divider)
}
