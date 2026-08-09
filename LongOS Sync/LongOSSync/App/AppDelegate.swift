import BackgroundTasks
import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        guard let identifier = Bundle.main.object(
            forInfoDictionaryKey: "LONGOS_BACKGROUND_REFRESH_IDENTIFIER"
        ) as? String, !identifier.isEmpty else {
            return true
        }

        BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            guard let refreshTask = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            let work = Task { @MainActor in
                let success = await AppRuntime.shared.handleBackgroundRefresh()
                refreshTask.setTaskCompleted(success: success)
            }
            refreshTask.expirationHandler = {
                work.cancel()
            }
        }
        return true
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        Task { @MainActor in
            AppRuntime.shared.scheduleBackgroundRefresh()
        }
    }
}
