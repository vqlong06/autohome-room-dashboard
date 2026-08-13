import SwiftUI

struct CloudConsentView: View {
    @ObservedObject var coordinator: StepSyncCoordinator
    @ObservedObject var consent: CloudSyncConsentStore
    @Environment(\.dismiss) private var dismiss
    @State private var understood = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Image(systemName: "cloud.badge.checkmark")
                        .font(.system(size: 42))
                        .foregroundStyle(.mint)
                    Text("Cho phép đồng bộ cloud")
                        .font(.largeTitle.bold())
                    Text("Đây là consent riêng, không phải quyền HealthKit.")
                        .font(.title3)
                        .foregroundStyle(.secondary)

                    disclosureRow(
                        icon: "figure.walk",
                        title: "Dữ liệu",
                        text: "Steps và Active Energy theo giờ; Sleep/REM/Deep, HRV SDNN và nhịp tim nghỉ dạng tổng hợp ngày; mỗi Workout chỉ có giờ bắt đầu, kết thúc và thời lượng. Không gửi raw heart-rate stream, raw sleep stages hoặc GPS."
                    )
                    disclosureRow(
                        icon: "server.rack",
                        title: "Đích đến",
                        text: "Supabase của LongOS, trong bảng authenticated có RLS."
                    )
                    disclosureRow(
                        icon: "sparkles",
                        title: "Mục đích",
                        text: "Hiển thị hoạt động và hồi phục cá nhân, đồng thời đối chiếu theo thời gian với không gian sống. Không dùng quảng cáo hoặc chẩn đoán y tế."
                    )
                    disclosureRow(
                        icon: "trash",
                        title: "Kiểm soát",
                        text: "Bạn có thể tắt upload hoặc xóa toàn bộ dữ liệu Health cloud trong app. Thu hồi HealthKit không tự xóa cloud."
                    )

                    Toggle("Tôi đã đọc và đồng ý upload dữ liệu trên", isOn: $understood)
                        .toggleStyle(.switch)
                        .padding(.vertical, 6)

                    Button {
                        Task {
                            await coordinator.grantCloudConsentAndSync()
                            dismiss()
                        }
                    } label: {
                        HStack {
                            Text("Bật cloud sync")
                                .fontWeight(.semibold)
                            Spacer()
                            Image(systemName: "checkmark")
                        }
                        .padding(.vertical, 7)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.mint)
                    .disabled(!understood || coordinator.isBusy || consent.isGranted)
                }
                .padding(22)
                .frame(maxWidth: 620)
                .frame(maxWidth: .infinity)
            }
            .background(LongOSBackground())
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Đóng") { dismiss() }
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func disclosureRow(icon: String, title: String, text: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .foregroundStyle(.mint)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(text)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
