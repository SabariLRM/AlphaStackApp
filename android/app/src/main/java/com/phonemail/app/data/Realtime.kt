package com.phonemail.app.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

@Serializable
data class RealtimeEvent(
    val type: String,
    val entryId: String? = null,
    val conversationId: String? = null,
    val folder: String? = null,
    val direction: String? = null,
    val entryIds: List<String> = emptyList(),
    val conversationIds: List<String> = emptyList(),
)

/** Live mailbox events over the API's WebSocket while the app is in the foreground. */
class Realtime(private val client: ApiClient, private val scope: CoroutineScope) {
    private val _events = MutableSharedFlow<RealtimeEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<RealtimeEvent> = _events

    private var socket: WebSocket? = null
    private var reconnectJob: Job? = null
    private var wanted = false
    private var attempts = 0

    @Synchronized
    fun start() {
        wanted = true
        if (socket == null) connect()
    }

    @Synchronized
    fun stop() {
        wanted = false
        reconnectJob?.cancel()
        socket?.close(1000, "background")
        socket = null
    }

    @Synchronized
    private fun connect() {
        if (!wanted || client.token == null) return
        val url = client.baseUrl.replaceFirst("http", "ws") + "api/ws"
        socket = client.http.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                attempts = 0
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val event = runCatching { json.decodeFromString(RealtimeEvent.serializer(), text) }.getOrNull() ?: return
                if (event.type != "hello") _events.tryEmit(event)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = scheduleReconnect(webSocket)
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = scheduleReconnect(webSocket)
        })
    }

    @Synchronized
    private fun scheduleReconnect(closed: WebSocket) {
        if (socket !== closed) return
        socket = null
        if (!wanted) return
        attempts = (attempts + 1).coerceAtMost(6)
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(1000L shl attempts)
            // A reconnect means we may have missed events: tell listeners to refresh.
            _events.tryEmit(RealtimeEvent(type = "resync"))
            connect()
        }
    }
}
