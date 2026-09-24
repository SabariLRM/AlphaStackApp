package com.phonemail.app.ui.chat

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.phonemail.app.AppContainer
import com.phonemail.app.ComposeHandoff
import com.phonemail.app.R
import com.phonemail.app.data.ApiException
import com.phonemail.app.data.Attachment
import com.phonemail.app.data.BatchRequest
import com.phonemail.app.data.ChatDraftRequest
import com.phonemail.app.data.Conversation
import com.phonemail.app.data.DraftRequest
import com.phonemail.app.data.FavoriteRequest
import com.phonemail.app.data.FlagsRequest
import com.phonemail.app.data.Files
import com.phonemail.app.data.Message
import com.phonemail.app.data.ReadRequest
import com.phonemail.app.data.SendChatRequest
import com.phonemail.app.data.safeCall
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class ChatState(
    val conversation: Conversation? = null,
    /** Newest first (the list is drawn bottom-up). */
    val messages: List<Message> = emptyList(),
    val loading: Boolean = true,
    val loadingMore: Boolean = false,
    val nextCursor: String? = null,
    val subject: String = "",
    val body: String = "",
    val replyTo: Message? = null,
    val attachments: List<Attachment> = emptyList(),
    val uploading: Int = 0,
    val sending: Boolean = false,
    val gone: Boolean = false,
)

class ChatViewModel(private val container: AppContainer, val conversationId: String) : ViewModel() {
    private val _state = MutableStateFlow(ChatState())
    val state: StateFlow<ChatState> = _state.asStateFlow()
    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 4)
    /** One-off messages for the snackbar. */
    val messages: SharedFlow<String> = _messages
    private val refreshLock = Mutex()
    private var resumed = false
    private var refreshJob: Job? = null

    init {
        viewModelScope.launch { load() }
        viewModelScope.launch {
            container.realtime.events.collect { e ->
                val mine = e.conversationId == conversationId || conversationId in e.conversationIds || e.type == "resync"
                if (mine) refreshLatest()
            }
        }
    }

    private fun toast(text: String) = _messages.tryEmit(text)

    private suspend fun load() {
        try {
            val conv = safeCall { container.api.conversation(conversationId) }
            val page = safeCall { container.api.conversationMessages(conversationId) }
            _state.update { it.copy(conversation = conv, messages = page.items, nextCursor = page.nextCursor, loading = false) }
            if (resumed) markRead()
        } catch (e: ApiException) {
            _state.update { it.copy(loading = false, gone = e.status == 404) }
            toast(e.message)
        }
    }

    fun refreshLatest() {
        refreshJob?.cancel()
        refreshJob = viewModelScope.launch {
            refreshLock.withLock {
                runCatching {
                    val page = safeCall { container.api.conversationMessages(conversationId) }
                    val conv = safeCall { container.api.conversation(conversationId) }
                    _state.update { s ->
                        // Keep older pages we already loaded, replacing the newest page.
                        val newestIds = page.items.map { it.id }.toSet()
                        val oldest = page.items.lastOrNull()?.sentAt
                        val older = s.messages.filter { it.id !in newestIds && oldest != null && it.sentAt < oldest }
                        s.copy(conversation = conv, messages = page.items + older, nextCursor = if (older.isEmpty()) page.nextCursor else s.nextCursor)
                    }
                    if (resumed) markRead()
                }.onFailure { e -> if (e is ApiException && e.status == 404) _state.update { it.copy(gone = true) } }
            }
        }
    }

    fun loadMore() {
        val s = _state.value
        val cursor = s.nextCursor ?: return
        if (s.loadingMore) return
        _state.update { it.copy(loadingMore = true) }
        viewModelScope.launch {
            try {
                val page = safeCall { container.api.conversationMessages(conversationId, before = cursor) }
                _state.update { st -> st.copy(messages = st.messages + page.items.filter { m -> st.messages.none { it.id == m.id } }, nextCursor = page.nextCursor, loadingMore = false) }
            } catch (e: ApiException) {
                _state.update { it.copy(loadingMore = false) }
            }
        }
    }

    fun onResume() {
        resumed = true
        val s = _state.value
        // Pick up text left by the traditional compose screen (or another device).
        if (s.body.isEmpty() && s.subject.isEmpty() && s.attachments.isEmpty()) loadDraft()
        refreshLatest()
    }

    fun onPause() {
        resumed = false
        saveDraft()
    }

    private fun markRead() {
        if (_state.value.messages.any { !it.isRead && !it.isOutgoing } || (_state.value.conversation?.unreadCount ?: 0) > 0) {
            viewModelScope.launch {
                runCatching { safeCall { container.api.markConversationRead(conversationId, ReadRequest(true)) } }
                _state.update { s -> s.copy(messages = s.messages.map { if (it.isOutgoing || it.isRead) it else it.copy(isRead = true) }) }
            }
        }
    }

    private fun loadDraft() {
        viewModelScope.launch {
            runCatching {
                val draft = safeCall { container.api.chatDraft(conversationId) }.draft ?: return@runCatching
                val full = safeCall { container.api.draft(draft.id) }
                val reply = full.replyToEntryId?.let { id -> _state.value.messages.firstOrNull { it.id == id } ?: runCatching { safeCall { container.api.message(id) } }.getOrNull() }
                _state.update {
                    if (it.body.isNotEmpty() || it.subject.isNotEmpty()) it
                    else it.copy(subject = full.subject, body = full.body, attachments = full.attachments, replyTo = reply?.takeIf { r -> r.canReply })
                }
            }
        }
    }

    /** Keeps unsent text as the chat's draft (shown as "Draft:" on Home, like WhatsApp). */
    fun saveDraft() {
        val s = _state.value
        if (s.sending) return
        val empty = s.subject.isBlank() && s.body.isBlank() && s.attachments.isEmpty()
        container.scope.launch {
            runCatching {
                if (empty) {
                    safeCall { container.api.saveChatDraft(conversationId, ChatDraftRequest("", "", null)) }
                } else {
                    safeCall {
                        container.api.createDraft(
                            DraftRequest(
                                conversationId = conversationId,
                                replyToEntryId = s.replyTo?.id,
                                subject = if (s.replyTo != null) "" else s.subject,
                                body = s.body,
                                attachmentIds = s.attachments.map { it.id },
                            ),
                        )
                    }
                }
            }
        }
    }

    fun setSubject(v: String) = _state.update { it.copy(subject = v.take(500)) }
    fun setBody(v: String) = _state.update { it.copy(body = v) }

    fun setReplyTo(context: Context, message: Message?): Boolean {
        if (message != null && !message.canReply) {
            toast(context.getString(R.string.already_replied))
            return false
        }
        _state.update { it.copy(replyTo = message) }
        return true
    }

    fun attach(context: Context, uris: List<Uri>) {
        val limit = container.config.value.maxAttachmentBytes
        for (uri in uris) {
            val picked = runCatching { Files.describe(context, uri) }.getOrNull() ?: continue
            if (picked.size > limit) {
                toast(context.getString(R.string.file_too_large, picked.name))
                continue
            }
            _state.update { it.copy(uploading = it.uploading + 1) }
            viewModelScope.launch {
                try {
                    val att = Files.upload(context, container.client, picked)
                    _state.update { it.copy(attachments = it.attachments + att) }
                } catch (e: ApiException) {
                    toast(e.message)
                } finally {
                    _state.update { it.copy(uploading = it.uploading - 1) }
                }
            }
        }
    }

    fun removeAttachment(id: String) = _state.update { s -> s.copy(attachments = s.attachments.filterNot { it.id == id }) }

    fun canSend(s: ChatState = _state.value) = !s.sending && s.uploading == 0 && (s.body.isNotBlank() || s.attachments.isNotEmpty() || (s.replyTo == null && s.subject.isNotBlank()))

    fun send() {
        val s = _state.value
        if (!canSend(s)) return
        _state.update { it.copy(sending = true) }
        viewModelScope.launch {
            try {
                val res = safeCall {
                    container.api.sendInConversation(
                        conversationId,
                        SendChatRequest(
                            // Replies never carry a subject: the server derives "Re: …" from the original.
                            subject = if (s.replyTo == null) s.subject.trim() else null,
                            body = s.body.trim(),
                            replyToEntryId = s.replyTo?.id,
                            attachmentIds = s.attachments.map { it.id },
                        ),
                    )
                }
                _state.update { st ->
                    st.copy(
                        messages = listOf(res.message) + st.messages.filterNot { it.id == res.message.id }.map { m ->
                            if (m.id == s.replyTo?.id) m.copy(canReply = false, repliedAt = res.message.sentAt) else m
                        },
                        subject = "",
                        body = "",
                        replyTo = null,
                        attachments = emptyList(),
                        sending = false,
                    )
                }
            } catch (e: ApiException) {
                _state.update { it.copy(sending = false) }
                toast(e.message)
                if (e.code == "already_replied") {
                    _state.update { st -> st.copy(replyTo = null) }
                    refreshLatest()
                }
            }
        }
    }

    /** Moves the composer's content to the traditional compose screen. */
    fun handoff() {
        val s = _state.value
        container.composeHandoff = ComposeHandoff(conversationId, if (s.replyTo == null) s.subject else "", s.body, s.attachments)
        _state.update { it.copy(subject = "", body = "", attachments = emptyList(), replyTo = null) }
        container.scope.launch { runCatching { safeCall { container.api.saveChatDraft(conversationId, ChatDraftRequest("", "", null)) } } }
    }

    fun toggleStar(m: Message) {
        viewModelScope.launch {
            runCatching { safeCall { container.api.setFlags(m.id, FlagsRequest(isStarred = !m.isStarred)) } }
                .onSuccess { updated -> _state.update { s -> s.copy(messages = s.messages.map { if (it.id == m.id) it.copy(isStarred = updated.isStarred) else it }) } }
                .onFailure { toast(it.message ?: "") }
        }
    }

    fun deleteMessage(m: Message) {
        viewModelScope.launch {
            runCatching { safeCall { container.api.batch(BatchRequest(listOf(m.id), "trash")) } }
                .onSuccess { _state.update { s -> s.copy(messages = s.messages.filterNot { it.id == m.id }) } }
                .onFailure { toast(it.message ?: "") }
        }
    }

    fun toggleFavorite() {
        val c = _state.value.conversation ?: return
        viewModelScope.launch {
            runCatching { safeCall { container.api.setFavorite(c.id, FavoriteRequest(!c.isFavorite)) } }
                .onSuccess { updated -> _state.update { it.copy(conversation = updated) } }
                .onFailure { toast(it.message ?: "") }
        }
    }

    fun markUnread(done: () -> Unit) {
        viewModelScope.launch {
            resumed = false
            runCatching { safeCall { container.api.markConversationRead(conversationId, ReadRequest(false)) } }
            done()
        }
    }

    fun reportSpam(done: () -> Unit) {
        viewModelScope.launch {
            runCatching { safeCall { container.api.reportSpam(conversationId) } }.onFailure { toast(it.message ?: "") }
            done()
        }
    }

    fun deleteChat(done: () -> Unit) {
        viewModelScope.launch {
            _state.update { it.copy(subject = "", body = "", attachments = emptyList(), replyTo = null) }
            runCatching { safeCall { container.api.trashConversation(conversationId) } }.onFailure { toast(it.message ?: "") }
            done()
        }
    }
}
