import SwiftData
import SwiftUI

@main
@MainActor
struct LongOSSyncApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var runtime = AppRuntime.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(runtime)
                .task { await runtime.bootstrap() }
                .onChange(of: scenePhase) { _, phase in
                    switch phase {
                    case .active:
                        Task { await runtime.handleForeground() }
                    case .background:
                        runtime.scheduleBackgroundRefresh()
                    default:
                        break
                    }
                }
        }
        .modelContainer(runtime.modelContainer)
    }
}
