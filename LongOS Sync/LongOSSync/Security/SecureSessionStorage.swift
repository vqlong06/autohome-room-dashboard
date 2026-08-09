import Foundation
import Security

struct AuthSession: Codable, Equatable, Sendable {
    let accessToken: String
    let refreshToken: String
    let expiresAt: Date
    let userID: String
    let email: String?

    var needsRefresh: Bool {
        expiresAt.timeIntervalSinceNow < 90
    }
}

final class SecureSessionStorage: @unchecked Sendable {
    private let service: String

    init(service: String) {
        self.service = service
    }

    func loadSession() throws -> AuthSession? {
        guard let data = try read(account: "supabase-session-v1") else { return nil }
        return try JSONDecoder().decode(AuthSession.self, from: data)
    }

    func save(session: AuthSession) throws {
        try write(JSONEncoder().encode(session), account: "supabase-session-v1")
    }

    func clearSession() throws {
        try delete(account: "supabase-session-v1")
    }

    func installationID() throws -> UUID {
        if let data = try read(account: "installation-id-v1"),
           let raw = String(data: data, encoding: .utf8),
           let existing = UUID(uuidString: raw) {
            return existing
        }

        let created = UUID()
        try write(Data(created.uuidString.utf8), account: "installation-id-v1")
        return created
    }

    private func read(account: String) throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw KeychainError(status: status)
        }
        return data
    }

    private func write(_ data: Data, account: String) throws {
        let lookup: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]

        let updateStatus = SecItemUpdate(lookup as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw KeychainError(status: updateStatus)
        }

        var insert = lookup
        insert.merge(attributes) { _, new in new }
        let addStatus = SecItemAdd(insert as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw KeychainError(status: addStatus)
        }
    }

    private func delete(account: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError(status: status)
        }
    }
}

struct KeychainError: LocalizedError {
    let status: OSStatus

    var errorDescription: String? {
        "Không thể truy cập Keychain (mã \(status))."
    }
}
