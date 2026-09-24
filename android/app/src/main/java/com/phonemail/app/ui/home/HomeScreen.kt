package com.phonemail.app.ui.home

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Drafts
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.MarkEmailRead
import androidx.compose.material.icons.filled.MarkEmailUnread
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Report
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberDrawerState
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
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.phonemail.app.AppContainer
import com.phonemail.app.R
import com.phonemail.app.data.Conversation
import com.phonemail.app.ui.components.Avatar
import com.phonemail.app.ui.components.ConfirmDialog
import com.phonemail.app.ui.components.EmptyState
import com.phonemail.app.ui.components.LoadingBox
import com.phonemail.app.ui.theme.Wa
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    container: AppContainer,
    onOpenChat: (String) -> Unit,
    onCompose: () -> Unit,
    onNewChat: () -> Unit,
    onFolder: (String) -> Unit,
    onSettings: () -> Unit,
) {
    val vm: HomeViewModel = viewModel { HomeViewModel(container) }
    val state by vm.state.collectAsState()
    val me by container.me.collectAsState()
    val contactMatches by container.contacts.onPhoneMail.collectAsState()
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val context = LocalContext.current
    var sheetFor by remember { mutableStateOf<Conversation?>(null) }
    var confirmDelete by remember { mutableStateOf<Conversation?>(null) }
    var confirmSpam by remember { mutableStateOf<Conversation?>(null) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    // Refresh whenever Home becomes visible again (e.g. back from a chat).
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            vm.refresh()
            vm.loadCounts()
            if (me == null) runCatching { container.refreshMe() }
        }
    }
    LaunchedEffect(state.error) {
        state.error?.let {
            snackbar.showSnackbar(it)
            vm.clearError()
        }
    }
    BackHandler(enabled = drawer.isOpen) { scope.launch { drawer.close() } }
    BackHandler(enabled = !drawer.isOpen && state.query.isNotEmpty()) { vm.setQuery("") }

    ModalNavigationDrawer(
        drawerState = drawer,
        drawerContent = {
            HomeDrawer(
                container = container,
                inboxUnread = state.counts.inboxUnread,
                drafts = state.counts.drafts,
                spam = state.counts.spamUnread,
                onHome = { scope.launch { drawer.close() } },
                onFolder = { scope.launch { drawer.close() }; onFolder(it) },
                onSettings = { scope.launch { drawer.close() }; onSettings() },
            )
        },
    ) {
        Scaffold(
            containerColor = Wa.colors.background,
            snackbarHost = { SnackbarHost(snackbar) },
            topBar = {
                TopAppBar(
                    title = { Text(stringResource(R.string.app_name), color = Wa.colors.title, fontWeight = FontWeight.Bold, fontSize = 24.sp) },
                    navigationIcon = {
                        IconButton(onClick = { scope.launch { drawer.open() } }) { Icon(Icons.Filled.Menu, stringResource(R.string.menu), tint = Wa.colors.onTopBar) }
                    },
                    actions = {
                        IconButton(onClick = onSettings) {
                            Avatar(container.client.absolute(me?.avatarUrl), me?.displayName ?: "", me?.address ?: "me", size = 34.dp)
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Wa.colors.topBar),
                )
            },
            floatingActionButton = {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    SmallFloatingActionButton(onClick = onNewChat, containerColor = Wa.colors.chip, contentColor = Wa.colors.greenDark) {
                        Icon(Icons.AutoMirrored.Filled.Chat, stringResource(R.string.new_chat))
                    }
                    FloatingActionButton(onClick = onCompose, containerColor = Wa.colors.green, contentColor = Wa.colors.onGreen, shape = RoundedCornerShape(16.dp)) {
                        Icon(Icons.Filled.Edit, stringResource(R.string.compose))
                    }
                }
            },
        ) { padding ->
            Column(Modifier.fillMaxSize().padding(padding)) {
                SearchField(state.query, onChange = vm::setQuery)
                FilterChips(state.filter, vm::setFilter)
                PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::pullRefresh, modifier = Modifier.fillMaxSize()) {
                    val q = state.query.trim()
                    val contactHits = if (q.length >= 2) contactMatches.filter { m ->
                        val name = container.contacts.names.value[m.phone] ?: m.name
                        name.contains(q, ignoreCase = true) || m.phone.contains(q.filter { it.isDigit() }.ifEmpty { "\u0000" })
                    }.take(5) else emptyList()
                    LazyColumn(Modifier.fillMaxSize()) {
                        state.lookup?.let { lookup ->
                            item(key = "lookup") {
                                LookupRow(container, q, lookup, onOpen = {
                                    vm.openChat(q, onOpened = onOpenChat, onError = { msg -> scope.launch { snackbar.showSnackbar(msg) } })
                                }, onInvite = {
                                    val sms = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:${lookup.phone ?: q}")).putExtra("sms_body", context.getString(R.string.invite_text))
                                    runCatching { context.startActivity(sms) }
                                })
                                HorizontalDivider(color = Wa.colors.divider)
                            }
                        }
                        if (contactHits.isNotEmpty()) {
                            item(key = "contacts-header") { SectionHeader(stringResource(R.string.contacts_on_phonemail)) }
                            items(contactHits, key = { "contact-" + it.phone }) { m ->
                                val name = container.contacts.names.value[m.phone] ?: m.name.ifBlank { m.address }
                                ListItem(
                                    headlineContent = { Text(name, color = Wa.colors.text) },
                                    supportingContent = { Text(m.about.ifBlank { m.address }, color = Wa.colors.textSecondary, maxLines = 1) },
                                    leadingContent = { Avatar(container.client.absolute(m.avatarUrl), name, m.address, size = 44.dp) },
                                    colors = ListItemDefaults.colors(containerColor = Wa.colors.background),
                                    modifier = Modifier.clickable {
                                        vm.openChat(m.address, onOpened = onOpenChat, onError = { msg -> scope.launch { snackbar.showSnackbar(msg) } })
                                    },
                                )
                            }
                            if (state.conversations.isNotEmpty()) item(key = "chats-header") { SectionHeader(stringResource(R.string.chats)) }
                        }
                        items(state.conversations, key = { it.id }) { c ->
                            ConversationRow(container, c, onClick = { onOpenChat(c.id) }, onLongClick = { sheetFor = c })
                        }
                        if (!state.loading && state.conversations.isEmpty() && state.lookup == null && contactHits.isEmpty()) {
                            item(key = "empty") {
                                when {
                                    q.isNotEmpty() -> EmptyState(Icons.Filled.Search, stringResource(R.string.no_results), stringResource(R.string.no_results_hint))
                                    state.filter == ChatFilter.Unread -> EmptyState(Icons.Filled.MarkEmailRead, stringResource(R.string.no_unread))
                                    state.filter == ChatFilter.Favorites -> EmptyState(Icons.Filled.Star, stringResource(R.string.no_favorites), stringResource(R.string.no_favorites_hint))
                                    state.filter == ChatFilter.Attachments -> EmptyState(Icons.Filled.Inbox, stringResource(R.string.no_attachments))
                                    else -> EmptyState(Icons.Filled.Forum, stringResource(R.string.no_chats), stringResource(R.string.no_chats_hint, me?.address ?: ""))
                                }
                            }
                        }
                        item(key = "footer") { Spacer(Modifier.height(96.dp)) }
                    }
                    if (state.loading && state.conversations.isEmpty()) LoadingBox()
                }
            }
        }
    }

    sheetFor?.let { c ->
        ModalBottomSheet(onDismissRequest = { sheetFor = null }, containerColor = Wa.colors.surface) {
            Text(conversationTitle(container, c), modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp), fontWeight = FontWeight.Medium, color = Wa.colors.text, fontSize = 17.sp)
            SheetAction(if (c.isFavorite) Icons.Filled.StarBorder else Icons.Filled.Star, stringResource(if (c.isFavorite) R.string.remove_from_favorites else R.string.add_to_favorites)) {
                vm.toggleFavorite(c); sheetFor = null
            }
            if (c.unreadCount > 0) {
                SheetAction(Icons.Filled.MarkEmailRead, stringResource(R.string.mark_as_read)) { vm.setRead(c, true); sheetFor = null }
            } else {
                SheetAction(Icons.Filled.MarkEmailUnread, stringResource(R.string.mark_as_unread)) { vm.setRead(c, false); sheetFor = null }
            }
            if (!c.isSelf) SheetAction(Icons.Filled.Report, stringResource(R.string.report_spam)) { confirmSpam = c; sheetFor = null }
            SheetAction(Icons.Filled.Delete, stringResource(R.string.delete_chat), danger = true) { confirmDelete = c; sheetFor = null }
            Spacer(Modifier.height(24.dp))
        }
    }
    confirmDelete?.let { c ->
        ConfirmDialog(
            title = stringResource(R.string.delete_chat_q),
            text = stringResource(R.string.delete_chat_body),
            confirm = stringResource(R.string.delete),
            dismiss = stringResource(R.string.cancel),
            danger = true,
            onConfirm = {
                confirmDelete = null
                vm.trash(c)
                scope.launch {
                    val r = snackbar.showSnackbar(context.getString(R.string.chat_moved_to_trash), context.getString(R.string.view), duration = SnackbarDuration.Short)
                    if (r == SnackbarResult.ActionPerformed) onFolder("trash")
                }
            },
            onDismiss = { confirmDelete = null },
        )
    }
    confirmSpam?.let { c ->
        ConfirmDialog(
            title = stringResource(R.string.report_spam_q),
            text = stringResource(R.string.report_spam_body),
            confirm = stringResource(R.string.report),
            dismiss = stringResource(R.string.cancel),
            danger = true,
            onConfirm = { confirmSpam = null; vm.spam(c) },
            onDismiss = { confirmSpam = null },
        )
    }
}

@Composable
private fun SearchField(value: String, onChange: (String) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(Wa.colors.searchBar)
            .padding(horizontal = 16.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.Search, null, tint = Wa.colors.textSecondary, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(12.dp))
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            textStyle = TextStyle(color = Wa.colors.text, fontSize = 16.sp),
            cursorBrush = SolidColor(Wa.colors.green),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            modifier = Modifier.weight(1f),
            decorationBox = { inner ->
                if (value.isEmpty()) Text(stringResource(R.string.search_hint), color = Wa.colors.textSecondary, fontSize = 16.sp, maxLines = 1)
                inner()
            },
        )
        if (value.isNotEmpty()) {
            Icon(Icons.Filled.Close, stringResource(R.string.clear), tint = Wa.colors.textSecondary, modifier = Modifier.size(22.dp).clickable { onChange("") })
        }
    }
}

@Composable
private fun FilterChips(selected: ChatFilter, onSelect: (ChatFilter) -> Unit) {
    val labels = mapOf(
        ChatFilter.All to R.string.filter_all,
        ChatFilter.Unread to R.string.filter_unread,
        ChatFilter.Attachments to R.string.filter_attachments,
        ChatFilter.Favorites to R.string.filter_favorites,
    )
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        ChatFilter.entries.forEach { f ->
            val active = f == selected
            Surface(
                onClick = { onSelect(f) },
                shape = RoundedCornerShape(50),
                color = if (active) Wa.colors.chipSelected else Wa.colors.chip,
            ) {
                Text(
                    stringResource(labels.getValue(f)),
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp),
                    color = if (active) Wa.colors.chipSelectedText else Wa.colors.chipText,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                )
            }
        }
    }
}

@Composable
private fun LookupRow(container: AppContainer, query: String, lookup: com.phonemail.app.data.LookupResult, onOpen: () -> Unit, onInvite: () -> Unit) {
    val label = when {
        lookup.registered -> lookup.phone?.let { container.contacts.names.value[it] } ?: lookup.name.ifBlank { lookup.phone?.let(container.phones::formatInternational) ?: lookup.address.orEmpty() }
        else -> lookup.address ?: query
    }
    Row(
        Modifier.fillMaxWidth().clickable(enabled = lookup.found, onClick = onOpen).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (lookup.found) {
            Avatar(container.client.absolute(lookup.avatarUrl), label, lookup.address ?: query, size = 48.dp)
        } else {
            Box(Modifier.size(48.dp).clip(CircleShape).background(Wa.colors.chip), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.PersonAdd, null, tint = Wa.colors.textSecondary)
            }
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(
                if (lookup.found) stringResource(R.string.chat_with, label) else stringResource(R.string.not_on_phonemail, query),
                color = Wa.colors.text,
                fontWeight = FontWeight.Medium,
                fontSize = 16.sp,
            )
            Text(
                if (lookup.found) lookup.address.orEmpty() else stringResource(R.string.invite_hint),
                color = Wa.colors.textSecondary,
                fontSize = 14.sp,
            )
        }
        if (!lookup.found && lookup.phone != null) {
            Text(
                stringResource(R.string.invite),
                color = Wa.colors.greenDark,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.clickable(onClick = onInvite).padding(8.dp),
            )
        }
    }
}

@Composable
private fun SectionHeader(text: String) {
    Text(text, modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp), color = Wa.colors.textSecondary, fontSize = 14.sp, fontWeight = FontWeight.Medium)
}

@Composable
private fun SheetAction(icon: ImageVector, label: String, danger: Boolean = false, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 24.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = if (danger) Wa.colors.danger else Wa.colors.textSecondary)
        Spacer(Modifier.width(24.dp))
        Text(label, color = if (danger) Wa.colors.danger else Wa.colors.text, fontSize = 16.sp)
    }
}

@Composable
private fun HomeDrawer(
    container: AppContainer,
    inboxUnread: Int,
    drafts: Int,
    spam: Int,
    onHome: () -> Unit,
    onFolder: (String) -> Unit,
    onSettings: () -> Unit,
) {
    val me by container.me.collectAsState()
    ModalDrawerSheet(drawerContainerColor = Wa.colors.surface) {
        Column(Modifier.fillMaxWidth().background(Wa.colors.greenDark).padding(20.dp)) {
            Avatar(container.client.absolute(me?.avatarUrl), me?.displayName ?: "", me?.address ?: "me", size = 64.dp)
            Spacer(Modifier.height(12.dp))
            Text(me?.displayName?.ifBlank { null } ?: stringResource(R.string.app_name), color = androidx.compose.ui.graphics.Color.White, fontWeight = FontWeight.Medium, fontSize = 18.sp)
            Text(me?.address.orEmpty(), color = androidx.compose.ui.graphics.Color.White.copy(alpha = 0.85f), fontSize = 14.sp)
        }
        Spacer(Modifier.height(8.dp))
        val itemColors = NavigationDrawerItemDefaults.colors(
            selectedContainerColor = Wa.colors.chipSelected,
            selectedTextColor = Wa.colors.chipSelectedText,
            selectedIconColor = Wa.colors.chipSelectedText,
            unselectedTextColor = Wa.colors.text,
            unselectedIconColor = Wa.colors.textSecondary,
            unselectedContainerColor = Wa.colors.surface,
        )
        @Composable
        fun item(icon: ImageVector, label: String, badge: Int, selected: Boolean, onClick: () -> Unit) = NavigationDrawerItem(
            icon = { Icon(icon, null) },
            label = { Text(label) },
            badge = { if (badge > 0) Text(badge.toString(), fontWeight = FontWeight.Bold) },
            selected = selected,
            onClick = onClick,
            colors = itemColors,
            modifier = Modifier.padding(horizontal = 12.dp),
        )
        item(Icons.Filled.Inbox, stringResource(R.string.drawer_home), inboxUnread, true, onHome)
        item(Icons.Filled.Drafts, stringResource(R.string.drawer_drafts), drafts, false) { onFolder("drafts") }
        item(Icons.Filled.Report, stringResource(R.string.drawer_spam), spam, false) { onFolder("spam") }
        item(Icons.Filled.Delete, stringResource(R.string.drawer_trash), 0, false) { onFolder("trash") }
        HorizontalDivider(Modifier.padding(vertical = 8.dp, horizontal = 24.dp), color = Wa.colors.divider)
        item(Icons.Filled.Settings, stringResource(R.string.settings), 0, false, onSettings)
    }
}
