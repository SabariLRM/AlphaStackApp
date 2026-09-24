package com.phonemail.app.ui.folders

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.Drafts
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Report
import androidx.compose.material.icons.filled.RestoreFromTrash
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
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.phonemail.app.AppContainer
import com.phonemail.app.R
import com.phonemail.app.data.ApiException
import com.phonemail.app.data.BatchRequest
import com.phonemail.app.data.Draft
import com.phonemail.app.data.Message
import com.phonemail.app.data.safeCall
import com.phonemail.app.ui.components.Avatar
import com.phonemail.app.ui.components.ConfirmDialog
import com.phonemail.app.ui.components.EmptyState
import com.phonemail.app.ui.components.LoadingBox
import com.phonemail.app.ui.theme.Wa
import com.phonemail.app.util.chatListTime
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class FolderState(
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val messages: List<Message> = emptyList(),
    val drafts: List<Draft> = emptyList(),
    val error: String? = null,
)

class FolderViewModel(private val container: AppContainer, val folder: String) : ViewModel() {
    private val _state = MutableStateFlow(FolderState())
    val state: StateFlow<FolderState> = _state

    init {
        viewModelScope.launch { container.realtime.events.collect { load() } }
    }

    fun load(pull: Boolean = false) {
        if (pull) _state.update { it.copy(refreshing = true) }
        viewModelScope.launch {
            try {
                if (folder == "drafts") {
                    val drafts = safeCall { container.api.drafts() }.items
                    _state.update { it.copy(drafts = drafts, loading = false, refreshing = false) }
                } else {
                    val page = safeCall { container.api.messages(folder, limit = 100) }
                    _state.update { it.copy(messages = page.items, loading = false, refreshing = false) }
                }
            } catch (e: ApiException) {
                _state.update { it.copy(error = e.message, loading = false, refreshing = false) }
            }
        }
    }

    fun act(ids: List<String>, action: String) {
        viewModelScope.launch {
            runCatching { safeCall { container.api.batch(BatchRequest(ids, action)) } }.onFailure { e -> _state.update { it.copy(error = e.message) } }
            load()
        }
    }

    fun empty() {
        viewModelScope.launch {
            runCatching { safeCall { container.api.emptyFolder(folder) } }.onFailure { e -> _state.update { it.copy(error = e.message) } }
            load()
        }
    }

    fun deleteDraft(id: String) {
        viewModelScope.launch {
            runCatching { safeCall { container.api.deleteDraft(id) } }.onFailure { e -> _state.update { it.copy(error = e.message) } }
            load()
        }
    }

    fun clearError() = _state.update { it.copy(error = null) }
}

/** Drafts, Spam and Trash from the Home menu. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun FolderScreen(container: AppContainer, folder: String, onBack: () -> Unit, onOpenEmail: (String) -> Unit, onOpenDraft: (String) -> Unit) {
    val vm: FolderViewModel = viewModel(key = "folder-$folder") { FolderViewModel(container, folder) }
    val state by vm.state.collectAsState()
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    var menuFor by remember { mutableStateOf<String?>(null) }
    var confirmEmpty by remember { mutableStateOf(false) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle) { lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) { vm.load() } }
    LaunchedEffect(state.error) { state.error?.let { snackbar.showSnackbar(it); vm.clearError() } }

    val title = when (folder) {
        "drafts" -> stringResource(R.string.drawer_drafts)
        "spam" -> stringResource(R.string.drawer_spam)
        else -> stringResource(R.string.drawer_trash)
    }
    Scaffold(
        containerColor = Wa.colors.background,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back), tint = Wa.colors.onTopBar) } },
                title = { Text(title, color = Wa.colors.text) },
                actions = {
                    if (folder != "drafts" && state.messages.isNotEmpty()) {
                        TextButton(onClick = { confirmEmpty = true }) {
                            Text(stringResource(if (folder == "spam") R.string.empty_spam else R.string.empty_trash), color = Wa.colors.danger)
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Wa.colors.topBar),
            )
        },
    ) { padding ->
        PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = { vm.load(pull = true) }, modifier = Modifier.fillMaxSize().padding(padding)) {
            if (state.loading) {
                LoadingBox()
                return@PullToRefreshBox
            }
            LazyColumn(Modifier.fillMaxSize()) {
                if (folder != "drafts" && state.messages.isNotEmpty()) {
                    item {
                        Text(
                            stringResource(if (folder == "spam") R.string.spam_banner else R.string.trash_banner),
                            color = Wa.colors.textSecondary,
                            fontSize = 13.sp,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                        )
                        HorizontalDivider(color = Wa.colors.divider)
                    }
                }
                if (folder == "drafts") {
                    items(state.drafts, key = { it.id }) { d ->
                        val to = if (d.participants.isNotEmpty()) d.participants.joinToString(", ") { container.participantName(it) } else d.to.joinToString(", ")
                        Box {
                            Row(
                                Modifier.fillMaxWidth().combinedClickable(onClick = { onOpenDraft(d.id) }, onLongClick = { menuFor = d.id }).padding(horizontal = 16.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Avatar(null, to.ifBlank { "?" }, d.participants.firstOrNull()?.address ?: d.to.firstOrNull() ?: d.id, size = 48.dp, group = d.participants.size > 1 || d.to.size > 1)
                                Spacer(Modifier.width(14.dp))
                                Column(Modifier.weight(1f)) {
                                    Row {
                                        Text(to.ifBlank { stringResource(R.string.no_recipients) }, modifier = Modifier.weight(1f), color = Wa.colors.text, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        Text(chatListTime(context, d.updatedAt), color = Wa.colors.textSecondary, fontSize = 12.sp)
                                    }
                                    Row {
                                        Text(stringResource(R.string.draft_prefix) + " ", color = Wa.colors.danger, fontSize = 14.sp)
                                        Text(listOf(d.subject, d.body.replace('\n', ' ')).filter { it.isNotBlank() }.joinToString(" – ").ifBlank { stringResource(R.string.no_subject) }, color = Wa.colors.textSecondary, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    }
                                }
                            }
                            DropdownMenu(expanded = menuFor == d.id, onDismissRequest = { menuFor = null }) {
                                DropdownMenuItem(text = { Text(stringResource(R.string.discard)) }, leadingIcon = { Icon(Icons.Filled.Delete, null) }, onClick = { menuFor = null; vm.deleteDraft(d.id) })
                            }
                        }
                    }
                } else {
                    items(state.messages, key = { it.id }) { m ->
                        Box {
                            Row(
                                Modifier.fillMaxWidth().combinedClickable(onClick = { onOpenEmail(m.id) }, onLongClick = { menuFor = m.id }).padding(horizontal = 16.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                val other = if (m.isOutgoing) m.to.firstOrNull() ?: m.from else m.from
                                val otherName = container.displayNameFor(other.address, other.name)
                                val who = if (m.isOutgoing) stringResource(R.string.to_list, m.to.joinToString(", ") { container.displayNameFor(it.address, it.name) }) else otherName
                                Avatar(null, otherName, other.address, size = 48.dp, group = m.isOutgoing && m.to.size + m.cc.size > 1)
                                Spacer(Modifier.width(14.dp))
                                Column(Modifier.weight(1f)) {
                                    Row {
                                        Text(who, modifier = Modifier.weight(1f), color = Wa.colors.text, fontWeight = if (m.isRead) FontWeight.Normal else FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        Text(chatListTime(context, m.sentAt), color = Wa.colors.textSecondary, fontSize = 12.sp)
                                    }
                                    Text(m.subject.ifBlank { stringResource(R.string.no_subject) }, color = Wa.colors.text, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(m.snippet, color = Wa.colors.textSecondary, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                                if (folder == "spam") {
                                    IconButton(onClick = { vm.act(listOf(m.id), "not_spam") }) { Icon(Icons.Filled.Inbox, stringResource(R.string.not_spam), tint = Wa.colors.greenDark) }
                                } else {
                                    IconButton(onClick = { vm.act(listOf(m.id), "restore") }) { Icon(Icons.Filled.RestoreFromTrash, stringResource(R.string.restore), tint = Wa.colors.greenDark) }
                                }
                            }
                            DropdownMenu(expanded = menuFor == m.id, onDismissRequest = { menuFor = null }) {
                                if (folder == "spam") {
                                    DropdownMenuItem(text = { Text(stringResource(R.string.not_spam)) }, leadingIcon = { Icon(Icons.Filled.Inbox, null) }, onClick = { menuFor = null; vm.act(listOf(m.id), "not_spam") })
                                } else {
                                    DropdownMenuItem(text = { Text(stringResource(R.string.restore)) }, leadingIcon = { Icon(Icons.Filled.RestoreFromTrash, null) }, onClick = { menuFor = null; vm.act(listOf(m.id), "restore") })
                                }
                                DropdownMenuItem(text = { Text(stringResource(R.string.delete_forever)) }, leadingIcon = { Icon(Icons.Filled.DeleteForever, null) }, onClick = { menuFor = null; vm.act(listOf(m.id), "delete") })
                            }
                        }
                    }
                }
                val empty = if (folder == "drafts") state.drafts.isEmpty() else state.messages.isEmpty()
                if (empty) {
                    item {
                        when (folder) {
                            "drafts" -> EmptyState(Icons.Filled.Drafts, stringResource(R.string.no_drafts))
                            "spam" -> EmptyState(Icons.Filled.Report, stringResource(R.string.no_spam))
                            else -> EmptyState(Icons.Filled.Delete, stringResource(R.string.no_trash))
                        }
                    }
                }
            }
        }
    }
    if (confirmEmpty) {
        ConfirmDialog(
            title = stringResource(if (folder == "spam") R.string.empty_spam_q else R.string.empty_trash_q),
            text = stringResource(R.string.cannot_undo),
            confirm = stringResource(R.string.delete_forever),
            dismiss = stringResource(R.string.cancel),
            danger = true,
            onConfirm = { confirmEmpty = false; vm.empty() },
            onDismiss = { confirmEmpty = false },
        )
    }
}
