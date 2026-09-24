package com.phonemail.app.util

import android.content.Context
import android.text.format.DateFormat
import com.phonemail.app.R
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

private fun parse(iso: String): Instant = runCatching { Instant.parse(iso) }.getOrDefault(Instant.EPOCH)

fun instantOf(iso: String): Instant = parse(iso)

fun localDateOf(iso: String): LocalDate = parse(iso).atZone(ZoneId.systemDefault()).toLocalDate()

fun timeOf(context: Context, iso: String): String {
    val pattern = if (DateFormat.is24HourFormat(context)) "HH:mm" else "h:mm a"
    return DateTimeFormatter.ofPattern(pattern, Locale.getDefault()).format(parse(iso).atZone(ZoneId.systemDefault()))
}

/** Chat-list style: time today, "Yesterday", weekday this week, otherwise a short date. */
fun chatListTime(context: Context, iso: String): String {
    val date = localDateOf(iso)
    val today = LocalDate.now()
    return when {
        date == today -> timeOf(context, iso)
        date == today.minusDays(1) -> context.getString(R.string.yesterday)
        date.isAfter(today.minusDays(7)) -> DateTimeFormatter.ofPattern("EEEE", Locale.getDefault()).format(date)
        else -> DateTimeFormatter.ofLocalizedDate(FormatStyle.SHORT).withLocale(Locale.getDefault()).format(date)
    }
}

/** Date separator inside a chat: "Today", "Yesterday" or a full date. */
fun daySeparator(context: Context, date: LocalDate): String {
    val today = LocalDate.now()
    return when (date) {
        today -> context.getString(R.string.today)
        today.minusDays(1) -> context.getString(R.string.yesterday)
        else -> DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(Locale.getDefault()).format(date)
    }
}

fun fullDateTime(iso: String): String =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(Locale.getDefault()).format(parse(iso).atZone(ZoneId.systemDefault()))

fun fileSize(bytes: Long): String = when {
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> "${(bytes / 1024.0).let { if (it < 10) "%.1f".format(it) else "%.0f".format(it) }} KB"
    else -> "%.1f MB".format(bytes / 1024.0 / 1024.0)
}

fun initials(text: String): String {
    val clean = text.substringBefore('@').trim()
    if (clean.isEmpty()) return "?"
    if (clean.first().isDigit() || clean.first() == '+') return "#"
    val parts = clean.split(Regex("[\\s._-]+")).filter { it.isNotEmpty() }
    return ((parts.getOrNull(0)?.take(1) ?: "") + (parts.getOrNull(1)?.take(1) ?: "")).uppercase().ifEmpty { "?" }
}
