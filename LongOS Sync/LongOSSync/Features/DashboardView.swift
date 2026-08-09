import SwiftUI

struct DashboardView: View {
    @ObservedObject var coordinator: StepSyncCoordinator
    @ObservedObject var consent: CloudSyncConsentStore
    let persistenceWarning: String?

    @State private var showsConsent = false
    @State private var showsPrivacy = false
    @State private var confirmsCloudDeletion = false

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    header

                    if let persistenceWarning {
                        NoticeCard(
                            icon: "externaldrive.badge.exclamationmark",
                            text: persistenceWarning,
                            color: .orange
                        )
                    }

                    stepsHero
                    healthSummary
                    healthAccessCard
                    cloudCard
                    syncCard
                    webDashboardCard

                    if let error = coordinator.lastErrorMessage {
                        NoticeCard(icon: "exclamationmark.triangle.fill", text: error, color: .orange)
                    }

                    privacyActions
                }
                .padding(20)
                .frame(maxWidth: 680)
                .frame(maxWidth: .infinity)
            }
            .background(LongOSBackground())
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Quyền riêng tư", systemImage: "hand.raised") {
                            showsPrivacy = true
                        }
                        Button("Đăng xuất", systemImage: "rectangle.portrait.and.arrow.right") {
                            coordinator.signOut()
                        }
                    } label: {
                        Image(systemName: "person.crop.circle")
                    }
                }
            }
            .sheet(isPresented: $showsConsent) {
                CloudConsentView(coordinator: coordinator, consent: consent)
            }
            .sheet(isPresented: $showsPrivacy) {
                PrivacyDetailView()
            }
            .alert("Xóa dữ liệu Health trên cloud?", isPresented: $confirmsCloudDeletion) {
                Button("Hủy", role: .cancel) {}
                Button("Xóa vĩnh viễn", role: .destructive) {
                    Task { await coordinator.deleteCloudHealthData() }
                }
            } message: {
                Text("Thao tác này xóa Steps, Active Energy và giấc ngủ của tài khoản khỏi Supabase, đồng thời tắt cloud sync. Dữ liệu gốc trong Apple Health không bị xóa.")
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("LONGOS / IPHONE")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.mint)
            Text("Chào Long")
                .font(.largeTitle.bold())
            Text(coordinator.signedInEmail)
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }

    private var stepsHero: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Bước chân hôm nay")
                        .font(.headline)
                    if let value = coordinator.todaySteps {
                        Text(value.formatted(.number.grouping(.automatic)))
                            .font(.system(size: 48, weight: .bold, design: .rounded))
                        Text("bước")
                            .foregroundStyle(.secondary)
                    } else {
                        Text("Chưa có dữ liệu")
                            .font(.title2.bold())
                        Text("LongOS không coi thiếu quyền hoặc chưa sync là 0.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Image(systemName: "figure.walk.circle.fill")
                    .font(.system(size: 42))
                    .foregroundStyle(.mint)
            }
        }
        .padding(20)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24))
    }

    private var healthSummary: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 14) {
                sleepCard
                energyCard
            }
            VStack(spacing: 14) {
                sleepCard
                energyCard
            }
        }
    }

    private var sleepCard: some View {
        healthMetricCard(
            icon: "bed.double.fill",
            title: "Giấc ngủ gần nhất",
            value: sleepDurationText,
            unit: coordinator.latestSleepMinutes == nil ? "chưa có dữ liệu" : "thời gian ngủ",
            detail: sleepWindowText
        )
    }

    private var energyCard: some View {
        healthMetricCard(
            icon: "flame.fill",
            title: "Năng lượng hôm nay",
            value: coordinator.todayActiveEnergyKcal?.formatted(.number.grouping(.automatic)) ?? "--",
            unit: "kcal hoạt động",
            detail: coordinator.todayActiveEnergyKcal == nil
                ? "LongOS không coi thiếu quyền hoặc chưa sync là 0."
                : "Active Energy Burned từ Apple Health."
        )
    }

    private var healthAccessCard: some View {
        StatusCard(
            icon: "heart.text.square",
            title: "Apple Health",
            detail: coordinator.healthRequestCompleted
                ? "Đã gửi yêu cầu đọc Steps, Active Energy và Sleep. Apple không tiết lộ trạng thái quyền đọc; dữ liệu trống không đồng nghĩa với 0."
                : "Chỉ xin quyền đọc Steps, Active Energy và Sleep. App không ghi dữ liệu vào HealthKit.",
            badge: coordinator.healthRequestCompleted ? "Đã yêu cầu" : "Chưa yêu cầu",
            badgeColor: coordinator.healthRequestCompleted ? .mint : .secondary
        ) {
            if !coordinator.healthRequestCompleted {
                Button("Cho phép đọc HealthKit") {
                    Task { await coordinator.requestHealthAccess() }
                }
                .buttonStyle(.borderedProminent)
                .tint(.mint)
                .disabled(!coordinator.healthDataAvailable || coordinator.isBusy)
            }
        }
    }

    private var cloudCard: some View {
        StatusCard(
            icon: "cloud",
            title: "Cloud sync riêng tư",
            detail: consent.isGranted
                ? "Bucket Steps, kcal hoạt động và bản tổng hợp giấc ngủ được gửi đến Supabase để dùng trong LongOS. Bạn có thể tắt bất cứ lúc nào."
                : "Mặc định tắt. HealthKit authorization không tự cho phép upload.",
            badge: consent.isGranted ? "Đang bật" : "Đang tắt",
            badgeColor: consent.isGranted ? .mint : .secondary
        ) {
            HStack {
                if consent.isGranted {
                    Button("Tắt upload", role: .destructive) {
                        coordinator.revokeCloudConsent()
                    }
                    .buttonStyle(.bordered)
                } else {
                    Button("Xem và bật consent") {
                        showsConsent = true
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.mint)
                }
            }
        }
    }

    private var syncCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Label("Đồng bộ", systemImage: "arrow.triangle.2.circlepath")
                    .font(.headline)
                Spacer()
                if coordinator.isBusy { ProgressView() }
            }
            Text(coordinator.statusMessage)
                .foregroundStyle(.secondary)

            HStack(spacing: 16) {
                metric(label: "Đang chờ", value: "\(coordinator.pendingUploadCount)")
                metric(
                    label: "Lần cuối",
                    value: coordinator.lastSuccessfulSyncAt?.formatted(
                        date: .abbreviated,
                        time: .shortened
                    ) ?? "Chưa có"
                )
            }

            Button {
                Task { await coordinator.synchronize(reason: .manual) }
            } label: {
                HStack {
                    Text(consent.isGranted ? "Đồng bộ ngay" : "Đọc HealthKit trên iPhone")
                        .fontWeight(.semibold)
                    Spacer()
                    Image(systemName: "arrow.clockwise")
                }
                .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .tint(.mint)
            .disabled(!coordinator.healthRequestCompleted || coordinator.isBusy)
        }
        .padding(18)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 20))
    }

    private var privacyActions: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button("Đọc chính sách dữ liệu", systemImage: "doc.text") {
                showsPrivacy = true
            }
            Button("Xóa toàn bộ dữ liệu Health trên cloud", systemImage: "trash", role: .destructive) {
                confirmsCloudDeletion = true
            }
            .disabled(coordinator.isBusy)
        }
        .font(.callout)
        .padding(.vertical, 8)
    }

    private var webDashboardCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("LongOS trên web", systemImage: "safari")
                .font(.headline)

            Text(webDashboardDetail)
                .font(.callout)
                .foregroundStyle(.secondary)

            Link(destination: coordinator.dashboardURL) {
                HStack {
                    Text("Mở dashboard LongOS")
                        .fontWeight(.semibold)
                    Spacer()
                    Image(systemName: "arrow.up.right.square")
                }
                .padding(.vertical, 6)
            }
            .buttonStyle(.bordered)
            .tint(.mint)

            Text("Safari sẽ yêu cầu đăng nhập riêng bằng cùng tài khoản. App không chuyển mật khẩu hoặc token sang website.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(18)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 20))
    }

    private var webDashboardDetail: String {
        if consent.isGranted, coordinator.lastSuccessfulSyncAt != nil {
            return "Xem Steps, kcal hoạt động và giấc ngủ đã đồng bộ cạnh dữ liệu ESP32."
        }
        if consent.isGranted {
            return "Hãy đồng bộ HealthKit ít nhất một lần để dữ liệu xuất hiện trên web."
        }
        return "Dashboard vẫn hiển thị dữ liệu phòng; bật cloud sync nếu muốn xem thêm dữ liệu HealthKit."
    }

    private var sleepDurationText: String {
        guard let minutes = coordinator.latestSleepMinutes else { return "--" }
        let hours = minutes / 60
        let remainder = minutes % 60
        if hours == 0 { return "\(remainder) phút" }
        if remainder == 0 { return "\(hours) giờ" }
        return "\(hours)g \(remainder)p"
    }

    private var sleepWindowText: String {
        guard let start = coordinator.latestSleepStart,
              let end = coordinator.latestSleepEnd else {
            return "LongOS không coi thiếu quyền hoặc chưa sync là 0."
        }
        return "Ngủ \(start.formatted(date: .omitted, time: .shortened)) – thức \(end.formatted(date: .omitted, time: .shortened))"
    }

    private func healthMetricCard(
        icon: String,
        title: String,
        value: String,
        unit: String,
        detail: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: icon)
                .font(.headline)
                .foregroundStyle(.mint)
            Text(value)
                .font(.system(size: 30, weight: .bold, design: .rounded))
                .foregroundStyle(.primary)
            Text(unit)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(detail)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(18)
        .frame(maxWidth: .infinity, minHeight: 178, alignment: .leading)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 20))
    }

    private func metric(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.callout.weight(.semibold))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct StatusCard<Actions: View>: View {
    let icon: String
    let title: String
    let detail: String
    let badge: String
    let badgeColor: Color
    let actions: Actions

    init(
        icon: String,
        title: String,
        detail: String,
        badge: String,
        badgeColor: Color,
        @ViewBuilder actions: () -> Actions
    ) {
        self.icon = icon
        self.title = title
        self.detail = detail
        self.badge = badge
        self.badgeColor = badgeColor
        self.actions = actions()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                Image(systemName: icon)
                    .font(.title2)
                    .foregroundStyle(.mint)
                VStack(alignment: .leading, spacing: 5) {
                    Text(title).font(.headline)
                    Text(detail)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Text(badge)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(badgeColor)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(badgeColor.opacity(0.13), in: Capsule())
            }
            actions
        }
        .padding(18)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 20))
    }
}

struct NoticeCard: View {
    let icon: String
    let text: String
    let color: Color

    var body: some View {
        Label(text, systemImage: icon)
            .font(.callout)
            .foregroundStyle(color)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 16))
    }
}

struct LongOSBackground: View {
    var body: some View {
        LinearGradient(
            colors: [Color.black, Color(red: 0.03, green: 0.12, blue: 0.11)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .ignoresSafeArea()
    }
}
