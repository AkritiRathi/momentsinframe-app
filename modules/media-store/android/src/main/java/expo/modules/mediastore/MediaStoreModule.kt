package expo.modules.mediastore

import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.OutputStream

class MediaStoreModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MediaStore")

    AsyncFunction("saveToDownloads") { sourcePath: String, filename: String, subfolder: String, mimeType: String, dateTakenMs: Double? ->
      val context = appContext.reactContext?.applicationContext
        ?: throw Exception("No application context")

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
          put(MediaStore.Downloads.DISPLAY_NAME, filename)
          put(MediaStore.Downloads.MIME_TYPE, mimeType)
          put(MediaStore.Downloads.RELATIVE_PATH, "Download/$subfolder/")
          put(MediaStore.Downloads.IS_PENDING, 1)
          if (dateTakenMs != null) {
            put(MediaStore.MediaColumns.DATE_TAKEN, dateTakenMs.toLong())
          }
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
          ?: throw Exception("Failed to create MediaStore entry")
        try {
          resolver.openOutputStream(uri)!!.use { os: OutputStream ->
            FileInputStream(sourcePath).use { fis -> fis.copyTo(os) }
          }
          values.clear()
          values.put(MediaStore.Downloads.IS_PENDING, 0)
          resolver.update(uri, values, null, null)
        } catch (e: Exception) {
          resolver.delete(uri, null, null)
          throw e
        }
        uri.toString()
      } else {
        val dir = File(
          Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
          subfolder
        )
        if (!dir.exists()) dir.mkdirs()
        val dest = File(dir, filename)
        FileInputStream(sourcePath).use { fis ->
          FileOutputStream(dest).use { fos -> fis.copyTo(fos) }
        }
        android.media.MediaScannerConnection.scanFile(
          context, arrayOf(dest.absolutePath), null, null
        )
        dest.absolutePath
      }
    }
  }
}
