package com.phonemail.app.util

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.phonemail.app.MainActivity
import com.phonemail.app.R

object Notifications {
    const val CHANNEL_MAIL = "new_mail"
    const val EXTRA_CONVERSATION_ID = "conversationId"

    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(CHANNEL_MAIL, context.getString(R.string.notif_channel_mail), NotificationManager.IMPORTANCE_HIGH).apply {
            description = context.getString(R.string.notif_channel_mail_desc)
        }
        context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    fun canNotify(context: Context): Boolean =
        (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(context).areNotificationsEnabled()

    fun showNewMail(context: Context, entryId: String, conversationId: String, sender: String, subject: String, snippet: String) {
        if (!canNotify(context)) return
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_CONVERSATION_ID, conversationId)
        }
        val pending = PendingIntent.getActivity(
            context, conversationId.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val title = subject.ifBlank { context.getString(R.string.no_subject) }
        val notification = NotificationCompat.Builder(context, CHANNEL_MAIL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(sender)
            .setContentText(title)
            .setStyle(NotificationCompat.BigTextStyle().bigText(if (snippet.isBlank()) title else "$title\n$snippet"))
            .setColor(0xFF1DAA61.toInt())
            .setCategory(NotificationCompat.CATEGORY_EMAIL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(entryId.hashCode(), notification)
        } catch (_: SecurityException) {
            // Permission revoked between the check and the call.
        }
    }

    fun clearAll(context: Context) = NotificationManagerCompat.from(context).cancelAll()
}

/** Which chat is on screen, so we don't notify about mail the user is already looking at. */
object ActiveChat {
    @Volatile var conversationId: String? = null
}
