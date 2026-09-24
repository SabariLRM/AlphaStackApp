package com.phonemail.app

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.phonemail.app.data.safeCall
import com.phonemail.app.util.ActiveChat
import com.phonemail.app.util.Notifications
import com.phonemail.app.util.SyncWorker
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import java.time.Instant

class PhoneMailApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        val snapshot = runBlocking { container.prefs.snapshot() }
        container.client.setBaseUrl(snapshot.serverUrl)
        container.client.token = snapshot.token
        Notifications.createChannels(this)

        if (snapshot.token != null) {
            container.realtime.start()
            SyncWorker.schedule(this)
        }
        container.scope.launch { runCatching { container.loadConfig() } }

        // While the process is alive the socket delivers mail instantly; notify unless that chat is open.
        container.scope.launch {
            container.realtime.events.collect { event ->
                if (event.type != "entry.created" || event.direction != "in" || event.folder != "inbox") return@collect
                val entryId = event.entryId ?: return@collect
                val foreground = ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
                if (foreground && ActiveChat.conversationId == event.conversationId) return@collect
                if (!container.prefs.snapshot().notificationsEnabled) return@collect
                container.prefs.setLastSync(Instant.now().toString())
                runCatching {
                    val msg = safeCall { container.api.message(entryId) }
                    Notifications.showNewMail(
                        this@PhoneMailApp, msg.id, msg.conversationId,
                        container.displayNameFor(msg.from.address, msg.from.name), msg.subject, msg.snippet,
                    )
                }
            }
        }

        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                container.scope.launch { container.prefs.setLastSync(Instant.now().toString()) }
                if (container.client.token != null) container.realtime.start()
            }

            override fun onStop(owner: LifecycleOwner) {
                container.scope.launch { container.prefs.setLastSync(Instant.now().toString()) }
            }
        })
    }
}
