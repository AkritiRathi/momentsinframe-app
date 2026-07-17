import ExpoModulesCore
import Photos

public class PhotoSaverModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PhotoSaver")

    // Saves a file:// URI to the Photos library using the resource-based API,
    // which preserves the original JPEG bytes including all EXIF metadata.
    // Also sets the creation date and adds the photo to a named album.
    AsyncFunction("saveToPhotos") { (fileUri: String, dateTakenMs: Double, albumName: String, promise: Promise) in
      guard let url = URL(string: fileUri) else {
        promise.reject("ERR_INVALID_URI", "Invalid file URI: \(fileUri)")
        return
      }

      let dateTaken: Date? = dateTakenMs > 0 ? Date(timeIntervalSince1970: dateTakenMs / 1000.0) : nil

      PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
        guard status == .authorized || status == .limited else {
          promise.reject("ERR_NO_PERMISSION", "Photos permission not granted")
          return
        }

        self.findOrCreateAlbum(named: albumName) { collection in
          guard let collection = collection else {
            promise.reject("ERR_ALBUM_FAILED", "Could not find or create album '\(albumName)'")
            return
          }

          PHPhotoLibrary.shared().performChanges({
            let creationRequest = PHAssetCreationRequest.forAsset()
            let options = PHAssetResourceCreationOptions()
            options.shouldMoveFile = false
            creationRequest.addResource(with: .photo, fileURL: url, options: options)
            if let date = dateTaken {
              creationRequest.creationDate = date
            }
            if let placeholder = creationRequest.placeholderForCreatedAsset,
               let addRequest = PHAssetCollectionChangeRequest(for: collection) {
              addRequest.addAssets([placeholder] as NSArray)
            }
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

  private func findOrCreateAlbum(named title: String, completion: @escaping (PHAssetCollection?) -> Void) {
    let fetchOptions = PHFetchOptions()
    fetchOptions.predicate = NSPredicate(format: "title = %@", title)
    let existing = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: fetchOptions)

    if let collection = existing.firstObject {
      completion(collection)
      return
    }

    var placeholderIdentifier: String?
    PHPhotoLibrary.shared().performChanges({
      let request = PHAssetCollectionChangeRequest.creationRequestForAssetCollection(withTitle: title)
      placeholderIdentifier = request.placeholderForCreatedAssetCollection.localIdentifier
    }) { success, _ in
      guard success, let identifier = placeholderIdentifier else {
        completion(nil)
        return
      }
      let created = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [identifier], options: nil)
      completion(created.firstObject)
    }
  }
}
