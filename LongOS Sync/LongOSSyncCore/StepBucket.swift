import Foundation

public struct StepBucket: Codable, Equatable, Sendable, Identifiable {
    public let id: String
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

    public init(
        id: String,
        metric: String = "steps",
        start: Date,
        end: Date,
        localDate: String,
        timezoneId: String,
        utcOffsetMinutes: Int,
        value: Int,
        unit: String = "count",
        algorithmVersion: Int = 1,
        sourceUpdatedAt: Date
    ) {
        self.id = id
        self.metric = metric
        self.start = start
        self.end = end
        self.localDate = localDate
        self.timezoneId = timezoneId
        self.utcOffsetMinutes = utcOffsetMinutes
        self.value = value
        self.unit = unit
        self.algorithmVersion = algorithmVersion
        self.sourceUpdatedAt = sourceUpdatedAt
    }
}

public enum StepBucketIdentity {
    public static func make(
        ownerID: String,
        start: Date,
        end: Date,
        algorithmVersion: Int
    ) -> String {
        [
            "steps",
            ownerID.lowercased(),
            iso8601String(start),
            iso8601String(end),
            String(algorithmVersion)
        ].joined(separator: "|")
    }

    private static func iso8601String(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}
