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

public struct HealthDailyGoals: Equatable, Sendable {
    public let steps: Int
    public let activeEnergyKcal: Int
    public let sleepMinutes: Int

    public init(steps: Int = 10_000, activeEnergyKcal: Int = 500, sleepMinutes: Int = 480) {
        self.steps = min(max(steps, 1_000), 100_000)
        self.activeEnergyKcal = min(max(activeEnergyKcal, 50), 5_000)
        self.sleepMinutes = min(max(sleepMinutes, 180), 720)
    }
}

public struct HealthMetricProgress: Equatable, Sendable {
    public let value: Int?
    public let goal: Int
    public let percent: Int?

    public init(value: Int?, goal: Int) {
        self.value = value
        self.goal = goal
        percent = value.map { min(max(Int((Double($0) / Double(goal) * 100).rounded()), 0), 100) }
    }
}

public struct HealthDailySummary: Equatable, Sendable {
    public let score: Int?
    public let availableMetricCount: Int
    public let steps: HealthMetricProgress
    public let activeEnergy: HealthMetricProgress
    public let sleep: HealthMetricProgress
    public let title: String
    public let insight: String
}

public enum HealthDailySummaryBuilder {
    public static func make(
        steps: Int?,
        activeEnergyKcal: Int?,
        sleepMinutes: Int?,
        goals: HealthDailyGoals,
        localHour: Int
    ) -> HealthDailySummary {
        let stepsProgress = HealthMetricProgress(value: steps, goal: goals.steps)
        let energyProgress = HealthMetricProgress(value: activeEnergyKcal, goal: goals.activeEnergyKcal)
        let sleepProgress = HealthMetricProgress(value: sleepMinutes, goal: goals.sleepMinutes)
        let available = [stepsProgress.percent, energyProgress.percent, sleepProgress.percent].compactMap { $0 }
        let score = available.isEmpty ? nil : Int(
            (Double(available.reduce(0, +)) / Double(available.count)).rounded()
        )
        let copy = insight(
            score: score,
            steps: steps,
            sleepMinutes: sleepMinutes,
            goals: goals,
            localHour: localHour
        )
        return HealthDailySummary(
            score: score,
            availableMetricCount: available.count,
            steps: stepsProgress,
            activeEnergy: energyProgress,
            sleep: sleepProgress,
            title: copy.title,
            insight: copy.insight
        )
    }

    private static func insight(
        score: Int?,
        steps: Int?,
        sleepMinutes: Int?,
        goals: HealthDailyGoals,
        localHour: Int
    ) -> (title: String, insight: String) {
        guard let score else {
            return (
                "Đang chờ HealthKit",
                "Đồng bộ để LongOS tạo nhận xét từ dữ liệu sức khỏe của hôm nay."
            )
        }
        if score >= 85 {
            return (
                "Nhịp ngày rất tốt",
                "Vận động và nghỉ ngơi đang cân bằng. Tiếp tục duy trì nhịp hiện tại."
            )
        }
        if let sleepMinutes, sleepMinutes < goals.sleepMinutes * 3 / 4 {
            return (
                "Ưu tiên hồi phục",
                "Giấc ngủ đang thấp hơn mục tiêu. Hôm nay nên giảm cường độ và đi ngủ sớm hơn."
            )
        }
        if let steps, localHour >= 17, steps < goals.steps / 2 {
            return (
                "Còn thiếu vận động",
                "Một quãng đi bộ nhẹ tối nay sẽ giúp tiến gần mục tiêu mà không quá sức."
            )
        }
        return (
            "Đang đi đúng nhịp",
            "Các chỉ số hôm nay đang tiến triển ổn. LongOS sẽ cập nhật khi HealthKit có thêm dữ liệu."
        )
    }
}
