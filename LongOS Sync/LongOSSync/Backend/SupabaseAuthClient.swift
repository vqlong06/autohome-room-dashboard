import Foundation

actor SupabaseAuthClient {
    private let configuration: AppConfiguration
    private let session: URLSession

    init(configuration: AppConfiguration, session: URLSession = .shared) {
        self.configuration = configuration
        self.session = session
    }

    func signIn(email: String, password: String) async throws -> AuthSession {
        var components = URLComponents(
            url: configuration.supabaseURL.appending(path: "auth/v1/token"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [URLQueryItem(name: "grant_type", value: "password")]
        guard let url = components?.url else { throw AuthClientError.invalidConfiguration }

        let body = try JSONSerialization.data(withJSONObject: [
            "email": email.trimmingCharacters(in: .whitespacesAndNewlines),
            "password": password
        ])
        return try await requestSession(url: url, body: body)
    }

    func refresh(_ sessionValue: AuthSession) async throws -> AuthSession {
        var components = URLComponents(
            url: configuration.supabaseURL.appending(path: "auth/v1/token"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [URLQueryItem(name: "grant_type", value: "refresh_token")]
        guard let url = components?.url else { throw AuthClientError.invalidConfiguration }
        let body = try JSONSerialization.data(withJSONObject: ["refresh_token": sessionValue.refreshToken])
        return try await requestSession(url: url, body: body)
    }

    private func requestSession(url: URL, body: Data) async throws -> AuthSession {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(configuration.publishableKey, forHTTPHeaderField: "apikey")
        request.cachePolicy = .reloadIgnoringLocalCacheData

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AuthClientError.invalidResponse }
        guard http.statusCode == 200 else {
            if http.statusCode == 400 || http.statusCode == 401 {
                throw AuthClientError.invalidCredentials
            }
            throw AuthClientError.unavailable
        }

        let payload = try JSONDecoder().decode(AuthResponse.self, from: data)
        guard !payload.accessToken.isEmpty,
              !payload.refreshToken.isEmpty,
              !payload.user.id.isEmpty else {
            throw AuthClientError.invalidResponse
        }
        return AuthSession(
            accessToken: payload.accessToken,
            refreshToken: payload.refreshToken,
            expiresAt: .now.addingTimeInterval(TimeInterval(payload.expiresIn)),
            userID: payload.user.id,
            email: payload.user.email
        )
    }
}

private struct AuthResponse: Decodable {
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int
    let user: AuthUser

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
        case user
    }
}

private struct AuthUser: Decodable {
    let id: String
    let email: String?
}

enum AuthClientError: LocalizedError {
    case invalidConfiguration
    case invalidCredentials
    case invalidResponse
    case unavailable

    var errorDescription: String? {
        switch self {
        case .invalidConfiguration: "Cấu hình đăng nhập không hợp lệ."
        case .invalidCredentials: "Email hoặc mật khẩu không đúng."
        case .invalidResponse: "Phản hồi đăng nhập không hợp lệ."
        case .unavailable: "Dịch vụ đăng nhập đang tạm thời không khả dụng."
        }
    }
}
