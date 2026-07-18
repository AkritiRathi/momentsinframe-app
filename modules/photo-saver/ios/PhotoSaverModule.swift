import ExpoModulesCore
import Photos
import ImageIO

public class PhotoSaverModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PhotoSaver")

    AsyncFunction("saveToPhotos") { (fileUri: String, dateTakenMs: Double, albumName: String, promise: Promise) in
      guard let url = URL(string: fileUri) else {
        promise.reject("ERR_INVALID_URI", "Invalid file URI: \(fileUri)")
        return
      }

      let dateTaken: Date? = dateTakenMs > 0 ? Date(timeIntervalSince1970: dateTakenMs / 1000.0) : nil

      PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
        guard status == .authorized || status == .limited else {
          promise.reject("ERR_NO_PERMISSION", "Photos permission not granted")
          return
        }

        let hasFullAccess = (status == .authorized)

        let saveUrl: URL
        if let dateTaken = dateTaken, let exifUrl = self.embedExifDate(sourceUrl: url, dateTaken: dateTaken) {
          saveUrl = exifUrl
        } else {
          saveUrl = url
        }

        let cleanup = { try? FileManager.default.removeItem(at: saveUrl) }

        if hasFullAccess {
          self.findOrCreateAlbum(named: albumName) { collection in
            guard let collection = collection else {
              cleanup()
              promise.reject("ERR_ALBUM_FAILED", "Could not find or create album '\(albumName)'")
              return
            }
            PHPhotoLibrary.shared().performChanges({
              if let creationRequest = PHAssetCreationRequest.creationRequestForAssetFromImage(atFileURL: saveUrl) {
                if let date = dateTaken { creationRequest.creationDate = date }
                if let placeholder = creationRequest.placeholderForCreatedAsset {
                  PHAssetCollectionChangeRequest(for: collection)?.addAssets([placeholder] as NSArray)
                }
              }
            }) { success, error in
              cleanup()
              if success {
                promise.resolve("ok")
              } else {
                promise.reject("ERR_SAVE_FAILED", error?.localizedDescription ?? "Failed to save photo")
              }
            }
          }
        } else {
          PHPhotoLibrary.shared().performChanges({
            if let creationRequest = PHAssetCreationRequest.creationRequestForAssetFromImage(atFileURL: saveUrl) {
              if let date = dateTaken { creationRequest.creationDate = date }
            }
          }) { success, error in
            cleanup()
            if success {
              promise.resolve("limited_access")
            } else {
              promise.reject("ERR_SAVE_FAILED", error?.localizedDescription ?? "Failed to save photo")
            }
          }
        }
      }
    }
  }

  private func embedExifDate(sourceUrl: URL, dateTaken: Date) -> URL? {
    guard let imageData = try? Data(contentsOf: sourceUrl),
          let source = CGImageSourceCreateWithData(imageData as CFData, nil),
          let uti = CGImageSourceGetType(source) else { return nil }

    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy:MM:dd HH:mm:ss"
    let dateString = formatter.string(from: dateTaken)

    var properties = (CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any]) ?? [:]

    var exifDict = (properties[kCGImagePropertyExifDictionary as String] as? [String: Any]) ?? [:]
    exifDict[kCGImagePropertyExifDateTimeOriginal as String] = dateString
    exifDict[kCGImagePropertyExifDateTimeDigitized as String] = dateString
    properties[kCGImagePropertyExifDictionary as String] = exifDict

    var tiffDict = (properties[kCGImagePropertyTIFFDictionary as String] as? [String: Any]) ?? [:]
    tiffDict[kCGImagePropertyTIFFDateTime as String] = dateString
    if tiffDict[kCGImagePropertyTIFFMake as String] == nil {
      tiffDict[kCGImagePropertyTIFFMake as String] = "Apple"
    }
    if tiffDict[kCGImagePropertyTIFFModel as String] == nil {
      tiffDict[kCGImagePropertyTIFFModel as String] = "iPhone"
    }
    properties[kCGImagePropertyTIFFDictionary as String] = tiffDict

    let tempUrl = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(UUID().uuidString + ".jpg")
    guard let destination = CGImageDestinationCreateWithURL(tempUrl as CFURL, uti, 1, nil) else { return nil }
    CGImageDestinationAddImageFromSource(destination, source, 0, properties as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { return nil }

    return tempUrl
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
