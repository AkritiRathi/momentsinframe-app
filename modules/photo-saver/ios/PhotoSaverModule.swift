import ExpoModulesCore
import Photos

public class PhotoSaverModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PhotoSaver")

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

          // Step 1: Save asset and add to album
          var assetIdentifier: String?
          PHPhotoLibrary.shared().performChanges({
            let creationRequest = PHAssetCreationRequest.forAsset()
            let options = PHAssetResourceCreationOptions()
            options.shouldMoveFile = false
            creationRequest.addResource(with: .photo, fileURL: url, options: options)
            if let placeholder = creationRequest.placeholderForCreatedAsset {
              assetIdentifier = placeholder.localIdentifier
              if let addRequest = PHAssetCollectionChangeRequest(for: collection) {
                addRequest.addAssets([placeholder] as NSArray)
              }
            }
          }) { success, error in
            guard success, let identifier = assetIdentifier else {
              promise.reject("ERR_SAVE_FAILED", error?.localizedDescription ?? "Failed to save photo")
              return
            }

            // Step 2: Update creation date on the saved asset
            guard let dateTaken = dateTaken else {
              promise.resolve(nil)
              return
            }

            let assets = PHAsset.fetchAssets(withLocalIdentifiers: [identifier], options: nil)
            guard let asset = assets.firstObject else {
              promise.resolve(nil)
              return
            }

            PHPhotoLibrary.shared().performChanges({
              let changeRequest = PHAssetChangeRequest(for: asset)
              changeRequest.creationDate = dateTaken
            }) { _, _ in
              promise.resolve(nil)
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
