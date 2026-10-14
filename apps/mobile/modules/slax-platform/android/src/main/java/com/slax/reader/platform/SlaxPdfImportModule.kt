package com.slax.reader.platform

import android.app.Activity
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import expo.modules.kotlin.Promise
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.nio.file.Files
import java.nio.file.LinkOption
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.coroutines.coroutineContext

class SlaxPdfImportModule : Module() {
  private lateinit var picker: AppContextActivityResultLauncher<String, SlaxPdfPickResult>
  private val pendingPick = AtomicReference<SlaxPdfPickRequest?>(null)

  override fun definition() = ModuleDefinition {
    Name("SlaxPdfImport")

    RegisterActivityContracts {
      picker = registerForActivityResult(SlaxPdfPickContract())
    }
    OnActivityDestroys { interruptPick() }
    OnDestroy { interruptPick() }

    AsyncFunction("pick") { promise: Promise ->
      val request = SlaxPdfPickRequest(promise)
      if (!pendingPick.compareAndSet(null, request)) {
        request.reject("A PDF picker is already open")
      } else {
        val job = appContext.mainQueue.launch(start = CoroutineStart.LAZY) {
          var imported: SlaxImportedPdf? = null
          var delivered = false
          try {
            val context = appContext.reactContext ?: throw SlaxPdfImportException("Application context unavailable")
            val activity = appContext.currentActivity
            if (activity == null || activity.isFinishing || activity.isDestroyed || !::picker.isInitialized) {
              throw SlaxPdfImportException("Active screen unavailable")
            }
            val selection = picker.launch("")
            if (selection.cancelled) {
              request.resolve(null)
            } else {
              val uri = selection.uri
              if (selection.invalid || uri?.scheme != "content") throw SlaxPdfImportException("Choose one PDF file")
              val result = withContext(Dispatchers.IO) {
                copyPdf(context, uri).also { imported = it }
              }
              coroutineContext.ensureActive()
              delivered = request.resolve(mapOf("uri" to Uri.fromFile(result.file).toString(), "name" to result.name, "size" to result.size))
            }
          } catch (_: CancellationException) {
            request.reject("PDF import interrupted")
          } catch (error: SlaxPdfImportException) {
            request.reject(error.message ?: "Unable to import PDF")
          } catch (_: Exception) {
            request.reject("Unable to import PDF")
          } finally {
            if (!delivered) withContext(NonCancellable + Dispatchers.IO) { imported?.file?.let(::discardCopy) }
            pendingPick.compareAndSet(request, null)
          }
        }
        request.attach(job)
        job.invokeOnCompletion {
          request.reject("PDF import interrupted")
          pendingPick.compareAndSet(request, null)
        }
        job.start()
      }
      Unit
    }.runOnQueue(expo.modules.kotlin.functions.Queues.MAIN)

    AsyncFunction("remove") Coroutine { raw: String ->
      withContext(Dispatchers.IO) {
        try {
          val context = appContext.reactContext ?: throw SlaxPdfImportException("Application context unavailable")
          val uri = Uri.parse(raw)
          if (uri.scheme != "file" || !uri.authority.isNullOrEmpty() || uri.query != null || uri.fragment != null) {
            throw SlaxPdfImportException("Invalid temporary PDF")
          }
          val file = File(uri.path ?: throw SlaxPdfImportException("Invalid temporary PDF")).absoluteFile
          val directory = file.parentFile ?: throw SlaxPdfImportException("Invalid temporary PDF")
          val root = importRoot(context)
          if (file.name != "document.pdf" || directory.parentFile != root || !isImportId(directory.name) ||
            directory.canonicalFile != directory || file.canonicalFile != file ||
            (Files.exists(file.toPath(), LinkOption.NOFOLLOW_LINKS) && !Files.isRegularFile(file.toPath(), LinkOption.NOFOLLOW_LINKS))) {
            throw SlaxPdfImportException("Invalid temporary PDF")
          }
          Files.deleteIfExists(file.toPath())
          directory.delete()
          Unit
        } catch (error: SlaxPdfImportException) {
          throw error
        } catch (_: Exception) {
          throw SlaxPdfImportException("Unable to remove temporary PDF")
        }
      }
    }
  }

  private fun interruptPick() {
    pendingPick.getAndSet(null)?.interrupt()
  }

  private suspend fun copyPdf(context: Context, uri: Uri): SlaxImportedPdf {
    val resolver = context.contentResolver
    val metadata = metadata(resolver, uri)
    if (metadata.second != null && metadata.second!! > MAX_BYTES) throw SlaxPdfImportException("PDF must not exceed 50 MiB")
    val root = importRoot(context)
    if (!root.isDirectory && !root.mkdir()) throw SlaxPdfImportException("Unable to create temporary PDF")
    val directory = File(root, UUID.randomUUID().toString())
    if (!directory.mkdir()) throw SlaxPdfImportException("Unable to create temporary PDF")
    val file = File(directory, "document.pdf")
    var complete = false
    try {
      var total = 0L
      val header = ByteArray(1024)
      var headerLength = 0
      resolver.openInputStream(uri)?.use { input ->
        Files.newOutputStream(file.toPath(), java.nio.file.StandardOpenOption.CREATE_NEW, java.nio.file.StandardOpenOption.WRITE).use { output ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            coroutineContext.ensureActive()
            val limit = minOf(buffer.size.toLong(), MAX_BYTES - total + 1).toInt()
            var count = input.read(buffer, 0, limit)
            if (count == 0) {
              val byte = input.read()
              if (byte < 0) break
              buffer[0] = byte.toByte()
              count = 1
            }
            if (count < 0) break
            total += count
            if (total > MAX_BYTES) throw SlaxPdfImportException("PDF must not exceed 50 MiB")
            if (headerLength < header.size) {
              val copied = minOf(count, header.size - headerLength)
              buffer.copyInto(header, headerLength, 0, copied)
              headerLength += copied
              if (headerLength == header.size && !hasPdfSignature(header, headerLength)) throw SlaxPdfImportException("Invalid PDF file")
            }
            output.write(buffer, 0, count)
          }
        }
      } ?: throw SlaxPdfImportException("Unable to read PDF")
      if (total == 0L || !hasPdfSignature(header, headerLength)) throw SlaxPdfImportException("Invalid PDF file")
      coroutineContext.ensureActive()
      complete = true
      return SlaxImportedPdf(file, safeName(metadata.first), total)
    } finally {
      if (!complete) discardCopy(file)
    }
  }

  private fun metadata(resolver: ContentResolver, uri: Uri): Pair<String?, Long?> = try {
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
      if (!cursor.moveToFirst()) return@use null
      val name = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
      val size = cursor.getColumnIndex(OpenableColumns.SIZE)
      Pair(if (name >= 0 && !cursor.isNull(name)) cursor.getString(name) else null, if (size >= 0 && !cursor.isNull(size)) cursor.getLong(size) else null)
    } ?: Pair(null, null)
  } catch (_: Exception) {
    Pair(null, null)
  }

  private fun importRoot(context: Context): File {
    val root = File(context.cacheDir.canonicalFile, "slax-pdf-import")
    if (root.canonicalFile != root) throw SlaxPdfImportException("Invalid temporary PDF storage")
    return root
  }

  private fun isImportId(value: String): Boolean = runCatching { UUID.fromString(value).toString() == value }.getOrDefault(false)

  private fun discardCopy(file: File) {
    runCatching { Files.deleteIfExists(file.toPath()) }
    file.parentFile?.delete()
  }

  private fun hasPdfSignature(header: ByteArray, length: Int): Boolean = (0..length - 4).any {
    header[it] == 0x25.toByte() && header[it + 1] == 0x50.toByte() && header[it + 2] == 0x44.toByte() && header[it + 3] == 0x46.toByte()
  }

  private fun safeName(raw: String?): String {
    val leaf = raw.orEmpty().replace('\\', '/').substringAfterLast('/')
    val name = StringBuilder()
    leaf.codePoints().limit(156).forEach { code ->
      if (!Character.isISOControl(code) && Character.getType(code) != Character.FORMAT.toInt() &&
        Character.getType(code) != Character.LINE_SEPARATOR.toInt() && Character.getType(code) != Character.PARAGRAPH_SEPARATOR.toInt()) {
        if (code < 128 && "<>:\"|?*".contains(code.toChar())) name.append('_') else name.appendCodePoint(code)
      }
    }
    val value = name.toString().trim { it.isWhitespace() || it == '.' }
    return if (value.isEmpty()) "Document.pdf" else if (value.endsWith(".pdf", ignoreCase = true)) value else "$value.pdf"
  }

  private companion object {
    const val MAX_BYTES = 50L * 1024 * 1024
  }
}

private class SlaxPdfPickRequest(private val promise: Promise) {
  private val settled = AtomicBoolean(false)
  private val job = AtomicReference<Job?>(null)

  fun attach(value: Job) {
    job.set(value)
    if (settled.get()) value.cancel()
  }

  fun resolve(value: Any?): Boolean {
    if (!settled.compareAndSet(false, true)) return false
    promise.resolve(value)
    return true
  }

  fun reject(message: String) {
    if (settled.compareAndSet(false, true)) promise.reject("ERR_PDF_IMPORT", message, null)
  }

  fun interrupt() {
    reject("PDF import interrupted")
    job.get()?.cancel(CancellationException("PDF import interrupted"))
  }
}

private data class SlaxImportedPdf(val file: File, val name: String, val size: Long)
private class SlaxPdfImportException(message: String) : CodedException(message)
private data class SlaxPdfPickResult(val uri: Uri? = null, val cancelled: Boolean = false, val invalid: Boolean = false)

private class SlaxPdfPickContract : AppContextActivityResultContract<String, SlaxPdfPickResult> {
  override fun createIntent(context: Context, input: String) = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
    type = "application/pdf"
    addCategory(Intent.CATEGORY_OPENABLE)
    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
  }

  override fun parseResult(input: String, resultCode: Int, intent: Intent?): SlaxPdfPickResult {
    if (resultCode == Activity.RESULT_CANCELED) return SlaxPdfPickResult(cancelled = true)
    if (resultCode != Activity.RESULT_OK || intent == null || (intent.clipData?.itemCount ?: 0) > 1) return SlaxPdfPickResult(invalid = true)
    val uri = intent.data ?: intent.clipData?.takeIf { it.itemCount == 1 }?.getItemAt(0)?.uri
    return SlaxPdfPickResult(uri = uri, invalid = uri == null)
  }
}
