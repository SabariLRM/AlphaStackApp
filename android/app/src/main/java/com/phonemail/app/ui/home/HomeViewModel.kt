package com.phonemail.app.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.phonemail.app.AppContainer
import com.phonemail.app.data.ApiException
import com.phonemail.app.data.Conversation
import com.phonemail.app.data.Counts
import com.phonemail.app.data.FavoriteRequest
import com.phonemail.app.data.LookupResult
import com.phonemail.app.data.OpenConversationRequest
import com.phonemail.app.data.ReadRequest
import com.phonemail.app.data.safeCall
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class ChatFilter(val api: String) { All("all"), Unread("unread"), Attachments("attachments"), Favorites("favorites") }

data class HomeState(
    val filter: ChatFilter = ChatFilter.All,
    val query: String = "",
    val conversations: List<Conversation> = emptyList(),
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val error: String? = null,
    val lookup: LookupResult? = null,
    val counts: Counts = Counts(),
)

fun looksLikePhone(q: String) = q.count { it.isDigit() } >= 6 && q.all { it.isDigit() || it in "+ -()" }
fun looksLikeEmail(q: String) = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$").matches(q.trim())

@OptIn(FlowPreview::class)
class HomeViewModel(private val container: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(HomeState())
    val state: StateFlow<HomeState> = _state.asStateFlow()
    private val queryFlow = MutableStateFlow("")
    private var loadJob: Job? = null
    private var all: List<Conversation> = emptyList()

    init {
        refresh()
        viewModelScope.launch { queryFlow.drop(1).debounce(300).collect { refresh(); lookup(it) } }
        viewModelScope.launch {
            // Coalesce bursts of realtime events into one reload.
            container.realtime.events.debounce(400).collect { refresh(); loadCounts() }
        }
        viewModelScope.launch { container.contacts.names.collect { _state.update { s -> s.copy(conversations = s.conversations.toList()) } } }
        loadCounts()
        // Pick up phone-book changes (names in chats, "Contacts on PhoneMail").
        viewModelScope.launch { runCatching { container.contacts.refresh() } }
    }

    fun setFilter(filter: ChatFilter) {
        _state.update { it.copy(filter = filter, loading = true) }
        refresh()
    }

    fun setQuery(q: String) {
        _state.update { it.copy(query = q) }
        queryFlow.value = q
    }

    fun pullRefresh() {
        _state.update { it.copy(refreshing = true) }
        refresh()
        loadCounts()
        viewModelScope.launch { runCatching { container.contacts.refresh() } }
    }

    fun refresh() {
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            val s = _state.value
            try {
                val q = s.query.trim()
                val server = safeCall { container.api.conversations(s.filter.api, q.ifEmpty { null }) }.items
                if (q.isEmpty() && s.filter == ChatFilter.All) all = server
                val merged = if (q.isEmpty()) server else server + localNameMatches(q, s.filter).filter { c -> server.none { it.id == c.id } }
                _state.update { it.copy(conversations = merged, loading = false, refreshing = false, error = null) }
            } catch (e: ApiException) {
                _state.update { it.copy(loading = false, refreshing = false, error = e.message) }
            }
        }
    }

    /** The server can't search device contact names, so match those locally. */
    private fun localNameMatches(q: String, filter: ChatFilter): List<Conversation> {
        if (filter != ChatFilter.All) return emptyList()
        val needle = q.lowercase()
        return all.filter { c -> c.participants.any { container.participantName(it).lowercase().contains(needle) } }
    }

    private suspend fun lookup(q: String) {
        val value = q.trim()
        if (!looksLikePhone(value) && !looksLikeEmail(value)) {
            _state.update { it.copy(lookup = null) }
            return
        }
        val result = runCatching { safeCall { container.api.lookup(value) } }.getOrNull()
        _state.update { if (it.query.trim() == value) it.copy(lookup = result) else it }
    }

    fun loadCounts() {
        viewModelScope.launch { runCatching { safeCall { container.api.counts() } }.onSuccess { c -> _state.update { it.copy(counts = c) } } }
    }

    fun openChat(target: String, onOpened: (String) -> Unit, onError: (String) -> Unit) {
        viewModelScope.launch {
            try {
                val conv = safeCall { container.api.openConversation(OpenConversationRequest(target)) }
                onOpened(conv.id)
            } catch (e: ApiException) {
                onError(e.message)
            }
        }
    }

    fun toggleFavorite(c: Conversation) = act { safeCall { container.api.setFavorite(c.id, FavoriteRequest(!c.isFavorite)) } }
    fun setRead(c: Conversation, read: Boolean) = act { safeCall { container.api.markConversationRead(c.id, ReadRequest(read)) } }
    fun trash(c: Conversation) = act { safeCall { container.api.trashConversation(c.id) } }
    fun spam(c: Conversation) = act { safeCall { container.api.reportSpam(c.id) } }

    private fun act(block: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                block()
            } catch (e: ApiException) {
                _state.update { it.copy(error = e.message) }
            }
            delay(50)
            refresh()
            loadCounts()
        }
    }

    fun clearError() = _state.update { it.copy(error = null) }
}
