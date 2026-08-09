import SwiftUI

struct SignInView: View {
    @ObservedObject var coordinator: StepSyncCoordinator
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("LongOS")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.mint)
                            .textCase(.uppercase)
                        Text("Sync")
                            .font(.system(size: 52, weight: .bold, design: .rounded))
                        Text("Đưa dữ liệu hoạt động của bạn vào LongOS theo cách riêng tư và có kiểm soát.")
                            .font(.title3)
                            .foregroundStyle(.secondary)
                    }

                    VStack(spacing: 14) {
                        TextField("Email Supabase", text: $email)
                            .textContentType(.username)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .padding(14)
                            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))

                        SecureField("Mật khẩu", text: $password)
                            .textContentType(.password)
                            .padding(14)
                            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))

                        Button {
                            Task { await coordinator.signIn(email: email, password: password) }
                        } label: {
                            HStack {
                                if coordinator.isBusy { ProgressView() }
                                Text(coordinator.isBusy ? "Đang đăng nhập…" : "Đăng nhập")
                                    .fontWeight(.semibold)
                                Spacer()
                                Image(systemName: "arrow.right")
                            }
                            .padding(16)
                            .foregroundStyle(.black)
                            .background(.mint, in: RoundedRectangle(cornerRadius: 15))
                        }
                        .disabled(email.isEmpty || password.isEmpty || coordinator.isBusy)
                    }

                    if let error = coordinator.lastErrorMessage {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.callout)
                            .foregroundStyle(.orange)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Label("Không có quyền Health nào được xin trước khi đăng nhập.", systemImage: "lock.shield")
                        Label("HealthKit và upload Supabase là hai consent riêng.", systemImage: "hand.raised")
                        Label("M1 chỉ dùng Steps đã tổng hợp, không dùng raw samples.", systemImage: "figure.walk")
                    }
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
                .padding(24)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
            .background(LongOSBackground())
        }
    }
}
