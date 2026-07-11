import ExpoModulesCore
import Photos

public class PhotoSaverModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PhotoSaver")

    // Saves a file:// URI to the Photos library using the resource-based API,
    // which preserves the original JPEG bytes including all EXIF metadata.
    AsyncFunction("saveToPhotos") { (fileUri: String, promise: Promise) in
      guard let url = URL(string: fileUri) else {
        promise.reject("ERR_INVALID_URI", "Invalid file URI: \(fileUri)")
        return
      }

      PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
        guard status == .authorized || status == .limited else {
          promise.reject("ERR_NO_PERMISSION", "Photos permission not granted")
          return
        }

        PHPhotoLibrary.shared().performChanges({
          let request = PHAssetCreationRequest.forAsset()
          let options = PHAssetResourceCreationOptions()
          options.shouldMoveFile = false
          request.addResource(with: .photo, fileURL: url, options: options)
        }) { success, error in
          if success {
            promise.resolve(nil)
          } else {
            promise.reject("ERR_SAVE_FAILED", error?.localizedDescription ?? "Failed to save photo")
          }
        }
      }
    }
  }
}
