package com.phonemail.app.ui.email

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color as AndroidColor
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.MarkEmailUnread
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.phonemail.app.AppContainer
import com.phonemail.app.R
import com.phonemail.app.data.ApiException
import com.phonemail.app.data.Attachment
import com.phonemail.app.data.BatchRequest
import com.phonemail.app.data.Files
import com.phonemail.app.data.FlagsRequest
import com.phonemail.app.data.Mailbox
import com.phonemail.app.data.Message
import com.phonemail.app.data.safeCall
import com.phonemail.app.ui.components.Avatar
import com.phonemail.app.ui.components.LoadingBox
import com.phonemail.app.ui.compose.ComposeArgs
import com.phonemail.app.ui.theme.Wa
import com.phonemail.app.util.fileSize
import com.phonemail.app.util.fullDateTime
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class EmailViewModel(private val container: AppContainer, private val entryId: String) : ViewModel() {
    private val _message = MutableStateFlow<Message?>(null)
    val message: StateFlow<Message?> = _message
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    init {
        load()
        viewModelScope.launch { container.realtime.events.collect { if (entryId in it.entryIds) load() } }
    }

    fun load() {
        viewModelScope.launch {
            try {
                var m = safeCall { container.api.message(entryId) }
                if (!m.isRead) m = runCatching { safeCall { container.api.setFlags(entryId, FlagsRequest(isRead = true)) } }.getOrDefault(m)
                _message.value = m
            } catch (e: ApiException) {
                _error.value = e.message
            }
        }
    }

    fun toggleStar() {
        val m = _message.value ?: return
        viewModelScope.launch {
            runCatching { safeCall { container.api.setFlags(m.id, FlagsRequest(isStarred = !m.isStarred)) } }.onSuccess { _message.value = it }
        }
    }

    fun act(action: String, done: () -> Unit) {
        viewModelScope.launch {
            try {
                safeCall { container.api.batch(BatchRequest(listOf(entryId), action)) }
                done()
            } catch (e: ApiException) {
                _error.value = e.message
            }
        }
    }

    fun clearError() {
        _error.value = null
    }
}

/** The traditional (full email) view of one message, with Reply at the bottom. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EmailDetailScreen(container: AppContainer, entryId: String, onBack: () -> Unit, onReply: (ComposeArgs) -> Unit, onOpenEmail: (String) -> Unit) {
    val vm: EmailViewModel = viewModel(key = "email-$entryId") { EmailViewModel(container, entryId) }
    val message by vm.message.collectAsState()
    val error by vm.error.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var menu by remember { mutableStateOf(false) }
    var details by remember { mutableStateOf(false) }

    LaunchedEffect(error) {
        error?.let {
            snackbar.showSnackbar(it)
            vm.clearError()
        }
    }

    Scaffold(
        containerColor = Wa.colors.background,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = {},
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back), tint = Wa.colors.onTopBar) } },
                actions = actions@{
                    val m = message ?: return@actions
                    IconButton(onClick = vm::toggleStar) {
                        Icon(if (m.isStarred) Icons.Filled.Star else Icons.Filled.StarBorder, stringResource(R.string.star), tint = if (m.isStarred) Wa.colors.star else Wa.colors.onTopBar)
                    }
                    IconButton(onClick = { vm.act(if (m.folder == "trash") "delete" else "trash", onBack) }) {
                        Icon(Icons.Filled.Delete, stringResource(R.string.delete), tint = Wa.colors.onTopBar)
                    }
                    if (!m.isOutgoing) {
                        IconButton(onClick = { vm.act("unread", onBack) }) { Icon(Icons.Filled.MarkEmailUnread, stringResource(R.string.mark_as_unread), tint = Wa.colors.onTopBar) }
                    }
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, stringResource(R.string.more_options), tint = Wa.colors.onTopBar) }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            when (m.folder) {
                                "trash" -> DropdownMenuItem(text = { Text(stringResource(R.string.restore)) }, onClick = { menu = false; vm.act("restore", onBack) })
                                "spam" -> DropdownMenuItem(text = { Text(stringResource(R.string.not_spam)) }, onClick = { menu = false; vm.act("not_spam", onBack) })
                                else -> if (!m.isOutgoing) DropdownMenuItem(text = { Text(stringResource(R.string.report_spam)) }, onClick = { menu = false; vm.act("spam", onBack) })
                            }
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Wa.colors.topBar),
            )
        },
        bottomBar = bottomBar@{
            val m = message ?: return@bottomBar
            if (m.folder == "trash" || m.folder == "spam") return@bottomBar
            Surface(color = Wa.colors.surface, shadowElevation = 4.dp) {
                Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp)) {
                    if (!m.canReply) {
                        Text(stringResource(R.string.already_replied), color = Wa.colors.textSecondary, fontSize = 13.sp, modifier = Modifier.padding(bottom = 8.dp))
                    }
                    Button(
                        onClick = { onReply(ComposeArgs(conversationId = m.conversationId, replyTo = m.id)) },
                        enabled = m.canReply,
                        modifier = Modifier.fillMaxWidth().height(46.dp),
                        shape = RoundedCornerShape(24.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Wa.colors.green, contentColor = Wa.colors.onGreen),
                    ) {
                        Icon(Icons.AutoMirrored.Filled.Reply, null)
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.reply), fontWeight = FontWeight.Medium)
                    }
                }
            }
        },
    ) content@{ padding ->
        val m = message
        if (m == null) {
            LoadingBox(Modifier.padding(padding))
            return@content
        }
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())) {
            Text(
                m.subject.ifBlank { stringResource(R.string.no_subject) },
                fontSize = 22.sp,
                color = Wa.colors.text,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            )
            m.replyTo?.let { q ->
                Row(
                    Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Wa.colors.chip).clickable { onOpenEmail(q.id) }.padding(10.dp),
                ) {
                    Icon(Icons.AutoMirrored.Filled.Reply, null, tint = Wa.colors.textSecondary, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.in_reply_to, q.subject.ifBlank { q.snippet }), color = Wa.colors.textSecondary, fontSize = 13.sp, maxLines = 2)
                }
                Spacer(Modifier.height(8.dp))
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.Top) {
                val fromName = if (m.isOutgoing) stringResource(R.string.you) else container.displayNameFor(m.from.address, m.from.name)
                Avatar(null, fromName, m.from.address, size = 42.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(fromName, fontWeight = FontWeight.Medium, color = Wa.colors.text, fontSize = 16.sp, modifier = Modifier.weight(1f, fill = false))
                        Spacer(Modifier.width(8.dp))
                        Text(fullDateTime(m.sentAt), color = Wa.colors.textSecondary, fontSize = 12.sp)
                    }
                    Row(Modifier.clickable { details = !details }, verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            stringResource(R.string.to_list, (m.to + m.cc).joinToString(", ") { recipientLabel(container, it) }),
                            color = Wa.colors.textSecondary,
                            fontSize = 13.sp,
                            maxLines = 1,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                        Icon(if (details) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, null, tint = Wa.colors.textSecondary, modifier = Modifier.size(18.dp))
                    }
                }
            }
            if (details) {
                Column(Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Wa.colors.chip).padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    DetailLine(stringResource(R.string.from_label), m.from.address)
                    DetailLine(stringResource(R.string.to_label), m.to.joinToString(", ") { it.address })
                    if (m.cc.isNotEmpty()) DetailLine(stringResource(R.string.cc_label), m.cc.joinToString(", ") { it.address })
                    if (m.bcc.isNotEmpty()) DetailLine(stringResource(R.string.bcc_label), m.bcc.joinToString(", ") { it.address })
                    DetailLine(stringResource(R.string.date_label), fullDateTime(m.sentAt))
                }
            }
            HorizontalDivider(Modifier.padding(vertical = 8.dp), color = Wa.colors.divider)
            Box(Modifier.padding(horizontal = 16.dp)) {
                if (m.html != null) HtmlBody(container, m.html) else PlainBody(m.text.ifBlank { stringResource(R.string.no_text) })
            }
            if (m.attachments.isNotEmpty()) {
                HorizontalDivider(Modifier.padding(vertical = 12.dp), color = Wa.colors.divider)
                Text(stringResource(R.string.attachments_n, m.attachments.size), color = Wa.colors.textSecondary, fontSize = 14.sp, modifier = Modifier.padding(horizontal = 16.dp))
                m.attachments.forEach { a ->
                    AttachmentRow(a) {
                        scope.launch {
                            val ok = runCatching { Files.open(context, container.client, a) }.getOrElse { e ->
                                snackbar.showSnackbar(e.message ?: context.getString(R.string.generic_error)); return@launch
                            }
                            if (!ok) snackbar.showSnackbar(context.getString(R.string.no_app_to_open))
                        }
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

private fun recipientLabel(container: AppContainer, m: Mailbox): String {
    val me = container.me.value
    if (me != null && (m.address == me.address || m.address in me.aliases)) return container.context.getString(R.string.me)
    return container.displayNameFor(m.address, m.name)
}

@Composable
private fun DetailLine(label: String, value: String) {
    Row {
        Text(label, color = Wa.colors.textSecondary, fontSize = 13.sp, modifier = Modifier.width(56.dp))
        Text(value, color = Wa.colors.text, fontSize = 13.sp)
    }
}

@Composable
private fun PlainBody(text: String) {
    val linkStyle = TextLinkStyles(SpanStyle(color = Wa.colors.link))
    val annotated = remember(text) {
        buildAnnotatedString {
            var last = 0
            Regex("https?://[^\\s<>\"')]+").findAll(text).forEach { match ->
                append(text.substring(last, match.range.first))
                withLink(LinkAnnotation.Url(match.value, linkStyle)) { append(match.value) }
                last = match.range.last + 1
            }
            append(text.substring(last))
        }
    }
    SelectionContainer { Text(annotated, color = Wa.colors.text, fontSize = 16.sp, lineHeight = 24.sp) }
}

/** HTML mail in a WebView with JavaScript and file access disabled; links open in the browser. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun HtmlBody(container: AppContainer, html: String) {
    val density = LocalDensity.current
    var heightPx by remember { mutableIntStateOf(0) }
    var webView by remember { mutableStateOf<WebView?>(null) }
    LaunchedEffect(webView, html) {
        val view = webView ?: return@LaunchedEffect
        // Images may load after the page: re-measure a few times.
        repeat(6) {
            delay(if (it == 0) 150L else 500L)
            val h = (view.contentHeight * view.resources.displayMetrics.density).toInt()
            if (h > 0) heightPx = h
        }
    }
    val doc = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        <style>body{margin:0;font-family:sans-serif;font-size:15px;line-height:1.5;color:#111;background:#fff;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%!important}</style>
        </head><body>$html</body></html>"""
    AndroidView(
        factory = { ctx ->
            WebView(ctx).apply {
                settings.javaScriptEnabled = false
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.loadWithOverviewMode = true
                settings.useWideViewPort = false
                setBackgroundColor(AndroidColor.WHITE)
                isVerticalScrollBarEnabled = false
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        runCatching { view.context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(request.url.toString())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                        return true
                    }

                    override fun onPageFinished(view: WebView, url: String?) {
                        val h = (view.contentHeight * view.resources.displayMetrics.density).toInt()
                        if (h > 0) heightPx = h
                    }
                }
                webView = this
            }
        },
        // Only (re)load when the content changes: height updates recompose this view.
        update = {
            if (it.tag != doc) {
                it.tag = doc
                it.loadDataWithBaseURL(container.client.baseUrl, doc, "text/html", "utf-8", null)
            }
        },
        modifier = Modifier.fillMaxWidth().height(with(density) { heightPx.coerceAtLeast(with(density) { 120.dp.roundToPx() }).toDp() }).clip(RoundedCornerShape(6.dp)),
    )
}

@Composable
private fun AttachmentRow(a: Attachment, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.Description, null, tint = Wa.colors.danger, modifier = Modifier.size(36.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(a.filename, color = Wa.colors.text, fontSize = 15.sp, maxLines = 1)
            Text("${fileSize(a.size)} · ${a.contentType}", color = Wa.colors.textSecondary, fontSize = 12.sp)
        }
    }
}
