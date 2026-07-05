package expo.modules.backgroundupload

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BackgroundUploadModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("BackgroundUpload")

        AsyncFunction("startService") { title: String, desc: String ->
            val context = appContext.reactContext?.applicationContext
                ?: throw Exception("No application context")
            val intent = Intent(context, BackgroundUploadService::class.java).apply {
                putExtra("title", title)
                putExtra("desc", desc)
                putExtra("progress", -1)
                putExtra("max", 0)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            Unit
        }

        AsyncFunction("updateService") { title: String, desc: String, progress: Int, max: Int ->
            val context = appContext.reactContext?.applicationContext
                ?: throw Exception("No application context")
            if (!BackgroundUploadService.isRunning) return@AsyncFunction
            val intent = Intent(context, BackgroundUploadService::class.java).apply {
                putExtra("title", title)
                putExtra("desc", desc)
                putExtra("progress", progress)
                putExtra("max", max)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            Unit
        }

        AsyncFunction("stopService") {
            val context = appContext.reactContext?.applicationContext
                ?: throw Exception("No application context")
            val intent = Intent(context, BackgroundUploadService::class.java)
            context.stopService(intent)
            Unit
        }

        Function("isRunning") {
            BackgroundUploadService.isRunning
        }
    }
}
