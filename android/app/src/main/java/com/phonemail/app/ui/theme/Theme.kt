package com.phonemail.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/** WhatsApp's design language: green accents, beige chat wallpaper, green outgoing bubbles. */
@Immutable
data class WaColors(
    val green: Color,
    val greenDark: Color,
    val onGreen: Color,
    val topBar: Color,
    val onTopBar: Color,
    val title: Color,
    val background: Color,
    val surface: Color,
    val text: Color,
    val textSecondary: Color,
    val divider: Color,
    val searchBar: Color,
    val chip: Color,
    val chipText: Color,
    val chipSelected: Color,
    val chipSelectedText: Color,
    val unreadBadge: Color,
    val chatBackground: Color,
    val chatDoodle: Color,
    val bubbleOut: Color,
    val bubbleIn: Color,
    val bubbleMeta: Color,
    val inputBar: Color,
    val quoteBar: Color,
    val quoteBackgroundIn: Color,
    val quoteBackgroundOut: Color,
    val dateChip: Color,
    val link: Color,
    val danger: Color,
    val star: Color,
)

val LightWa = WaColors(
    green = Color(0xFF1DAA61),
    greenDark = Color(0xFF008069),
    onGreen = Color.White,
    topBar = Color.White,
    onTopBar = Color(0xFF54656F),
    title = Color(0xFF1DAA61),
    background = Color.White,
    surface = Color.White,
    text = Color(0xFF111B21),
    textSecondary = Color(0xFF667781),
    divider = Color(0xFFE9EDEF),
    searchBar = Color(0xFFF0F2F5),
    chip = Color(0xFFF0F2F5),
    chipText = Color(0xFF54656F),
    chipSelected = Color(0xFFD8FDD2),
    chipSelectedText = Color(0xFF15603E),
    unreadBadge = Color(0xFF25D366),
    chatBackground = Color(0xFFEFEAE2),
    chatDoodle = Color(0x14000000),
    bubbleOut = Color(0xFFD9FDD3),
    bubbleIn = Color.White,
    bubbleMeta = Color(0xFF667781),
    inputBar = Color.White,
    quoteBar = Color(0xFF06CF9C),
    quoteBackgroundIn = Color(0xFFF5F6F6),
    quoteBackgroundOut = Color(0xFFD1F4CC),
    dateChip = Color(0xFFFFFFFF),
    link = Color(0xFF027EB5),
    danger = Color(0xFFEA0038),
    star = Color(0xFFF7B928),
)

val DarkWa = WaColors(
    green = Color(0xFF21C063),
    greenDark = Color(0xFF00A884),
    onGreen = Color(0xFF0B141A),
    topBar = Color(0xFF0B141A),
    onTopBar = Color(0xFFAEBAC1),
    title = Color(0xFFE9EDEF),
    background = Color(0xFF0B141A),
    surface = Color(0xFF111B21),
    text = Color(0xFFE9EDEF),
    textSecondary = Color(0xFF8696A0),
    divider = Color(0xFF222D34),
    searchBar = Color(0xFF202C33),
    chip = Color(0xFF202C33),
    chipText = Color(0xFF8696A0),
    chipSelected = Color(0xFF103529),
    chipSelectedText = Color(0xFFD8FDD2),
    unreadBadge = Color(0xFF21C063),
    chatBackground = Color(0xFF0B141A),
    chatDoodle = Color(0x0FFFFFFF),
    bubbleOut = Color(0xFF005C4B),
    bubbleIn = Color(0xFF202C33),
    bubbleMeta = Color(0xFF8696A0),
    inputBar = Color(0xFF202C33),
    quoteBar = Color(0xFF06CF9C),
    quoteBackgroundIn = Color(0xFF1D282F),
    quoteBackgroundOut = Color(0xFF025144),
    dateChip = Color(0xFF182229),
    link = Color(0xFF53BDEB),
    danger = Color(0xFFF15C6D),
    star = Color(0xFFF7B928),
)

val LocalWa = staticCompositionLocalOf { LightWa }

object Wa {
    val colors: WaColors
        @Composable get() = LocalWa.current
}

@Composable
fun PhoneMailTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val wa = if (dark) DarkWa else LightWa
    val scheme = if (dark) {
        darkColorScheme(
            primary = wa.green,
            onPrimary = wa.onGreen,
            primaryContainer = wa.chipSelected,
            onPrimaryContainer = wa.chipSelectedText,
            secondary = wa.greenDark,
            background = wa.background,
            onBackground = wa.text,
            surface = wa.surface,
            onSurface = wa.text,
            surfaceVariant = wa.searchBar,
            onSurfaceVariant = wa.textSecondary,
            surfaceContainer = wa.surface,
            surfaceContainerHigh = Color(0xFF1F2C34),
            surfaceContainerHighest = Color(0xFF233138),
            surfaceContainerLow = wa.surface,
            outline = Color(0xFF3B4A54),
            outlineVariant = wa.divider,
            error = wa.danger,
        )
    } else {
        lightColorScheme(
            primary = wa.green,
            onPrimary = wa.onGreen,
            primaryContainer = wa.chipSelected,
            onPrimaryContainer = wa.chipSelectedText,
            secondary = wa.greenDark,
            background = wa.background,
            onBackground = wa.text,
            surface = wa.surface,
            onSurface = wa.text,
            surfaceVariant = wa.searchBar,
            onSurfaceVariant = wa.textSecondary,
            surfaceContainer = Color.White,
            surfaceContainerHigh = Color.White,
            surfaceContainerHighest = Color(0xFFF0F2F5),
            surfaceContainerLow = Color.White,
            outline = Color(0xFFD1D7DB),
            outlineVariant = wa.divider,
            error = wa.danger,
        )
    }
    CompositionLocalProvider(LocalWa provides wa) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
