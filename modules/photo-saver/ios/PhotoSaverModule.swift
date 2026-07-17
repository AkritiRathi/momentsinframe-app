import ExpoModulesCore
import Photos
import ImageIO
import MobileCoreServices

public class PhotoSaverModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PhotoSaver")

    AsyncFunction("saveToPhotos") { (fileUri: String, dateTakenMs: Double, albumName: String, promise: Promise) in
      guard let url = URL(string: fileUri) else {
        promise.reject("ERR_INVALID_URI", "Invalid file URI: \(fileUri)")
        return
      }

      let dateTaken: Date? = dateTakenMs > 0 ? Date(timeIntervalSince1970: dateTakenMs / 1000.0) : nil

      // Stamp the correct date into the JPEG EXIF bytes so iOS Photos reads it from the file
      let saveUrl: URL
      if let date = dateTaken, let stamped = self.stampExifDate(sourceUrl: url, date: date) {
        saveUrl = stamped
      } else {
        saveUrl = url
      }

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
            creationRequest.addResource(with: .photo, fileURL: saveUrl, options: options)
            if let date = dateTaken {
              creationRequest.creationDate = date
            }
            if let placeholder = creationRequest.placeholderForCreatedAsset,
               let addRequest = PHAssetCollectionChangeRequest(for: collection) {
              addRequest.addAssets([placeholder] as NSArray)
            }
          }) { success, error in
            // Clean up temp stamped file if we created one
            if saveUrl != url {
              try? FileManager.default.removeItem(at: saveUrl)
            }
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

  // Writes the correct date into EXIF DateTimeOriginal / DateTimeDigitized / DateTime
  // Returns a new temp file URL, or nil if stamping failed (caller falls back to original)
  private func stampExifDate(sourceUrl: URL, date: Date) -> URL? {
    guard let source = CGImageSourceCreateWithURL(sourceUrl as CFURL, nil),
          let uti = CGImageSourceGetType(source) else { return nil }

    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy:MM:dd HH:mm:ss"
    formatter.timeZone = TimeZone.current
    let exifDateString = formatter.string(from: date)

    var metadata = (CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any]) ?? [:]

    // TIFF DateTime
    var tiff = (metadata[kCGImagePropertyTIFFDictionary as String] as? [String: Any]) ?? [:]
    tiff[kCGImagePropertyTIFFDateTime as String] = exifDateString
    metadata[kCGImagePropertyTIFFDictionary as String] = tiff

    // EXIF DateTimeOriginal + DateTimeDigitized
    var exif = (metadata[kCGImagePropertyExifDictionary as String] as? [String: Any]) ?? [:]
    exif[kCGImagePropertyExifDateTimeOriginal as String] = exifDateString
    exif[kCGImagePropertyExifDateTimeDigitized as String] = exifDateString
    metadata[kCGImagePropertyExifDictionary as String] = exif

    let tempUrl = sourceUrl.deletingLastPathComponent()
      .appendingPathComponent("stamped_\(sourceUrl.lastPathComponent)")

    guard let destination = CGImageDestinationCreateWithURL(tempUrl as CFURL, uti, 1, nil) else { return nil }
    CGImageDestinationAddImageFromSource(destination, source, 0, metadata as CFDictionary)
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
