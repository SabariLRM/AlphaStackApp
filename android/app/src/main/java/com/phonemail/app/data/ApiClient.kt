package com.phonemail.app.data

import retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.HttpException
import retrofit2.Retrofit
import java.io.IOException
import java.util.concurrent.TimeUnit

/** A failed API call with a user-presentable message. */
class ApiException(val status: Int, val code: String, override val message: String) : Exception(message)

val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
    coerceInputValues = true
}

/**
 * Holds the Retrofit client for the currently configured server. The server URL can be changed
 * at runtime (Settings → Server), which rebuilds the client.
 */
class ApiClient(initialBaseUrl: String) {
    @Volatile var token: String? = null
    @Volatile var baseUrl: String = normalize(initialBaseUrl)
        private set

    private val _unauthorized = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    /** Emits when a signed-in request is rejected (session revoked or expired). */
    val unauthorized: SharedFlow<Unit> = _unauthorized

    private val authInterceptor = Interceptor { chain ->
        val t = token
        val request = chain.request().newBuilder().apply {
            if (t != null) header("Authorization", "Bearer $t")
            header("User-Agent", "PhoneMail-Android/1.0")
        }.build()
        val response = chain.proceed(request)
        val path = request.url.encodedPath
        if (response.code == 401 && t != null && !path.startsWith("/api/auth/")) _unauthorized.tryEmit(Unit)
        response
    }

    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .pingInterval(25, TimeUnit.SECONDS)
        .addInterceptor(authInterceptor)
        .build()

    @Volatile var api: PhoneMailApi = build(baseUrl)
        private set

    private fun build(url: String): PhoneMailApi = Retrofit.Builder()
        .baseUrl(url)
        .client(http)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(PhoneMailApi::class.java)

    fun setBaseUrl(url: String) {
        val normalized = normalize(url)
        if (normalized == baseUrl) return
        baseUrl = normalized
        api = build(normalized)
    }

    /** Turns server-relative paths ("/api/avatars/…") into absolute URLs. */
    fun absolute(path: String?): String? {
        if (path.isNullOrBlank()) return null
        if (path.startsWith("http://") || path.startsWith("https://")) return path
        return baseUrl.trimEnd('/') + "/" + path.trimStart('/')
    }

    companion object {
        fun normalize(url: String): String {
            var u = url.trim()
            if (!u.startsWith("http://") && !u.startsWith("https://")) u = "http://$u"
            return if (u.endsWith("/")) u else "$u/"
        }
    }
}

/** Runs an API call and converts transport/HTTP failures into [ApiException]. */
suspend fun <T> safeCall(block: suspend () -> T): T {
    try {
        return block()
    } catch (e: CancellationException) {
        throw e
    } catch (e: HttpException) {
        val body = e.response()?.errorBody()?.string()
        val detail = runCatching { json.decodeFromString(ApiErrorBody.serializer(), body ?: "") }.getOrNull()?.error
        throw ApiException(e.code(), detail?.code ?: "http_${e.code()}", detail?.message?.ifBlank { null } ?: "Request failed (${e.code()})")
    } catch (e: IOException) {
        throw ApiException(0, "network", "Can't reach PhoneMail. Check your internet connection.")
    } catch (e: ApiException) {
        throw e
    } catch (e: Exception) {
        throw ApiException(-1, "unexpected", e.message ?: "Something went wrong.")
    }
}
