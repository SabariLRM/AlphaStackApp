package com.phonemail.app.ui.chat

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.phonemail.app.AppContainer
import com.phonemail.app.R
import com.phonemail.app.data.Attachment
import com.phonemail.app.data.Message
import com.phonemail.app.ui.components.avatarColor
import com.phonemail.app.ui.theme.Wa
import com.phonemail.app.util.fileSize
import com.phonemail.app.util.timeOf
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

private const val MAX_BUBBLE_LINES = 14
private const val MAX_BUBBLE_CHARS = 900

/** Text shown in the bubble: quoted reply history is dropped (the reply is linked instead). */
fun chatText(m: Message): String {
    val lines = m.text.replace("\r\n", "\n").lines()
    val out = mutableListOf<String>()
    for (line in lines) {
        if (Regex("^On .+wrote:\\s*$").matches(line.trim())) break
        if (line.trimStart().startsWith(">")) continue
        out += line
    }
    return out.joinToString("\n").trim()
}

fun isLong(text: String) = text.length > MAX_BUBBLE_CHARS || text.count { it == '\n' } >= MAX_BUBBLE_LINES

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MessageBubble(
    container: AppContainer,
    message: Message,
    isGroup: Boolean,
    showTail: Boolean,
    onOpen: () -> Unit,
    onLongPress: () -> Unit,
    onSwipeReply: () -> Unit,
    onQuoteClick: (String) -> Unit,
    onAttachment: (Attachment) -> Unit,
) {
    val context = LocalContext.current
    val out = message.isOutgoing
    val colors = Wa.colors
    val haptics = LocalHapticFeedback.current
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val offset = remember { Animatable(0f) }
    val swipeReply by rememberUpdatedState(onSwipeReply)
    val threshold = with(density) { 64.dp.toPx() }
    val maxDrag = with(density) { 96.dp.toPx() }
    val screenWidth = LocalConfiguration.current.screenWidthDp.dp
    val text = remember(message.text) { chatText(message) }
    val long = isLong(text)
    val shape = RoundedCornerShape(
        topStart = if (!out && showTail) 0.dp else 10.dp,
        topEnd = if (out && showTail) 0.dp else 10.dp,
        bottomStart = 10.dp,
        bottomEnd = 10.dp,
    )

    Box(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = if (showTail) 3.dp else 1.dp)
            // Swipe right to reply (WhatsApp gesture).
            .pointerInput(message.id) {
                var triggered = false
                detectHorizontalDragGestures(
                    onDragStart = { triggered = false },
                    onDragEnd = { scope.launch { offset.animateTo(0f, spring()) } },
                    onDragCancel = { scope.launch { offset.animateTo(0f, spring()) } },
                ) { change, drag ->
                    val next = (offset.value + drag).coerceIn(0f, maxDrag)
                    if (next != offset.value) change.consume()
                    scope.launch { offset.snapTo(next) }
                    if (!triggered && next >= threshold) {
                        triggered = true
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        swipeReply()
                    }
                }
            },
    ) {
        // Reply arrow revealed behind the bubble while dragging.
        val progress = (offset.value / threshold).coerceIn(0f, 1f)
        if (progress > 0f) {
            Box(
                Modifier.align(Alignment.CenterStart).padding(start = 8.dp).size(32.dp).alpha(progress).clip(CircleShape).background(colors.dateChip),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.AutoMirrored.Filled.Reply, null, tint = colors.textSecondary, modifier = Modifier.size(18.dp))
            }
        }
        Row(
            Modifier.fillMaxWidth().offset { IntOffset(offset.value.roundToInt(), 0) },
            horizontalArrangement = if (out) Arrangement.End else Arrangement.Start,
        ) {
            Surface(
                shape = shape,
                color = if (out) colors.bubbleOut else colors.bubbleIn,
                shadowElevation = 0.5.dp,
                modifier = Modifier
                    .widthIn(min = 96.dp, max = screenWidth * 0.82f)
                    .clip(shape)
                    .combinedClickable(onClick = onOpen, onLongClick = onLongPress),
            ) {
                Column(Modifier.padding(start = 9.dp, end = 9.dp, top = 6.dp, bottom = 4.dp)) {
                    if (isGroup && !out) {
                        Text(
                            container.displayNameFor(message.from.address, message.from.name),
                            color = avatarColor(message.from.address),
                            fontWeight = FontWeight.Medium,
                            fontSize = 13.sp,
                            maxLines = 1,
                        )
                    }
                    message.replyTo?.let { quote ->
                        QuoteBlock(
                            senderLabel = if (quote.direction == "out") stringResource(R.string.you) else container.displayNameFor(quote.from.address, quote.from.name),
                            subject = quote.subject,
                            snippet = quote.snippet,
                            background = if (out) colors.quoteBackgroundOut else colors.quoteBackgroundIn,
                            modifier = Modifier.padding(bottom = 4.dp).clickable { onQuoteClick(quote.id) },
                        )
                    }
                    // New emails show their subject at the top; replies are linked instead.
                    if (message.replyTo == null && message.replyToEntryId == null && message.subject.isNotBlank()) {
                        Text(message.subject, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = colors.text, modifier = Modifier.padding(bottom = 2.dp))
                    }
                    if (text.isNotEmpty()) {
                        Text(
                            text,
                            fontSize = 15.5.sp,
                            color = colors.text,
                            lineHeight = 21.sp,
                            maxLines = MAX_BUBBLE_LINES,
                            overflow = TextOverflow.Ellipsis,
                        )
                    } else if (message.html != null && message.attachments.isEmpty()) {
                        Text(stringResource(R.string.tap_to_view_email), fontSize = 14.sp, color = colors.textSecondary)
                    }
                    if (long) {
                        Text(stringResource(R.string.read_more), color = colors.link, fontSize = 14.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 2.dp))
                    }
                    message.attachments.forEach { att ->
                        Spacer(Modifier.height(4.dp))
                        AttachmentChip(container, att, out) { onAttachment(att) }
                    }
                    Row(Modifier.align(Alignment.End).padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (message.repliedAt != null) {
                            Icon(Icons.AutoMirrored.Filled.Reply, stringResource(R.string.replied), tint = colors.bubbleMeta, modifier = Modifier.size(13.dp))
                            Spacer(Modifier.width(3.dp))
                        }
                        if (message.isStarred) {
                            Icon(Icons.Filled.Star, stringResource(R.string.starred), tint = colors.bubbleMeta, modifier = Modifier.size(12.dp))
                            Spacer(Modifier.width(3.dp))
                        }
                        Text(timeOf(context, message.sentAt), fontSize = 11.sp, color = colors.bubbleMeta)
                        if (out) {
                            Spacer(Modifier.width(3.dp))
                            Icon(Icons.Filled.Done, stringResource(R.string.sent), tint = colors.bubbleMeta, modifier = Modifier.size(15.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun QuoteBlock(
    senderLabel: String,
    subject: String,
    snippet: String,
    background: androidx.compose.ui.graphics.Color,
    modifier: Modifier = Modifier,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier.fillMaxWidth().height(IntrinsicSize.Min).clip(RoundedCornerShape(7.dp)).background(background),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(4.dp).fillMaxHeight().background(Wa.colors.quoteBar))
        Column(Modifier.weight(1f).padding(horizontal = 8.dp, vertical = 6.dp)) {
            Text(senderLabel, color = Wa.colors.quoteBar, fontWeight = FontWeight.Medium, fontSize = 13.sp, maxLines = 1)
            val line = listOf(subject, snippet).filter { it.isNotBlank() }.joinToString(" – ")
            Text(line.ifBlank { stringResource(R.string.email) }, color = Wa.colors.textSecondary, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        trailing?.invoke()
    }
}

@Composable
private fun AttachmentChip(container: AppContainer, att: Attachment, out: Boolean, onClick: () -> Unit) {
    val context = LocalContext.current
    val url = container.client.absolute(att.url)
    if (att.contentType.startsWith("image/") && url != null) {
        AsyncImage(
            model = ImageRequest.Builder(context).data(url).crossfade(true).build(),
            contentDescription = att.filename,
            contentScale = ContentScale.Crop,
            modifier = Modifier.widthIn(max = 260.dp).heightIn(min = 80.dp, max = 220.dp).clip(RoundedCornerShape(8.dp)).clickable(onClick = onClick),
        )
        return
    }
    Row(
        Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (out) Wa.colors.quoteBackgroundOut else Wa.colors.quoteBackgroundIn)
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.Description, null, tint = Wa.colors.danger, modifier = Modifier.size(30.dp))
        Spacer(Modifier.width(8.dp))
        Column(Modifier.widthIn(max = 200.dp)) {
            Text(att.filename, color = Wa.colors.text, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("${fileSize(att.size)} · ${att.filename.substringAfterLast('.', "").uppercase().ifBlank { "FILE" }}", color = Wa.colors.textSecondary, fontSize = 12.sp)
        }
    }
}
