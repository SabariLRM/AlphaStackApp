package com.phonemail.app.ui.home

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.phonemail.app.AppContainer
import com.phonemail.app.R
import com.phonemail.app.data.Conversation
import com.phonemail.app.ui.components.Avatar
import com.phonemail.app.ui.theme.Wa
import com.phonemail.app.util.chatListTime

@Composable
fun conversationTitle(container: AppContainer, c: Conversation): String {
    if (c.isSelf) return stringResource(R.string.you_self_chat)
    return c.participants.joinToString(", ") { container.participantName(it) }
}

fun conversationAvatarUrl(container: AppContainer, c: Conversation): String? =
    if (c.isGroup) null else if (c.isSelf) container.client.absolute(container.me.value?.avatarUrl) else container.client.absolute(c.participants.firstOrNull()?.avatarUrl)

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ConversationRow(container: AppContainer, c: Conversation, onClick: () -> Unit, onLongClick: () -> Unit) {
    val context = LocalContext.current
    val title = conversationTitle(container, c)
    val unread = c.unreadCount > 0
    val last = c.lastMessage
    val time = (last?.sentAt ?: c.draft?.updatedAt)?.let { chatListTime(context, it) }.orEmpty()
    Row(
        Modifier
            .fillMaxWidth()
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(conversationAvatarUrl(container, c), title, c.participants.firstOrNull()?.address ?: c.id, size = 52.dp, group = c.isGroup)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    title,
                    modifier = Modifier.weight(1f),
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Medium,
                    color = Wa.colors.text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.width(8.dp))
                Text(time, fontSize = 12.sp, color = if (unread) Wa.colors.green else Wa.colors.textSecondary, fontWeight = if (unread) FontWeight.Medium else FontWeight.Normal)
            }
            Spacer(Modifier.height(2.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                val draft = c.draft
                if (draft != null) {
                    Text(stringResource(R.string.draft_prefix) + " ", color = Wa.colors.green, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                    Text(
                        draft.body.ifBlank { draft.subject }.replace('\n', ' '),
                        modifier = Modifier.weight(1f),
                        color = Wa.colors.textSecondary,
                        fontSize = 15.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                } else if (last != null) {
                    if (last.direction == "out") {
                        Icon(Icons.Filled.Done, null, tint = Wa.colors.textSecondary, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(3.dp))
                    }
                    if (last.hasAttachments) {
                        Icon(Icons.Filled.AttachFile, null, tint = Wa.colors.textSecondary, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(2.dp))
                    }
                    val sender = if (c.isGroup && last.direction == "in") container.displayNameFor(last.from.address, last.from.name).substringBefore(' ') + ": " else ""
                    val preview = when {
                        last.subject.isNotBlank() && last.snippet.isNotBlank() && !last.subject.startsWith("Re:", true) -> "${last.subject} – ${last.snippet}"
                        last.snippet.isNotBlank() -> last.snippet
                        last.subject.isNotBlank() -> last.subject
                        last.hasAttachments -> stringResource(R.string.attachment)
                        else -> stringResource(R.string.no_subject)
                    }
                    Text(
                        sender + preview,
                        modifier = Modifier.weight(1f),
                        color = if (unread) Wa.colors.text else Wa.colors.textSecondary,
                        fontSize = 15.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                } else {
                    Spacer(Modifier.weight(1f))
                }
                if (c.isFavorite) {
                    Spacer(Modifier.width(4.dp))
                    Icon(Icons.Filled.Star, stringResource(R.string.favorite), tint = Wa.colors.textSecondary, modifier = Modifier.size(16.dp))
                }
                if (unread) {
                    Spacer(Modifier.width(8.dp))
                    Box(
                        Modifier.defaultMinSize(minWidth = 22.dp, minHeight = 22.dp).background(Wa.colors.unreadBadge, CircleShape).padding(horizontal = 6.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(if (c.unreadCount > 99) "99+" else c.unreadCount.toString(), color = Wa.colors.onGreen, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}
