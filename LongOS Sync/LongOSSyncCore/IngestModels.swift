import Foundation

public struct HealthIngestRequest: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let requestId: UUID
    public let installationId: UUID
    public let buckets: [StepBucketPayload]

    public init(
        schemaVersion: Int = 1,
        requestId: UUID,
        installationId: UUID,
        buckets: [StepBucketPayload]
    ) {
        self.schemaVersion = schemaVersion
        self.requestId = requestId
        self.installationId = installationId
        self.buckets = buckets
    }
}

public struct StepBucketPayload: Codable, Equatable, Sendable {
    public let metric: String
    public let start: Date
    public let end: Date
    public let localDate: String
    public let timezoneId: String
    public let utcOffsetMinutes: Int
    public let value: Int
    public let unit: String
    public let algorithmVersion: Int
    public let sourceUpdatedAt: Date

    public init(bucket: StepBucket) {
        metric = bucket.metric
        start = bucket.start
        end = bucket.end
        localDate = bucket.localDate
        timezoneId = bucket.timezoneId
        utcOffsetMinutes = bucket.utcOffsetMinutes
        value = bucket.value
        unit = bucket.unit
        algorithmVersion = bucket.algorithmVersion
        sourceUpdatedAt = bucket.sourceUpdatedAt
    }
}

public struct HealthIngestAcknowledgement: Codable, Equatable, Sendable {
    public let requestId: UUID
    public let acknowledgedAt: Date
    public let bucketCount: Int
    public let replayed: Bool
}

public enum LongOSJSON {
    public static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }

    public static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = fractional.date(from: value) {
                return date
            }
            let standard = ISO8601DateFormatter()
            standard.formatOptions = [.withInternetDateTime]
            if let date = standard.date(from: value) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Expected an ISO-8601 timestamp."
            )
        }
        return decoder
    }
}
