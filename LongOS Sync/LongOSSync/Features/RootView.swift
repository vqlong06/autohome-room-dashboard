import SwiftUI

struct RootView: View {
    @EnvironmentObject private var runtime: AppRuntime

    var body: some View {
        Group {
            if let startupError = runtime.startupError {
                ConfigurationRequiredView(message: startupError)
            } else if let coordinator = runtime.coordinator {
                CoordinatorGate(
                    coordinator: coordinator,
                    persistenceWarning: runtime.persistenceWarning
                )
            } else {
                ProgressView("Đang mở LongOS Sync…")
            }
        }
        .preferredColorScheme(.dark)
    }
}

private struct CoordinatorGate: View {
    @ObservedObject var coordinator: StepSyncCoordinator
    let persistenceWarning: String?

    var body: some View {
        if coordinator.session == nil {
            SignInView(coordinator: coordinator)
        } else {
            DashboardView(
                coordinator: coordinator,
                consent: coordinator.cloudConsent,
                persistenceWarning: persistenceWarning
            )
        }
    }
}

private struct ConfigurationRequiredView: View {
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Image(systemName: "slider.horizontal.3")
                .font(.system(size: 42, weight: .semibold))
                .foregroundStyle(.mint)
            Text("Cần cấu hình một lần")
                .font(.largeTitle.bold())
            Text(message)
                .foregroundStyle(.secondary)
            Text("Sao chép `Config/Secrets.example.xcconfig` thành `Config/Secrets.xcconfig`, điền project host và publishable key rồi build lại.")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .padding(28)
        .frame(maxWidth: 520, alignment: .leading)
    }
}
