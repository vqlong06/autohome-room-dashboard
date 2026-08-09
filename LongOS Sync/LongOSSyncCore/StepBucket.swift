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
        metric: String = "steps",
        ownerID: String,
        start: Date,
        end: Date,
        algorithmVersion: Int
    ) -> String {
        [
            metric,
            ownerID.lowercased(),
            iso8601String(start),
            iso8601String(end),
            String(algorithmVersion)
        ].joined(separator: "|")
    }

    public static func makeDaily(
        metric: String,
        ownerID: String,
        localDate: String,
        algorithmVersion: Int
    ) -> String {
        [
            metric,
            ownerID.lowercased(),
            localDate,
            String(algorithmVersion)
        ].joined(separator: "|")
    }

    private static func iso8601String(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}

public struct SleepEpisodeSummary: Equatable, Sendable {
    public let start: Date
    public var end: Date
    public var asleepSeconds: TimeInterval

    public init(start: Date, end: Date, asleepSeconds: TimeInterval) {
        self.start = start
        self.end = end
        self.asleepSeconds = asleepSeconds
    }
}

public enum SleepSummaryBuilder {
    public static func merge(
        intervals: [DateInterval],
        maximumWakeGap: TimeInterval = 90 * 60
    ) -> [SleepEpisodeSummary] {
        let sorted = intervals
            .filter { $0.duration > 0 }
            .sorted { $0.start < $1.start }
        var episodes: [SleepEpisodeSummary] = []

        for interval in sorted {
            guard var current = episodes.last else {
                episodes.append(SleepEpisodeSummary(
                    start: interval.start,
                    end: interval.end,
                    asleepSeconds: interval.duration
                ))
                continue
            }
            guard interval.start <= current.end.addingTimeInterval(maximumWakeGap) else {
                episodes.append(SleepEpisodeSummary(
                    start: interval.start,
                    end: interval.end,
                    asleepSeconds: interval.duration
                ))
                continue
            }

            let uncoveredStart = max(current.end, interval.start)
            current.asleepSeconds += max(0, interval.end.timeIntervalSince(uncoveredStart))
            current.end = max(current.end, interval.end)
            episodes[episodes.count - 1] = current
        }
        return episodes
    }
}
