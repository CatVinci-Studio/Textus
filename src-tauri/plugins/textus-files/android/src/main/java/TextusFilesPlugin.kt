package com.catvinci.textus.files

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.util.Base64
import android.view.HapticFeedbackConstants
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.PermissionState
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

// Android's side of Textus's document access, the Swift plugin's twin
// (ios/Sources/TextusFilesPlugin.swift). A picked file or folder is a
// content:// URL, read and written through the ContentResolver; its grant
// is taken as persistable, so it survives a relaunch. A picked folder on
// the device's storage opens by its plain path once the user allows access
// to all files, so the backend, plugins and file watching work as on the
// desktop; without it the folder stays a content:// URL.

@InvokeArg
class UrlArgs {
  lateinit var url: String
}

@InvokeArg
class WriteArgs {
  lateinit var url: String
  lateinit var text: String
}

@InvokeArg
class ShareArgs {
  lateinit var path: String
}

@InvokeArg
class CreateArgs {
  lateinit var name: String
}

private const val GRANT =
  Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION

@TauriPlugin(
  permissions = [Permission(strings = [Manifest.permission.WRITE_EXTERNAL_STORAGE], alias = "storage")]
)
class TextusFilesPlugin(private val activity: Activity) : Plugin(activity) {
  private val resolver get() = activity.contentResolver

  // ---- Pickers

  private fun opening(action: String) =
    Intent(action).addFlags(GRANT or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)

  @Command
  fun pickDocument(invoke: Invoke) {
    // Markdown has no MIME type every provider knows: any file, as iOS's
    // picker filters by extension only.
    val intent = opening(Intent.ACTION_OPEN_DOCUMENT)
      .addCategory(Intent.CATEGORY_OPENABLE)
      .setType("*/*")
    startActivityForResult(invoke, intent, "documentPicked")
  }

  @Command
  fun pickFolder(invoke: Invoke) {
    startActivityForResult(invoke, opening(Intent.ACTION_OPEN_DOCUMENT_TREE), "folderPicked")
  }

  /** Save As for a new document: the system's place-and-name picker. */
  @Command
  fun createDocument(invoke: Invoke) {
    val args = invoke.parseArgs(CreateArgs::class.java)
    val intent = opening(Intent.ACTION_CREATE_DOCUMENT)
      .addCategory(Intent.CATEGORY_OPENABLE)
      .setType("text/markdown")
      .putExtra(Intent.EXTRA_TITLE, args.name)
    startActivityForResult(invoke, intent, "documentPicked")
  }

  @ActivityCallback
  fun documentPicked(invoke: Invoke, result: ActivityResult) {
    val uri = result.data?.data ?: return invoke.resolve(JSObject().put("url", null))
    keep(uri)
    invoke.resolve(item(uri, false))
  }

  @ActivityCallback
  fun folderPicked(invoke: Invoke, result: ActivityResult) {
    val tree = result.data?.data ?: return invoke.resolve(JSObject().put("url", null))
    keep(tree)
    invoke.resolve(item(folderOf(tree), true))
  }

  private fun keep(uri: Uri) {
    runCatching { resolver.takePersistableUriPermission(uri, GRANT) }
  }

  /** A picked tree as the document URL of its top folder, which lists. */
  private fun folderOf(tree: Uri): Uri =
    DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))

  private fun item(uri: Uri, folder: Boolean) =
    JSObject().put("url", uri.toString()).put("name", nameOf(uri)).put("folder", folder)

  private fun nameOf(uri: Uri): String =
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
      ?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
      ?: uri.lastPathSegment?.substringAfterLast('/')?.substringAfterLast(':')
      ?: "Untitled"

  // ---- Reading and writing

  private fun reading(invoke: Invoke, read: (Uri) -> JSObject) {
    try {
      invoke.resolve(read(Uri.parse(invoke.parseArgs(UrlArgs::class.java).url)))
    } catch (e: Exception) {
      invoke.reject(e.message ?: "Can't read this file")
    }
  }

  private fun bytes(uri: Uri): ByteArray =
    resolver.openInputStream(uri)?.use { it.readBytes() } ?: error("Can't open this file")

  @Command
  fun readText(invoke: Invoke) = reading(invoke) { JSObject().put("text", String(bytes(it), Charsets.UTF_8)) }

  /** A file's bytes as base64: an image beside a picked document. */
  @Command
  fun readData(invoke: Invoke) =
    reading(invoke) { JSObject().put("data", Base64.encodeToString(bytes(it), Base64.NO_WRAP)) }

  @Command
  fun writeText(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(WriteArgs::class.java)
      // "wt": truncated first, or a shorter text leaves the old one's tail.
      resolver.openOutputStream(Uri.parse(args.url), "wt")?.use {
        it.write(args.text.toByteArray(Charsets.UTF_8))
      } ?: error("Can't write this file")
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject(e.message ?: "Can't write this file")
    }
  }

  @Command
  fun listFolder(invoke: Invoke) = reading(invoke) { folder ->
    val children = DocumentsContract.buildChildDocumentsUriUsingTree(
      folder, DocumentsContract.getDocumentId(folder))
    val columns = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
    )
    val entries = JSArray()
    resolver.query(children, columns, null, null, null)?.use { c: Cursor ->
      while (c.moveToNext()) {
        val name = c.getString(1) ?: continue
        if (name.startsWith(".")) continue
        val url = DocumentsContract.buildDocumentUriUsingTree(folder, c.getString(0))
        entries.put(
          JSObject().put("url", url.toString()).put("name", name)
            .put("folder", c.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR))
      }
    }
    JSObject().put("entries", entries)
  }

  // ---- Remembered items and folders

  @Command
  fun remembered(invoke: Invoke) {
    val items = JSArray()
    for (grant in resolver.persistedUriPermissions) {
      val tree = DocumentsContract.isTreeUri(grant.uri)
      runCatching { items.put(item(if (tree) folderOf(grant.uri) else grant.uri, tree)) }
    }
    invoke.resolve(JSObject().put("items", items))
  }

  /** A picked folder's plain path when it is on the device's storage and
   *  the user allows access to all files (asked here the first time);
   *  else its URL, whose grant already holds for the whole process. */
  @Command
  fun beginAccess(invoke: Invoke) {
    val url = invoke.parseArgs(UrlArgs::class.java).url
    when {
      plainPath(url) == null || hasAllFiles() -> answerAccess(invoke)
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ->
        // Some builds (Go, TV) have no such screen: the URL, then.
        try {
          startActivityForResult(
            invoke,
            Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
              .setData(Uri.parse("package:${activity.packageName}")),
            "allFilesAnswered",
          )
        } catch (e: ActivityNotFoundException) {
          answerAccess(invoke)
        }
      else -> requestPermissionForAlias("storage", invoke, "storageAnswered")
    }
  }

  @ActivityCallback
  fun allFilesAnswered(invoke: Invoke, result: ActivityResult) = answerAccess(invoke)

  @PermissionCallback
  fun storageAnswered(invoke: Invoke) = answerAccess(invoke)

  private fun answerAccess(invoke: Invoke) {
    val url = invoke.parseArgs(UrlArgs::class.java).url
    // Writable too: before Android 11 a memory card's folder reads but won't
    // take a write, where its URL would.
    val path = plainPath(url)?.takeIf {
      hasAllFiles() && File(it).isDirectory && File(it).canWrite()
    }
    invoke.resolve(JSObject().put("path", path ?: url))
  }

  private fun hasAllFiles(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Environment.isExternalStorageManager()
    else getPermissionState("storage") == PermissionState.GRANTED

  /** A folder of the device's storage provider as a path: "primary:Notes"
   *  is the shared storage's Notes, "1A2B-3C4D:Notes" a card's. */
  private fun plainPath(url: String): String? {
    val uri = Uri.parse(url)
    if (uri.authority != "com.android.externalstorage.documents") return null
    val id = runCatching { DocumentsContract.getDocumentId(uri) }.getOrNull() ?: return null
    val volume = id.substringBefore(':')
    // A whole volume stays its URL: as a path it would open all of storage.
    val rel = id.substringAfter(':', "").ifEmpty { return null }
    val base = if (volume == "primary") Environment.getExternalStorageDirectory().path
    else "/storage/$volume"
    return "$base/$rel"
  }

  // ---- Share and touch

  /** The system share sheet for a document, by picked URL or app path. */
  @Command
  fun share(invoke: Invoke) {
    try {
      val path = invoke.parseArgs(ShareArgs::class.java).path
      val uri = if (path.startsWith("content://")) Uri.parse(path)
      else FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", copyToCache(File(path)))
      val send = Intent(Intent.ACTION_SEND)
        .setType("text/markdown")
        .putExtra(Intent.EXTRA_STREAM, uri)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      activity.startActivity(Intent.createChooser(send, null))
      invoke.resolve(JSObject().put("completed", true))
    } catch (e: Exception) {
      invoke.reject(e.message ?: "Can't share this file")
    }
  }

  /** The file provider hands out the cache folder only. */
  private fun copyToCache(file: File): File {
    val dir = File(activity.cacheDir, "share").apply { mkdirs() }
    return file.copyTo(File(dir, file.name), overwrite = true)
  }

  @Command
  fun haptic(invoke: Invoke) {
    activity.runOnUiThread {
      activity.window.decorView.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
      invoke.resolve()
    }
  }
}
