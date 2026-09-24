package com.phonemail.app.data

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import okio.source
import java.io.ByteArrayOutputStream
import java.io.File

data class PickedFile(val uri: Uri, val name: String, val size: Long, val mime: String)

object Files {
    fun describe(context: Context, uri: Uri): PickedFile {
        var name = "attachment"
        var size = -1L
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                c.getString(0)?.let { name = it }
                if (!c.isNull(1)) size = c.getLong(1)
            }
        }
        val mime = context.contentResolver.getType(uri) ?: "application/octet-stream"
        return PickedFile(uri, name, size, mime)
    }

    /** Streams a picked document to the server without loading it into memory. */
    suspend fun upload(context: Context, client: ApiClient, file: PickedFile): Attachment {
        val body = object : RequestBody() {
            override fun contentType(): MediaType? = file.mime.toMediaTypeOrNull()
            override fun contentLength(): Long = file.size
            override fun writeTo(sink: BufferedSink) {
                context.contentResolver.openInputStream(file.uri)?.use { sink.writeAll(it.source()) }
                    ?: throw java.io.IOException("Cannot read ${file.name}")
            }
        }
        val part = MultipartBody.Part.createFormData("file", file.name, body)
        val res = safeCall { client.api.upload(part) }
        return Attachment(res.id, res.filename, res.contentType, res.size)
    }

    /** Downscales a picked photo to at most 640px and re-encodes it as JPEG for the profile picture. */
    suspend fun avatarPart(context: Context, uri: Uri): MultipartBody.Part = withContext(Dispatchers.IO) {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= 640 && bounds.outHeight / (sample * 2) >= 640) sample *= 2
        val bitmap = context.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: throw ApiException(-1, "invalid_image", "That image could not be read.")
        val scale = minOf(1f, 640f / maxOf(bitmap.width, bitmap.height))
        val scaled = if (scale < 1f) Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt(), (bitmap.height * scale).toInt(), true) else bitmap
        val bytes = ByteArrayOutputStream().use { out ->
            scaled.compress(Bitmap.CompressFormat.JPEG, 88, out)
            out.toByteArray()
        }
        MultipartBody.Part.createFormData("file", "avatar.jpg", bytes.toRequestBody("image/jpeg".toMediaTypeOrNull()))
    }

    /** Downloads an attachment into the app cache and opens it with a suitable app. */
    suspend fun open(context: Context, client: ApiClient, attachment: Attachment): Boolean {
        val url = client.absolute(attachment.url) ?: return false
        val dir = File(context.cacheDir, "attachments/${attachment.id}").apply { mkdirs() }
        val safeName = attachment.filename.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifBlank { "attachment" }
        val file = File(dir, safeName)
        if (!file.exists() || file.length() != attachment.size) {
            withContext(Dispatchers.IO) {
                safeCall {
                    client.http.newCall(Request.Builder().url(url).build()).execute().use { res ->
                        if (!res.isSuccessful) throw ApiException(res.code, "download_failed", "Download failed (${res.code}).")
                        val tmp = File(dir, "$safeName.part")
                        res.body!!.byteStream().use { input -> tmp.outputStream().use { input.copyTo(it) } }
                        tmp.renameTo(file)
                    }
                }
            }
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, attachment.contentType)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return try {
            context.startActivity(Intent.createChooser(intent, attachment.filename).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }
}
