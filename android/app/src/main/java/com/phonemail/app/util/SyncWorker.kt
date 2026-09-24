package com.phonemail.app.util

import android.content.Context
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.phonemail.app.PhoneMailApp
import com.phonemail.app.data.safeCall
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * Background check for new mail (every 15 minutes, the Android minimum) so users get notified
 * while the app is closed. It also keeps the session "active", which tells the server this user
 * has the app and should not be sent SMS notifications.
 */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as PhoneMailApp
        val container = app.container
        val prefs = container.prefs.snapshot()
        if (prefs.token == null) return Result.success()
        container.client.token = prefs.token
        return try {
            val since = container.prefs.lastSync()
            val res = safeCall { container.client.api.syncNotifications(since) }
            container.prefs.setLastSync(res.now)
            val foreground = withContext(Dispatchers.Main) {
                ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
            }
            if (since != null && prefs.notificationsEnabled && !foreground) {
                for (item in res.items.reversed()) {
                    Notifications.showNewMail(
                        applicationContext, item.id, item.conversationId,
                        container.displayNameFor(item.from.address, item.from.name),
                        item.subject, item.snippet,
                    )
                }
            }
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }

    companion object {
        private const val NAME = "mail-sync"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun cancel(context: Context) = WorkManager.getInstance(context).cancelUniqueWork(NAME)
    }
}
