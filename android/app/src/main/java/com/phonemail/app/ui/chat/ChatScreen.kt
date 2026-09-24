package com.phonemail.app.ui.chat

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.EmojiEmotions
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.OpenInFull
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import com.phonemail.app.AppContainer
import com.phonemail.app.R
import com.phonemail.app.data.Files
import com.phonemail.app.data.Message
import com.phonemail.app.ui.components.Avatar
import com.phonemail.app.ui.components.ConfirmDialog
import com.phonemail.app.ui.components.LoadingBox
import com.phonemail.app.ui.components.rememberChatWallpaper
import com.phonemail.app.ui.compose.ComposeArgs
import com.phonemail.app.ui.home.conversationAvatarUrl
import com.phonemail.app.ui.home.conversationTitle
import com.phonemail.app.ui.theme.Wa
import com.phonemail.app.util.ActiveChat
import com.phonemail.app.util.daySeparator
import com.phonemail.app.util.localDateOf
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    container: AppContainer,
    conversationId: String,
    onBack: () -> Unit,
    onOpenEmail: (String) -> Unit,
    onCompose: (ComposeArgs) -> Unit,
) {
    val vm: ChatViewModel = viewModel(key = "chat-$conversationId") { ChatViewModel(container, conversationId) }
    val state by vm.state.collectAsState()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val listState = rememberLazyListState()
    val keyboard = LocalSoftwareKeyboardController.current
    val messageFocus = remember { FocusRequester() }
    var menuFor by remember { mutableStateOf<Message?>(null) }
    var topMenu by remember { mutableStateOf(false) }
    var infoSheet by remember { mutableStateOf(false) }
    var confirmDeleteChat by remember { mutableStateOf(false) }
    var confirmSpam by remember { mutableStateOf(false) }
    val lifecycleOwner = LocalLifecycleOwner.current
    val conversation = state.conversation
    val title = conversation?.let { conversationTitle(container, it) } ?: ""

    DisposableEffect(lifecycleOwner, conversationId) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> {
                    ActiveChat.conversationId = conversationId
                    vm.onResume()
                }
                Lifecycle.Event.ON_PAUSE -> {
                    if (ActiveChat.conversationId == conversationId) ActiveChat.conversationId = null
                    vm.onPause()
                }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            if (ActiveChat.conversationId == conversationId) ActiveChat.conversationId = null
        }
    }
    LaunchedEffect(Unit) { vm.messages.collect { snackbar.showSnackbar(it) } }
    LaunchedEffect(state.gone) { if (state.gone) onBack() }

    // Stick to the newest message when one arrives while we're at the bottom.
    val newestId = state.messages.firstOrNull()?.id
    LaunchedEffect(newestId) {
        if (newestId != null && listState.firstVisibleItemIndex <= 2) listState.animateScrollToItem(0)
    }
    // Load older mail when scrolled near the top.
    val nearTop by remember { derivedStateOf { (listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= listState.layoutInfo.totalItemsCount - 3 } }
    LaunchedEffect(nearTop, state.nextCursor) { if (nearTop && state.nextCursor != null) vm.loadMore() }

    val attachLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) vm.attach(context, uris)
    }

    fun openAttachment(att: com.phonemail.app.data.Attachment) {
        scope.launch {
            val ok = runCatching { Files.open(context, container.client, att) }.getOrElse {
                snackbar.showSnackbar(it.message ?: context.getString(R.string.generic_error)); return@launch
            }
            if (!ok) snackbar.showSnackbar(context.getString(R.string.no_app_to_open))
        }
    }

    fun startReply(m: Message) {
        if (vm.setReplyTo(context, m)) {
            runCatching { messageFocus.requestFocus() }
            keyboard?.show()
        }
    }

    fun openTraditional() {
        val reply = state.replyTo
        vm.handoff()
        onCompose(ComposeArgs(conversationId = conversationId, replyTo = reply?.id))
    }

    Scaffold(
        containerColor = Wa.colors.chatBackground,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                navigationIcon = {
                    Row(Modifier.clickable(onClick = onBack).padding(start = 4.dp, end = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back), tint = Wa.colors.onTopBar)
                        Spacer(Modifier.width(2.dp))
                        if (conversation != null) {
                            Avatar(conversationAvatarUrl(container, conversation), title, conversation.participants.firstOrNull()?.address ?: conversationId, size = 38.dp, group = conversation.isGroup)
                        }
                    }
                },
                title = {
                    Column(Modifier.clickable { infoSheet = true }) {
                        Text(title, color = Wa.colors.text, fontSize = 17.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        val subtitle = when {
                            conversation == null -> ""
                            conversation.isSelf -> stringResource(R.string.message_yourself)
                            conversation.isGroup -> stringResource(R.string.group_subtitle, conversation.participants.size + 1)
                            else -> conversation.participants.first().address
                        }
                        if (subtitle.isNotEmpty()) Text(subtitle, color = Wa.colors.textSecondary, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                },
                actions = {
                    IconButton(onClick = vm::toggleFavorite) {
                        Icon(
                            if (conversation?.isFavorite == true) Icons.Filled.Star else Icons.Filled.StarBorder,
                            stringResource(if (conversation?.isFavorite == true) R.string.remove_from_favorites else R.string.add_to_favorites),
                            tint = if (conversation?.isFavorite == true) Wa.colors.star else Wa.colors.onTopBar,
                        )
                    }
                    Box {
                        IconButton(onClick = { topMenu = true }) { Icon(Icons.Filled.MoreVert, stringResource(R.string.more_options), tint = Wa.colors.onTopBar) }
                        DropdownMenu(expanded = topMenu, onDismissRequest = { topMenu = false }) {
                            DropdownMenuItem(text = { Text(stringResource(R.string.chat_info)) }, onClick = { topMenu = false; infoSheet = true })
                            DropdownMenuItem(text = { Text(stringResource(R.string.new_email_traditional)) }, onClick = { topMenu = false; openTraditional() })
                            DropdownMenuItem(text = { Text(stringResource(R.string.mark_as_unread)) }, onClick = { topMenu = false; vm.markUnread(onBack) })
                            if (conversation?.isSelf != true) {
                                DropdownMenuItem(text = { Text(stringResource(R.string.report_spam)) }, onClick = { topMenu = false; confirmSpam = true })
                            }
                            DropdownMenuItem(text = { Text(stringResource(R.string.delete_chat)) }, onClick = { topMenu = false; confirmDeleteChat = true })
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Wa.colors.topBar),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(top = padding.calculateTopPadding())
                .background(rememberChatWallpaper())
                .navigationBarsPadding()
                .imePadding(),
        ) {
            Box(Modifier.weight(1f).fillMaxWidth()) {
                if (state.loading) {
                    LoadingBox()
                } else {
                    val messages = state.messages
                    LazyColumn(state = listState, reverseLayout = true, modifier = Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp)) {
                        itemsIndexed(messages, key = { _, m -> m.id }) { index, m ->
                            val older = messages.getOrNull(index + 1)
                            val newDay = older == null || localDateOf(older.sentAt) != localDateOf(m.sentAt)
                            val showTail = newDay || older?.direction != m.direction || older.from.address != m.from.address
                            Column {
                                if (newDay) DateChip(daySeparator(context, localDateOf(m.sentAt)))
                                Box {
                                    MessageBubble(
                                        container = container,
                                        message = m,
                                        isGroup = conversation?.isGroup == true,
                                        showTail = showTail,
                                        onOpen = { onOpenEmail(m.id) },
                                        onLongPress = { menuFor = m },
                                        onSwipeReply = { startReply(m) },
                                        onQuoteClick = { id -> onOpenEmail(id) },
                                        onAttachment = ::openAttachment,
                                    )
                                    MessageMenu(
                                        expanded = menuFor?.id == m.id,
                                        message = m,
                                        onDismiss = { menuFor = null },
                                        onReply = { menuFor = null; startReply(m) },
                                        onReplyTraditional = {
                                            menuFor = null
                                            if (vm.setReplyTo(context, m)) openTraditional()
                                        },
                                        onStar = { menuFor = null; vm.toggleStar(m) },
                                        onCopy = {
                                            menuFor = null
                                            copyText(context, chatText(m).ifBlank { m.subject })
                                        },
                                        onDelete = { menuFor = null; vm.deleteMessage(m) },
                                    )
                                }
                            }
                        }
                        if (state.loadingMore) {
                            item(key = "more") {
                                Box(Modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) {
                                    CircularProgressIndicator(Modifier.size(24.dp), color = Wa.colors.green, strokeWidth = 2.dp)
                                }
                            }
                        }
                        if (state.nextCursor == null) {
                            item(key = "intro") { EncryptionNotice() }
                        }
                    }
                }
            }
            ChatInput(
                container = container,
                state = state,
                canSend = vm.canSend(state),
                focus = messageFocus,
                onSubject = vm::setSubject,
                onBody = vm::setBody,
                onCancelReply = { vm.setReplyTo(context, null) },
                onAttach = { attachLauncher.launch(arrayOf("*/*")) },
                onRemoveAttachment = vm::removeAttachment,
                onTraditional = ::openTraditional,
                onEmoji = {
                    runCatching { messageFocus.requestFocus() }
                    keyboard?.show()
                },
                onSend = vm::send,
            )
        }
    }

    if (infoSheet && conversation != null) {
        ModalBottomSheet(onDismissRequest = { infoSheet = false }, containerColor = Wa.colors.surface) {
            Column(Modifier.fillMaxWidth().padding(bottom = 32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Avatar(conversationAvatarUrl(container, conversation), title, conversation.participants.firstOrNull()?.address ?: conversationId, size = 96.dp, group = conversation.isGroup)
                Spacer(Modifier.height(12.dp))
                Text(title, fontSize = 20.sp, color = Wa.colors.text, fontWeight = FontWeight.Medium, modifier = Modifier.padding(horizontal = 24.dp))
                Spacer(Modifier.height(16.dp))
                conversation.participants.forEach { p ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Avatar(container.client.absolute(p.avatarUrl), container.participantName(p), p.address, size = 40.dp)
                        Spacer(Modifier.width(14.dp))
                        Column(Modifier.weight(1f)) {
                            Text(container.participantName(p), color = Wa.colors.text, fontSize = 16.sp)
                            Text(p.address, color = Wa.colors.textSecondary, fontSize = 14.sp)
                            if (!p.isLocal) Text(stringResource(R.string.external_address), color = Wa.colors.textSecondary, fontSize = 12.sp)
                        }
                        IconButton(onClick = { copyText(context, p.address) }) { Icon(Icons.Filled.ContentCopy, stringResource(R.string.copy), tint = Wa.colors.textSecondary) }
                    }
                }
                Spacer(Modifier.height(8.dp))
                Text(stringResource(R.string.recipients_locked_note), color = Wa.colors.textSecondary, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 24.dp))
            }
        }
    }
    if (confirmDeleteChat) {
        ConfirmDialog(
            title = stringResource(R.string.delete_chat_q),
            text = stringResource(R.string.delete_chat_body),
            confirm = stringResource(R.string.delete),
            dismiss = stringResource(R.string.cancel),
            danger = true,
            onConfirm = { confirmDeleteChat = false; vm.deleteChat(onBack) },
            onDismiss = { confirmDeleteChat = false },
        )
    }
    if (confirmSpam) {
        ConfirmDialog(
            title = stringResource(R.string.report_spam_q),
            text = stringResource(R.string.report_spam_body),
            confirm = stringResource(R.string.report),
            dismiss = stringResource(R.string.cancel),
            danger = true,
            onConfirm = { confirmSpam = false; vm.reportSpam(onBack) },
            onDismiss = { confirmSpam = false },
        )
    }
}

private fun copyText(context: Context, text: String) {
    context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("PhoneMail", text))
    Toast.makeText(context, R.string.copied, Toast.LENGTH_SHORT).show()
}

@Composable
private fun DateChip(text: String) {
    Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
        Surface(shape = RoundedCornerShape(8.dp), color = Wa.colors.dateChip, shadowElevation = 0.5.dp) {
            Text(text, modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp), fontSize = 12.5.sp, color = Wa.colors.textSecondary, fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
private fun EncryptionNotice() {
    Box(Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 10.dp), contentAlignment = Alignment.Center) {
        Surface(shape = RoundedCornerShape(8.dp), color = Wa.colors.chipSelected.copy(alpha = 0.9f)) {
            Text(
                stringResource(R.string.chat_intro_notice),
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                fontSize = 12.5.sp,
                color = Wa.colors.chipSelectedText,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
    }
}

@Composable
private fun MessageMenu(
    expanded: Boolean,
    message: Message,
    onDismiss: () -> Unit,
    onReply: () -> Unit,
    onReplyTraditional: () -> Unit,
    onStar: () -> Unit,
    onCopy: () -> Unit,
    onDelete: () -> Unit,
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        if (message.canReply) {
            MenuItem(Icons.AutoMirrored.Filled.Reply, stringResource(R.string.reply), onReply)
            MenuItem(Icons.Filled.OpenInFull, stringResource(R.string.reply_traditional), onReplyTraditional)
        } else {
            DropdownMenuItem(text = { Text(stringResource(R.string.already_replied), color = Wa.colors.textSecondary, fontSize = 13.sp) }, onClick = onDismiss, enabled = false)
        }
        MenuItem(if (message.isStarred) Icons.Filled.StarBorder else Icons.Filled.Star, stringResource(if (message.isStarred) R.string.unstar else R.string.star), onStar)
        MenuItem(Icons.Filled.ContentCopy, stringResource(R.string.copy), onCopy)
        MenuItem(Icons.Filled.Delete, stringResource(R.string.delete), onDelete)
    }
}

@Composable
private fun MenuItem(icon: ImageVector, label: String, onClick: () -> Unit) {
    DropdownMenuItem(text = { Text(label) }, onClick = onClick, leadingIcon = { Icon(icon, null, tint = Wa.colors.textSecondary) })
}

@Composable
private fun ChatInput(
    container: AppContainer,
    state: ChatState,
    canSend: Boolean,
    focus: FocusRequester,
    onSubject: (String) -> Unit,
    onBody: (String) -> Unit,
    onCancelReply: () -> Unit,
    onAttach: () -> Unit,
    onRemoveAttachment: (String) -> Unit,
    onTraditional: () -> Unit,
    onEmoji: () -> Unit,
    onSend: () -> Unit,
) {
    val colors = Wa.colors
    val reply = state.replyTo
    Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 6.dp), verticalAlignment = Alignment.Bottom) {
        Column(Modifier.weight(1f)) {
            // Compact subject field above the message box, hidden while replying.
            if (reply == null) {
                Surface(shape = RoundedCornerShape(18.dp), color = colors.inputBar, shadowElevation = 1.dp, modifier = Modifier.padding(bottom = 4.dp)) {
                    BasicTextField(
                        value = state.subject,
                        onValueChange = onSubject,
                        singleLine = true,
                        textStyle = TextStyle(fontSize = 14.sp, color = colors.text, fontWeight = FontWeight.Medium),
                        cursorBrush = SolidColor(colors.green),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Next),
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                        decorationBox = { inner ->
                            if (state.subject.isEmpty()) Text(stringResource(R.string.subject), color = colors.textSecondary, fontSize = 14.sp)
                            inner()
                        },
                    )
                }
            }
            Surface(shape = RoundedCornerShape(24.dp), color = colors.inputBar, shadowElevation = 1.dp) {
                Column {
                    if (reply != null) {
                        QuoteBlock(
                            senderLabel = if (reply.isOutgoing) stringResource(R.string.you) else container.displayNameFor(reply.from.address, reply.from.name),
                            subject = reply.subject,
                            snippet = reply.snippet,
                            background = colors.quoteBackgroundIn,
                            modifier = Modifier.padding(start = 6.dp, end = 6.dp, top = 6.dp),
                            trailing = {
                                Row {
                                    IconButton(onClick = onTraditional, modifier = Modifier.size(36.dp)) {
                                        Icon(Icons.Filled.OpenInFull, stringResource(R.string.reply_traditional), tint = colors.textSecondary, modifier = Modifier.size(18.dp))
                                    }
                                    IconButton(onClick = onCancelReply, modifier = Modifier.size(36.dp)) {
                                        Icon(Icons.Filled.Close, stringResource(R.string.cancel_reply), tint = colors.textSecondary, modifier = Modifier.size(18.dp))
                                    }
                                }
                            },
                        )
                    }
                    if (state.attachments.isNotEmpty() || state.uploading > 0) {
                        Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                state.attachments.forEach { a ->
                                    Row(
                                        Modifier.clip(RoundedCornerShape(8.dp)).background(colors.chip).padding(start = 8.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Icon(Icons.AutoMirrored.Filled.InsertDriveFile, null, tint = colors.textSecondary, modifier = Modifier.size(16.dp))
                                        Spacer(Modifier.width(6.dp))
                                        Text(a.filename, fontSize = 13.sp, color = colors.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                                        IconButton(onClick = { onRemoveAttachment(a.id) }, modifier = Modifier.size(32.dp)) {
                                            Icon(Icons.Filled.Close, stringResource(R.string.remove), tint = colors.textSecondary, modifier = Modifier.size(16.dp))
                                        }
                                    }
                                }
                                if (state.uploading > 0) Text(stringResource(R.string.uploading), fontSize = 12.sp, color = colors.textSecondary)
                            }
                        }
                    }
                    Row(verticalAlignment = Alignment.Bottom) {
                        IconButton(onClick = onEmoji) { Icon(Icons.Filled.EmojiEmotions, stringResource(R.string.emoji), tint = colors.textSecondary) }
                        BasicTextField(
                            value = state.body,
                            onValueChange = onBody,
                            textStyle = TextStyle(fontSize = 16.sp, color = colors.text),
                            cursorBrush = SolidColor(colors.green),
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                            maxLines = 6,
                            modifier = Modifier.weight(1f).heightIn(min = 48.dp).padding(vertical = 13.dp).focusRequester(focus),
                            decorationBox = { inner ->
                                if (state.body.isEmpty()) Text(stringResource(if (reply != null) R.string.type_reply else R.string.type_email), color = colors.textSecondary, fontSize = 16.sp)
                                inner()
                            },
                        )
                        IconButton(onClick = onAttach) { Icon(Icons.Filled.AttachFile, stringResource(R.string.attach), tint = colors.textSecondary) }
                        // Where WhatsApp has its camera button: compose in the traditional email view.
                        IconButton(onClick = onTraditional) { Icon(Icons.Outlined.Email, stringResource(R.string.traditional_view), tint = colors.textSecondary) }
                    }
                }
            }
        }
        Spacer(Modifier.width(6.dp))
        Box(
            Modifier
                .size(50.dp)
                .clip(CircleShape)
                .background(if (canSend) colors.green else colors.green.copy(alpha = 0.55f))
                .clickable(enabled = canSend, onClick = onSend),
            contentAlignment = Alignment.Center,
        ) {
            if (state.sending) CircularProgressIndicator(Modifier.size(22.dp), color = colors.onGreen, strokeWidth = 2.dp)
            else Icon(Icons.AutoMirrored.Filled.Send, stringResource(R.string.send), tint = colors.onGreen)
        }
    }
}
