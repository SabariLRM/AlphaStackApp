package com.phonemail.app.data

import kotlinx.serialization.Serializable

@Serializable
data class Mailbox(val address: String, val name: String = "")

@Serializable
data class Me(
    val id: String,
    val phone: String,
    val address: String,
    val displayName: String = "",
    val about: String = "",
    val language: String = "en",
    val signature: String = "",
    val avatarUrl: String? = null,
    val smsNotifications: Boolean = true,
    val registrationSource: String = "mobile",
    val aliases: List<String> = emptyList(),
    val hasMobileApp: Boolean = false,
    val createdAt: String = "",
)

@Serializable
data class AppConfig(
    val mailDomain: String = "phonemail.com",
    val defaultCountry: String = "IN",
    val defaultCallingCode: String = "91",
    val otpLength: Int = 6,
    val otpResendSeconds: Int = 30,
    val devSmsOutbox: Boolean = false,
    val externalMail: Boolean = false,
    val maxAttachmentBytes: Long = 25L * 1024 * 1024,
    val webUrl: String = "",
)

@Serializable
data class OtpRequest(val phone: String, val appHash: String? = null)

@Serializable
data class OtpRequestResponse(val phone: String, val expiresIn: Int, val resendIn: Int)

@Serializable
data class OtpVerifyRequest(val phone: String, val code: String, val client: String = "mobile", val deviceName: String)

@Serializable
data class VerifyResponse(val token: String? = null, val user: Me, val isNewUser: Boolean)

@Serializable
data class Participant(
    val address: String,
    val name: String = "",
    val phone: String? = null,
    val avatarUrl: String? = null,
    val userId: String? = null,
    val isLocal: Boolean = false,
)

@Serializable
data class LastMessage(
    val id: String,
    val direction: String,
    val subject: String = "",
    val snippet: String = "",
    val sentAt: String,
    val hasAttachments: Boolean = false,
    val from: Mailbox,
)

@Serializable
data class DraftPreview(val id: String, val subject: String = "", val body: String = "", val updatedAt: String)

@Serializable
data class Conversation(
    val id: String,
    val isGroup: Boolean,
    val isSelf: Boolean = false,
    val isFavorite: Boolean = false,
    val participants: List<Participant>,
    val unreadCount: Int = 0,
    val lastActivityAt: String,
    val lastMessage: LastMessage? = null,
    val draft: DraftPreview? = null,
)

@Serializable
data class Items<T>(val items: List<T>)

@Serializable
data class Attachment(
    val id: String,
    val filename: String,
    val contentType: String,
    val size: Long,
    val inline: Boolean = false,
    val url: String? = null,
)

@Serializable
data class ReplyPreview(
    val id: String,
    val direction: String,
    val subject: String = "",
    val snippet: String = "",
    val from: Mailbox,
    val sentAt: String,
)

@Serializable
data class Message(
    val id: String,
    val conversationId: String,
    val direction: String,
    val folder: String,
    val isRead: Boolean,
    val isStarred: Boolean,
    val sentAt: String,
    val subject: String = "",
    val snippet: String = "",
    val from: Mailbox,
    val to: List<Mailbox> = emptyList(),
    val cc: List<Mailbox> = emptyList(),
    val hasAttachments: Boolean = false,
    val repliedAt: String? = null,
    val replyToEntryId: String? = null,
    val messageId: String = "",
    val text: String = "",
    val html: String? = null,
    val bcc: List<Mailbox> = emptyList(),
    val attachments: List<Attachment> = emptyList(),
    val replyTo: ReplyPreview? = null,
    val canReply: Boolean = false,
) {
    val isOutgoing get() = direction == "out"
}

@Serializable
data class MessagePage(val items: List<Message>, val nextCursor: String? = null)

@Serializable
data class FolderPage(val items: List<Message>, val total: Int)

@Serializable
data class SendChatRequest(
    val subject: String? = null,
    val body: String,
    val replyToEntryId: String? = null,
    val attachmentIds: List<String> = emptyList(),
    val fromAddress: String? = null,
)

@Serializable
data class ComposeRequest(
    val to: List<String>,
    val cc: List<String> = emptyList(),
    val bcc: List<String> = emptyList(),
    val subject: String = "",
    val body: String = "",
    val fromAddress: String? = null,
    val replyToEntryId: String? = null,
    val attachmentIds: List<String> = emptyList(),
    val draftId: String? = null,
)

@Serializable
data class SendResponse(val entryId: String, val conversationId: String, val message: Message)

@Serializable
data class OpenConversationRequest(val target: String)

@Serializable
data class FavoriteRequest(val isFavorite: Boolean)

@Serializable
data class ReadRequest(val read: Boolean)

@Serializable
data class ChatDraft(val id: String, val subject: String = "", val body: String = "", val replyToEntryId: String? = null, val updatedAt: String)

@Serializable
data class ChatDraftResponse(val draft: ChatDraft? = null)

@Serializable
data class ChatDraftRequest(val subject: String, val body: String, val replyToEntryId: String? = null)

@Serializable
data class Draft(
    val id: String,
    val conversationId: String? = null,
    val replyToEntryId: String? = null,
    val fromAddress: String? = null,
    val to: List<String> = emptyList(),
    val cc: List<String> = emptyList(),
    val bcc: List<String> = emptyList(),
    val participants: List<Participant> = emptyList(),
    val subject: String = "",
    val body: String = "",
    val attachments: List<Attachment> = emptyList(),
    val createdAt: String = "",
    val updatedAt: String = "",
)

@Serializable
data class DraftRequest(
    val conversationId: String? = null,
    val replyToEntryId: String? = null,
    val fromAddress: String? = null,
    val to: List<String> = emptyList(),
    val cc: List<String> = emptyList(),
    val bcc: List<String> = emptyList(),
    val subject: String = "",
    val body: String = "",
    val attachmentIds: List<String> = emptyList(),
)

@Serializable
data class BatchRequest(val ids: List<String>, val action: String)

@Serializable
data class FlagsRequest(val isRead: Boolean? = null, val isStarred: Boolean? = null)

@Serializable
data class ProfilePatch(
    val displayName: String? = null,
    val about: String? = null,
    val language: String? = null,
    val signature: String? = null,
    val smsNotifications: Boolean? = null,
)

@Serializable
data class AliasRequest(val alias: String)

@Serializable
data class AliasResponse(val address: String)

@Serializable
data class SessionInfo(
    val id: String,
    val client: String,
    val deviceName: String = "",
    val ip: String? = null,
    val createdAt: String,
    val lastSeenAt: String,
    val current: Boolean = false,
)

@Serializable
data class LookupResult(
    val found: Boolean,
    val registered: Boolean,
    val address: String? = null,
    val phone: String? = null,
    val name: String = "",
    val avatarUrl: String? = null,
)

@Serializable
data class ContactsMatchRequest(val phones: List<String>)

@Serializable
data class ContactMatch(
    val phone: String,
    val inputs: List<String> = emptyList(),
    val address: String,
    val name: String = "",
    val about: String = "",
    val avatarUrl: String? = null,
)

@Serializable
data class SyncItem(
    val id: String,
    val conversationId: String,
    val from: Mailbox,
    val subject: String = "",
    val snippet: String = "",
    val createdAt: String,
)

@Serializable
data class SyncResponse(val now: String, val items: List<SyncItem>)

@Serializable
data class UploadResponse(val id: String, val filename: String, val contentType: String, val size: Long)

@Serializable
data class DeleteAccountRequest(val confirmPhone: String)

@Serializable
data class OkResponse(val ok: Boolean = true)

@Serializable
data class ApiErrorBody(val error: ApiErrorDetail? = null)

@Serializable
data class ApiErrorDetail(val code: String = "error", val message: String = "")

@Serializable
data class Counts(
    val inboxUnread: Int = 0,
    val spamUnread: Int = 0,
    val drafts: Int = 0,
    val starred: Int = 0,
    val trash: Int = 0,
)
