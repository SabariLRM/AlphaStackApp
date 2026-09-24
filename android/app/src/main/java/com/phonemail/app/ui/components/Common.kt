package com.phonemail.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.ImageShader
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.PaintingStyle
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.SubcomposeAsyncImage
import coil.request.ImageRequest
import com.phonemail.app.ui.theme.Wa
import com.phonemail.app.util.initials
import kotlin.math.abs

private val AVATAR_COLORS = listOf(
    Color(0xFF25D366), Color(0xFF02A698), Color(0xFF53BDEB), Color(0xFF7F66FF), Color(0xFFFF72A1),
    Color(0xFFFFBC38), Color(0xFFA5B337), Color(0xFF1FA855), Color(0xFFFA6533), Color(0xFF009DE2),
)

fun avatarColor(key: String): Color = AVATAR_COLORS[abs(key.hashCode()) % AVATAR_COLORS.size]

/** Round profile picture, falling back to coloured initials (or a group/person glyph). */
@Composable
fun Avatar(url: String?, label: String, key: String, size: Dp = 48.dp, group: Boolean = false) {
    val context = LocalContext.current
    val fallback = @Composable {
        Box(Modifier.size(size).clip(CircleShape).background(if (group) Color(0xFFDFE5E7) else avatarColor(key)), contentAlignment = Alignment.Center) {
            val text = if (group) "" else initials(label)
            when {
                group -> Icon(Icons.Filled.Group, null, tint = Color.White, modifier = Modifier.size(size * 0.62f))
                text == "#" || text == "?" -> Icon(Icons.Filled.Person, null, tint = Color.White, modifier = Modifier.size(size * 0.62f))
                else -> Text(text, color = Color.White, fontWeight = FontWeight.Medium, fontSize = (size.value * 0.38f).sp)
            }
        }
    }
    if (url == null) {
        fallback()
        return
    }
    SubcomposeAsyncImage(
        model = ImageRequest.Builder(context).data(url).crossfade(true).build(),
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = Modifier.size(size).clip(CircleShape),
        loading = { fallback() },
        error = { fallback() },
    )
}

@Composable
fun GreenButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, loading: Boolean = false) {
    Button(
        onClick = onClick,
        enabled = enabled && !loading,
        modifier = modifier.height(44.dp),
        shape = RoundedCornerShape(24.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Wa.colors.green, contentColor = Wa.colors.onGreen),
        contentPadding = PaddingValues(horizontal = 28.dp),
    ) {
        if (loading) CircularProgressIndicator(Modifier.size(20.dp), color = Wa.colors.onGreen, strokeWidth = 2.dp)
        else Text(text, fontWeight = FontWeight.Medium, fontSize = 15.sp)
    }
}

@Composable
fun LoadingBox(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = Wa.colors.green)
    }
}

@Composable
fun EmptyState(icon: ImageVector, title: String, body: String? = null, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    Column(
        modifier.fillMaxWidth().padding(horizontal = 40.dp, vertical = 64.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(Modifier.size(96.dp).clip(CircleShape).background(Wa.colors.chip), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = Wa.colors.green, modifier = Modifier.size(44.dp))
        }
        Spacer(Modifier.height(20.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, color = Wa.colors.text, textAlign = TextAlign.Center)
        if (body != null) {
            Spacer(Modifier.height(8.dp))
            Text(body, style = MaterialTheme.typography.bodyMedium, color = Wa.colors.textSecondary, textAlign = TextAlign.Center)
        }
        if (action != null) {
            Spacer(Modifier.height(20.dp))
            action()
        }
    }
}

@Composable
fun ConfirmDialog(
    title: String,
    text: String?,
    confirm: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    dismiss: String,
    danger: Boolean = false,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = text?.let { { Text(it, color = Wa.colors.textSecondary) } },
        confirmButton = {
            TextButton(onClick = onConfirm) { Text(confirm, color = if (danger) Wa.colors.danger else Wa.colors.greenDark, fontWeight = FontWeight.Medium) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(dismiss, color = Wa.colors.greenDark) } },
        containerColor = Wa.colors.surface,
    )
}

/** WhatsApp-like doodle wallpaper, drawn once into a tile and repeated. */
@Composable
fun rememberChatWallpaper(): Brush {
    val doodle = Wa.colors.chatDoodle
    val density = LocalDensity.current
    return remember(doodle, density) {
        val tile = with(density) { 180.dp.roundToPx() }
        val bitmap = ImageBitmap(tile, tile)
        val canvas = Canvas(bitmap)
        val paint = Paint().apply {
            color = doodle
            style = PaintingStyle.Stroke
            strokeWidth = with(density) { 1.6.dp.toPx() }
            isAntiAlias = true
        }
        val u = tile / 12f
        fun envelope(x: Float, y: Float, w: Float) {
            val h = w * 0.68f
            canvas.drawRect(x, y, x + w, y + h, paint)
            canvas.drawPath(Path().apply { moveTo(x, y); lineTo(x + w / 2, y + h * 0.55f); lineTo(x + w, y) }, paint)
        }
        fun at(cx: Float, cy: Float, r: Float) {
            canvas.drawCircle(Offset(cx, cy), r, paint)
            canvas.drawCircle(Offset(cx, cy), r * 0.42f, paint)
        }
        fun phone(x: Float, y: Float, w: Float) {
            val h = w * 1.7f
            canvas.drawRoundRect(x, y, x + w, y + h, w * 0.2f, w * 0.2f, paint)
            canvas.drawLine(Offset(x + w * 0.35f, y + h * 0.88f), Offset(x + w * 0.65f, y + h * 0.88f), paint)
        }
        fun heart(cx: Float, cy: Float, s: Float) {
            canvas.drawPath(Path().apply {
                moveTo(cx, cy + s * 0.9f)
                cubicTo(cx - s * 1.4f, cy - s * 0.2f, cx - s * 0.5f, cy - s * 1.2f, cx, cy - s * 0.35f)
                cubicTo(cx + s * 0.5f, cy - s * 1.2f, cx + s * 1.4f, cy - s * 0.2f, cx, cy + s * 0.9f)
            }, paint)
        }
        envelope(u * 1f, u * 1.2f, u * 2.6f)
        at(u * 7.5f, u * 2.2f, u * 1.1f)
        phone(u * 10f, u * 0.6f, u * 1.2f)
        heart(u * 3f, u * 6.6f, u * 0.9f)
        envelope(u * 6.6f, u * 5.6f, u * 2.2f)
        at(u * 10.6f, u * 7.2f, u * 0.8f)
        phone(u * 1.2f, u * 9f, u * 1.1f)
        heart(u * 6f, u * 10.4f, u * 0.7f)
        envelope(u * 8.6f, u * 9.6f, u * 2f)
        ShaderBrush(ImageShader(bitmap, TileMode.Repeated, TileMode.Repeated))
    }
}
