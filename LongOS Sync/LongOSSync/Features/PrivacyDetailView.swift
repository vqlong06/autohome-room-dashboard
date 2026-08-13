import SwiftUI

struct PrivacyDetailView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Quyền riêng tư")
                        .font(.largeTitle.bold())
                    Text("LongOS Sync là công cụ wellness cá nhân, không phải thiết bị y tế và không đưa ra chẩn đoán.")
                    section(
                        "LongOS Sync thu thập gì?",
                        "Steps và Active Energy theo bucket giờ; Sleep/REM/Deep, HRV SDNN và nhịp tim nghỉ dạng tổng hợp ngày; Workout chỉ có mốc bắt đầu, kết thúc và thời lượng. Không upload raw heart-rate stream, raw sleep stages, tuyến đường GPS, ECG, thuốc hoặc clinical records."
                    )
                    section(
                        "Consent",
                        "Quyền đọc HealthKit và đồng ý upload Supabase là hai lựa chọn độc lập. Cloud sync mặc định tắt."
                    )
                    section(
                        "Bảo mật",
                        "Token nằm trong Keychain; hàng đợi local dùng iOS Data Protection; Health tables không cho anonymous access và app không chứa service credential."
                    )
                    section(
                        "Xóa dữ liệu",
                        "Bạn có thể xóa dữ liệu Health trên cloud ngay trong app. Thao tác đó không xóa dữ liệu gốc trong Apple Health."
                    )
                    Text("Trước khi phân phối production, LongOS cần công bố retention cụ thể và URL privacy policy công khai.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding(22)
                .frame(maxWidth: 620)
                .frame(maxWidth: .infinity)
            }
            .background(LongOSBackground())
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Xong") { dismiss() }
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func section(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.headline)
            Text(text).foregroundStyle(.secondary)
        }
    }
}
