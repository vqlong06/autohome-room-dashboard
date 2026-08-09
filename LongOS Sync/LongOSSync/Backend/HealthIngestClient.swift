import Foundation

actor HealthIngestClient {
    private let configuration: AppConfiguration
    private let session: URLSession

    init(configuration: AppConfiguration, session: URLSession = .shared) {
        self.configuration = configuration
        self.session = session
    }

    func send(_ payload: HealthIngestRequest, accessToken: String) async throws -> HealthIngestAcknowledgement {
        let url = configuration.supabaseURL.appending(path: "functions/v1/health-ingest")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = try LongOSJSON.encoder().encode(payload)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue(configuration.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.cachePolicy = .reloadIgnoringLocalCacheData

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw IngestClientError.invalidResponse }
        switch http.statusCode {
        case 200:
            let acknowledgement = try LongOSJSON.decoder().decode(HealthIngestAcknowledgement.self, from: data)
            guard acknowledgement.requestId == payload.requestId,
                  acknowledgement.bucketCount == payload.buckets.count else {
                throw IngestClientError.invalidResponse
            }
            return acknowledgement
        case 401:
            throw IngestClientError.unauthorized
        case 409:
            throw IngestClientError.requestConflict
        case 408, 425, 429, 500...599:
            throw IngestClientError.retryable(statusCode: http.statusCode)
        default:
            throw IngestClientError.permanent(statusCode: http.statusCode)
        }
    }

    func deleteAllHealthData(accessToken: String) async throws {
        let url = configuration.supabaseURL.appending(path: "functions/v1/health-delete")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = Data("{}".utf8)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue(configuration.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw IngestClientError.invalidResponse }
        guard http.statusCode == 204 else {
            if http.statusCode == 401 { throw IngestClientError.unauthorized }
            if UploadRetryPolicy.shouldRetry(statusCode: http.statusCode) {
                throw IngestClientError.retryable(statusCode: http.statusCode)
            }
            throw IngestClientError.permanent(statusCode: http.statusCode)
        }
    }
}

enum IngestClientError: LocalizedError {
    case unauthorized
    case requestConflict
    case retryable(statusCode: Int)
    case permanent(statusCode: Int)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .unauthorized: "Phiên đăng nhập đã hết hạn."
        case .requestConflict: "Request đồng bộ bị xung đột và đã được giữ lại để kiểm tra."
        case .retryable: "Mạng hoặc backend tạm thời chưa sẵn sàng."
        case .permanent: "Backend từ chối request đồng bộ."
        case .invalidResponse: "ACK đồng bộ không hợp lệ."
        }
    }
}
