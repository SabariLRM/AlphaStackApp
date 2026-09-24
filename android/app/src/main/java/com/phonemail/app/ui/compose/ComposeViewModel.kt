package com.phonemail.app.ui.compose

import android.content.Context
import android.net.Uri
import android.os.Bundle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.phonemail.app.AppContainer
import com.phonemail.app.R
import com.phonemail.app.Routes
import com.phonemail.app.data.ApiException
import com.phonemail.app.data.Attachment
import com.phonemail.app.data.ComposeRequest
import com.phonemail.app.data.DraftRequest
import com.phonemail.app.data.Files
import com.phonemail.app.data.Message
import com.phonemail.app.data.Participant
import com.phonemail.app.data.SendChatRequest
import com.phonemail.app.data.safeCall
import com.phonemail.app.ui.home.looksLikeEmail
import com.phonemail.app.ui.home.looksLikePhone
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Navigation arguments of the traditional compose screen. */
data class ComposeArgs(
    val conversationId: String? = null,
    val replyTo: String? = null,
    val draftId: String? = null,
    val to: String? = null,
) {
    fun route(): String {
        val params = listOfNotNull(
            conversationId?.let { "conversationId=${Uri.encode(it)}" },
            replyTo?.let { "replyTo=${Uri.encode(it)}" },
            draftId?.let { "draftId=${Uri.encode(it)}" },
            to?.let { "to=${Uri.encode(it)}" },
        )
        return if (params.isEmpty()) Routes.COMPOSE else "${Routes.COMPOSE}?${params.joinToString("&")}"
    }

    companion object {
        val NAMES = listOf("conversationId", "replyTo", "draftId", "to")
        val ROUTE = "${Routes.COMPOSE}?" + NAMES.joinToString("&") { "$it={$it}" }
        fun from(b: Bundle?) = ComposeArgs(b?.getString("conversationId"), b?.getString("replyTo"), b?.getString("draftId"), b?.getString("to"))
    }
}

data class Recipient(val value: String, val label: String, val invalid: Boolean = false)

data class ComposeState(
    val loading: Boolean = true,
    /** Inside a chat: recipients come from the chat and cannot be changed. */
    val locked: Boolean = false,
    val conversationId: String? = null,
    val participants: List<Participant> = emptyList(),
    val from: String = "",
    val fromOptions: List<String> = emptyList(),
    val to: List<Recipient> = emptyList(),
    val cc: List<Recipient> = emptyList(),
    val showCc: Boolean = false,
    /** Text typed in the To/Cc fields that is not a chip yet. */
    val pendingTo: String = "",
    val pendingCc: String = "",
    val subject: String = "",
    val body: String = "",
    val replyTo: Message? = null,
    val attachments: List<Attachment> = emptyList(),
    val uploading: Int = 0,
    val draftId: String? = null,
    val sending: Boolean = false,
)

class ComposeViewModel(private val container: AppContainer, private val args: ComposeArgs) : ViewModel() {
    private val _state = MutableStateFlow(ComposeState())
    val state: StateFlow<ComposeState> = _state.asStateFlow()
    private val _events = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val events: SharedFlow<String> = _events
    private var dirty = false

    init {
        viewModelScope.launch { init() }
    }

    private suspend fun init() {
        val me = container.me.value ?: runCatching { container.refreshMe() }.getOrNull()
        val options = listOfNotNull(me?.address) + (me?.aliases ?: emptyList())
        _state.update { it.copy(from = me?.address.orEmpty(), fromOptions = options) }
        try {
            var conversationId = args.conversationId
            var replyToId = args.replyTo
            if (args.draftId != null) {
                val d = safeCall { container.api.draft(args.draftId) }
                conversationId = d.conversationId ?: conversationId
                replyToId = d.replyToEntryId ?: replyToId
                _state.update {
                    it.copy(
                        draftId = d.id,
                        from = d.fromAddress ?: it.from,
                        to = d.to.map(::plain),
                        cc = d.cc.map(::plain),
                        showCc = d.cc.isNotEmpty(),
                        subject = d.subject,
                        body = d.body,
                        attachments = d.attachments,
                    )
                }
            }
            if (conversationId != null) {
                val conv = safeCall { container.api.conversation(conversationId) }
                _state.update {
                    it.copy(
                        locked = true,
                        conversationId = conv.id,
                        participants = conv.participants,
                        to = conv.participants.map { p -> Recipient(p.address, container.participantName(p)) },
                        cc = emptyList(),
                    )
                }
            }
            if (replyToId != null) {
                val original = safeCall { container.api.message(replyToId) }
                if (!original.canReply) _events.tryEmit(container.context.getString(R.string.already_replied))
                _state.update { it.copy(replyTo = original.takeIf { o -> o.canReply }) }
            }
            // Text typed in the chat composer before switching to this view.
            container.composeHandoff?.takeIf { it.conversationId == conversationId }?.let { h ->
                container.composeHandoff = null
                _state.update { it.copy(subject = h.subject.ifBlank { it.subject }, body = h.body.ifBlank { it.body }, attachments = it.attachments + h.attachments) }
                dirty = true
            }
            if (args.to != null && conversationId == null && _state.value.to.isEmpty()) addRecipients(args.to, cc = false)
            val signature = me?.signature.orEmpty()
            if (args.draftId == null && conversationId == null && signature.isNotBlank() && _state.value.body.isEmpty()) {
                _state.update { it.copy(body = "\n\n-- \n$signature") }
            }
        } catch (e: ApiException) {
            _events.tryEmit(e.message)
        }
        _state.update { it.copy(loading = false) }
    }

    private fun plain(address: String) = Recipient(address, address)

    fun setFrom(v: String) = edit { it.copy(from = v) }
    fun setSubject(v: String) = edit { it.copy(subject = v.take(500)) }
    fun setBody(v: String) = edit { it.copy(body = v) }
    fun toggleCc() = _state.update { it.copy(showCc = !it.showCc) }
    fun removeRecipient(r: Recipient, cc: Boolean) = edit { s -> if (cc) s.copy(cc = s.cc - r) else s.copy(to = s.to - r) }
    fun removeAttachment(id: String) = edit { s -> s.copy(attachments = s.attachments.filterNot { it.id == id }) }

    private fun edit(block: (ComposeState) -> ComposeState) {
        dirty = true
        _state.update(block)
    }

    fun setPending(v: String, cc: Boolean) {
        // A separator turns what was typed into a chip.
        if (v.isNotEmpty() && v.last() in ", ;\n") {
            _state.update { if (cc) it.copy(pendingCc = v) else it.copy(pendingTo = v) }
            commitPending(cc)
        } else {
            _state.update { if (cc) it.copy(pendingCc = v) else it.copy(pendingTo = v) }
        }
    }

    fun commitPending(cc: Boolean) {
        val raw = if (cc) _state.value.pendingCc else _state.value.pendingTo
        if (raw.isBlank()) return
        _state.update { if (cc) it.copy(pendingCc = "") else it.copy(pendingTo = "") }
        viewModelScope.launch { addRecipientsNow(raw, cc) }
    }

    fun addRecipients(raw: String, cc: Boolean) {
        viewModelScope.launch { addRecipientsNow(raw, cc) }
    }

    /** Turns typed text into recipients; phone numbers are resolved to PhoneMail addresses. */
    private suspend fun addRecipientsNow(raw: String, cc: Boolean) {
        if (_state.value.locked) return
        val parts = raw.split(',', ';', ' ', '\n').map { it.trim() }.filter { it.isNotEmpty() }
        for (part in parts) {
            val r = resolve(part)
            edit { s ->
                val list = if (cc) s.cc else s.to
                if (list.any { it.value == r.value }) s else if (cc) s.copy(cc = s.cc + r) else s.copy(to = s.to + r)
            }
        }
    }

    private suspend fun resolve(input: String): Recipient {
        if (!looksLikePhone(input) && !looksLikeEmail(input)) return Recipient(input, input, invalid = true)
        return try {
            val res = safeCall { container.api.lookup(input) }
            val address = res.address
            when {
                res.registered && address != null -> Recipient(address, res.phone?.let { container.contacts.names.value[it] } ?: res.name.ifBlank { address })
                res.found && address != null -> Recipient(address, address)
                looksLikeEmail(input) -> Recipient(input.lowercase(), input.lowercase(), invalid = true)
                else -> Recipient(input, container.context.getString(R.string.not_on_phonemail, input), invalid = true)
            }
        } catch (e: ApiException) {
            Recipient(input, input, invalid = looksLikePhone(input))
        }
    }

    fun attach(context: Context, uris: List<Uri>) {
        val limit = container.config.value.maxAttachmentBytes
        uris.forEach { uri ->
            val picked = runCatching { Files.describe(context, uri) }.getOrNull() ?: return@forEach
            if (picked.size > limit) {
                _events.tryEmit(context.getString(R.string.file_too_large, picked.name))
                return@forEach
            }
            _state.update { it.copy(uploading = it.uploading + 1) }
            viewModelScope.launch {
                try {
                    val att = Files.upload(context, container.client, picked)
                    edit { it.copy(attachments = it.attachments + att) }
                } catch (e: ApiException) {
                    _events.tryEmit(e.message)
                } finally {
                    _state.update { it.copy(uploading = it.uploading - 1) }
                }
            }
        }
    }

    private fun hasContent(s: ComposeState) =
        (!s.locked && (s.to.isNotEmpty() || s.cc.isNotEmpty() || s.pendingTo.isNotBlank())) || s.subject.isNotBlank() || s.body.isNotBlank() || s.attachments.isNotEmpty()

    fun send(onSent: (String) -> Unit) {
        val current = _state.value
        if (current.sending || current.uploading > 0) return
        viewModelScope.launch {
            // Include anything still typed in the recipient fields.
            val pendingTo = current.pendingTo
            val pendingCc = current.pendingCc
            if (pendingTo.isNotBlank() || pendingCc.isNotBlank()) {
                _state.update { it.copy(pendingTo = "", pendingCc = "") }
                addRecipientsNow(pendingTo, cc = false)
                addRecipientsNow(pendingCc, cc = true)
            }
            sendNow(onSent)
        }
    }

    private suspend fun sendNow(onSent: (String) -> Unit) {
        val s = _state.value
        if (s.to.isEmpty() && s.cc.isEmpty()) {
            _events.tryEmit(container.context.getString(R.string.add_recipient))
            return
        }
        s.to.plus(s.cc).firstOrNull { it.invalid }?.let {
            _events.tryEmit(container.context.getString(R.string.invalid_recipient, it.value))
            return
        }
        if (s.body.isBlank() && s.attachments.isEmpty() && (s.replyTo != null || s.subject.isBlank())) {
            _events.tryEmit(container.context.getString(R.string.empty_message))
            return
        }
        _state.update { it.copy(sending = true) }
        run {
            try {
                val res = if (s.locked && s.conversationId != null) {
                    safeCall {
                        container.api.sendInConversation(
                            s.conversationId,
                            SendChatRequest(
                                subject = if (s.replyTo == null) s.subject.trim() else null,
                                body = s.body.trimEnd(),
                                replyToEntryId = s.replyTo?.id,
                                attachmentIds = s.attachments.map { it.id },
                                fromAddress = s.from.ifBlank { null },
                            ),
                        )
                    }
                } else {
                    safeCall {
                        container.api.send(
                            ComposeRequest(
                                to = s.to.map { it.value },
                                cc = s.cc.map { it.value },
                                subject = s.subject.trim(),
                                body = s.body.trimEnd(),
                                fromAddress = s.from.ifBlank { null },
                                replyToEntryId = s.replyTo?.id,
                                attachmentIds = s.attachments.map { it.id },
                                draftId = s.draftId,
                            ),
                        )
                    }
                }
                // A standalone draft is removed by the server; a chat draft is cleared by sending in the chat.
                if (s.locked && s.draftId != null) runCatching { safeCall { container.api.deleteDraft(s.draftId) } }
                dirty = false
                onSent(res.conversationId)
            } catch (e: ApiException) {
                _state.update { it.copy(sending = false) }
                _events.tryEmit(e.message)
            }
        }
    }

    /** Saves the message as a draft when leaving with unsent content. Returns true if one was saved. */
    fun saveDraftOnExit(): Boolean {
        val s = _state.value
        if (!dirty || s.sending || !hasContent(s)) return false
        dirty = false
        val request = DraftRequest(
            conversationId = s.conversationId,
            replyToEntryId = s.replyTo?.id,
            fromAddress = s.from.ifBlank { null },
            to = if (s.locked) emptyList() else s.to.filterNot { it.invalid }.map { it.value },
            cc = if (s.locked) emptyList() else s.cc.filterNot { it.invalid }.map { it.value },
            subject = if (s.replyTo != null) "" else s.subject,
            body = s.body,
            attachmentIds = s.attachments.map { it.id },
        )
        container.scope.launch {
            runCatching {
                if (s.draftId != null) safeCall { container.api.updateDraft(s.draftId, request) }
                else safeCall { container.api.createDraft(request) }
            }
        }
        return true
    }

    fun discard(done: () -> Unit) {
        val s = _state.value
        dirty = false
        viewModelScope.launch {
            if (s.draftId != null) runCatching { safeCall { container.api.deleteDraft(s.draftId) } }
            done()
        }
    }
}
