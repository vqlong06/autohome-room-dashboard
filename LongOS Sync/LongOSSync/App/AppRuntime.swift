import BackgroundTasks
import Combine
import Foundation
import SwiftData

@MainActor
final class AppRuntime: ObservableObject {
    static let shared = AppRuntime()

    let modelContainer: ModelContainer
    @Published private(set) var coordinator: StepSyncCoordinator?
    @Published private(set) var startupError: String?
    @Published private(set) var persistenceWarning: String?

    private var configuration: AppConfiguration?

    private init() {
        let schema = Schema([
            PendingStepUpload.self,
            SyncedStepBucket.self,
            MetricSyncState.self
        ])

        do {
            let diskConfiguration = ModelConfiguration("LongOSSync", schema: schema)
            modelContainer = try ModelContainer(for: schema, configurations: [diskConfiguration])
        } catch {
            let memoryConfiguration = ModelConfiguration("LongOSSyncFallback", schema: schema, isStoredInMemoryOnly: true)
            modelContainer = try! ModelContainer(for: schema, configurations: [memoryConfiguration])
            persistenceWarning = "Không mở được bộ nhớ bền vững; app đang dùng hàng đợi tạm thời."
        }

        do {
            let loaded = try AppConfiguration.load()
            configuration = loaded
            coordinator = try StepSyncCoordinator(
                modelContext: modelContainer.mainContext,
                configuration: loaded
            )
        } catch {
            startupError = (error as? LocalizedError)?.errorDescription ?? "Không khởi tạo được LongOS Sync."
        }
    }

    var backgroundRefreshIdentifier: String? {
        configuration?.backgroundRefreshIdentifier
    }

    func bootstrap() async {
        await coordinator?.bootstrap()
    }

    func handleForeground() async {
        await coordinator?.synchronize(reason: .foreground)
    }

    func handleBackgroundRefresh() async -> Bool {
        guard let coordinator else { return false }
        await coordinator.synchronize(reason: .backgroundRefresh)
        scheduleBackgroundRefresh()
        return coordinator.lastErrorMessage == nil
    }

    func scheduleBackgroundRefresh() {
        guard let identifier = backgroundRefreshIdentifier else { return }
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = .now.addingTimeInterval(60 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
}
