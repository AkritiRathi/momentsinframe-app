import ExpoModulesCore
import UIKit

public class BackgroundUploadModule: Module {
  private var backgroundTaskId: UIBackgroundTaskIdentifier = .invalid

  public func definition() -> ModuleDefinition {
    Name("BackgroundUpload")

    Function("startService") { (title: String, desc: String) in
      DispatchQueue.main.async {
        self.backgroundTaskId = UIApplication.shared.beginBackgroundTask(withName: "MIFUpload") {
          UIApplication.shared.endBackgroundTask(self.backgroundTaskId)
          self.backgroundTaskId = .invalid
        }
      }
    }

    Function("updateService") { (title: String, desc: String, progress: Int, max: Int) in
      // iOS background tasks don't support persistent notifications mid-task
    }

    Function("stopService") {
      DispatchQueue.main.async {
        if self.backgroundTaskId != .invalid {
          UIApplication.shared.endBackgroundTask(self.backgroundTaskId)
          self.backgroundTaskId = .invalid
        }
      }
    }

    Function("isRunning") { () -> Bool in
      return self.backgroundTaskId != .invalid
    }
  }
}
