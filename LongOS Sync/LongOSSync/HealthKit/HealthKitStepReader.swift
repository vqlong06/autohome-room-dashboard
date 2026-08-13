import Foundation
import HealthKit

final class HealthKitStepReader: @unchecked Sendable {
    private let store = HKHealthStore()
    private var observerQueries: [HKObserverQuery] = []

    var isAvailable: Bool {
        HKHealthStore.isHealthDataAvailable()
    }

    func requestHealthAuthorization() async throws {
        guard isAvailable else { throw HealthKitStepError.unavailable }
        let types = try healthTypes()
        let readTypes: Set<HKObjectType> = [
            types.steps,
            types.activeEnergy,
            types.sleep,
            types.hrvSDNN,
            types.restingHeartRate,
            types.workout
        ]
        try await store.requestAuthorization(toShare: [], read: readTypes)
    }

    func fetchMetricBuckets(ownerID: String, days: Int) async throws -> [StepBucket] {
        guard isAvailable else { throw HealthKitStepError.unavailable }
        let types = try healthTypes()
        let context = try dateContext(days: days)
        let steps = try await fetchHourlyQuantityBuckets(
            ownerID: ownerID,
            type: types.steps,
            metric: "steps",
            unitName: "count",
            healthUnit: .count(),
            context: context
        )
        let energy = try await fetchHourlyQuantityBuckets(
            ownerID: ownerID,
            type: types.activeEnergy,
            metric: "active_energy",
            unitName: "kcal",
            healthUnit: .kilocalorie(),
            context: context
        )
        let sleep = try await fetchDailySleepBuckets(
            ownerID: ownerID,
            type: types.sleep,
            context: context
        )
        let hrv = try await fetchDailyAverageQuantityBuckets(
            ownerID: ownerID,
            type: types.hrvSDNN,
            metric: "hrv_sdnn",
            unitName: "ms",
            healthUnit: HKUnit.secondUnit(with: .milli),
            context: context
        )
        let restingHeartRate = try await fetchDailyAverageQuantityBuckets(
            ownerID: ownerID,
            type: types.restingHeartRate,
            metric: "resting_heart_rate",
            unitName: "bpm",
            healthUnit: HKUnit(from: "count/min"),
            context: context
        )
        let workouts = try await fetchWorkoutBuckets(
            ownerID: ownerID,
            type: types.workout,
            context: context
        )
        return steps + energy + sleep + hrv + restingHeartRate + workouts
    }

    func startObserver(onChange: @escaping @Sendable () async -> Void) async throws {
        let types = try healthTypes()
        let sampleTypes: [HKSampleType] = [
            types.steps,
            types.activeEnergy,
            types.sleep,
            types.hrvSDNN,
            types.restingHeartRate,
            types.workout
        ]

        if observerQueries.isEmpty {
            for sampleType in sampleTypes {
                let query = HKObserverQuery(sampleType: sampleType, predicate: nil) { _, completion, error in
                    let completionBox = HealthObserverCompletion(completion)
                    Task {
                        defer { completionBox.call() }
                        guard error == nil else { return }
                        await onChange()
                    }
                }
                observerQueries.append(query)
                store.execute(query)
            }
        }

        for sampleType in sampleTypes {
            try await enableBackgroundDelivery(for: sampleType)
        }
    }

    func stopObserver() {
        observerQueries.forEach(store.stop)
        observerQueries.removeAll()
    }

    private func healthTypes() throws -> HealthTypes {
        guard let steps = HKObjectType.quantityType(forIdentifier: .stepCount),
              let activeEnergy = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned),
              let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis),
              let hrvSDNN = HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN),
              let restingHeartRate = HKObjectType.quantityType(forIdentifier: .restingHeartRate) else {
            throw HealthKitStepError.unavailable
        }
        return HealthTypes(
            steps: steps,
            activeEnergy: activeEnergy,
            sleep: sleep,
            hrvSDNN: hrvSDNN,
            restingHeartRate: restingHeartRate,
            workout: HKObjectType.workoutType()
        )
    }

    private func dateContext(days: Int) throws -> HealthDateContext {
        let timezone = TimeZone.current
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: "en_US_POSIX")
        calendar.timeZone = timezone
        let end = Date.now
        let today = calendar.startOfDay(for: end)
        guard let start = calendar.date(byAdding: .day, value: -max(0, days - 1), to: today) else {
            throw HealthKitStepError.invalidDateRange
        }
        return HealthDateContext(calendar: calendar, timezone: timezone, start: start, end: end, today: today)
    }

    private func fetchHourlyQuantityBuckets(
        ownerID: String,
        type: HKQuantityType,
        metric: String,
        unitName: String,
        healthUnit: HKUnit,
        context: HealthDateContext
    ) async throws -> [StepBucket] {
        let predicate = HKQuery.predicateForSamples(
            withStart: context.start,
            end: context.end,
            options: .strictStartDate
        )
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsCollectionQuery(
                quantityType: type,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum,
                anchorDate: context.today,
                intervalComponents: DateComponents(hour: 1)
            )
            query.initialResultsHandler = { _, collection, error in
                if error != nil {
                    continuation.resume(throwing: HealthKitStepError.queryFailed)
                    return
                }
                guard let collection else {
                    continuation.resume(returning: [])
                    return
                }

                let formatter = Self.localDateFormatter(calendar: context.calendar, timezone: context.timezone)
                let observedAt = Date.now
                var output: [StepBucket] = []
                collection.enumerateStatistics(from: context.start, to: context.end) { statistics, _ in
                    guard let quantity = statistics.sumQuantity() else { return }
                    let value = Int(quantity.doubleValue(for: healthUnit).rounded())
                    let id = StepBucketIdentity.make(
                        metric: metric,
                        ownerID: ownerID,
                        start: statistics.startDate,
                        end: statistics.endDate,
                        algorithmVersion: 1
                    )
                    output.append(StepBucket(
                        id: id,
                        metric: metric,
                        start: statistics.startDate,
                        end: statistics.endDate,
                        localDate: formatter.string(from: statistics.startDate),
                        timezoneId: context.timezone.identifier,
                        utcOffsetMinutes: context.timezone.secondsFromGMT(for: statistics.startDate) / 60,
                        value: max(0, value),
                        unit: unitName,
                        sourceUpdatedAt: observedAt
                    ))
                }
                continuation.resume(returning: output)
            }
            store.execute(query)
        }
    }

    private func fetchDailyAverageQuantityBuckets(
        ownerID: String,
        type: HKQuantityType,
        metric: String,
        unitName: String,
        healthUnit: HKUnit,
        context: HealthDateContext
    ) async throws -> [StepBucket] {
        let predicate = HKQuery.predicateForSamples(
            withStart: context.start,
            end: context.end,
            options: .strictStartDate
        )
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsCollectionQuery(
                quantityType: type,
                quantitySamplePredicate: predicate,
                options: .discreteAverage,
                anchorDate: context.today,
                intervalComponents: DateComponents(day: 1)
            )
            query.initialResultsHandler = { _, collection, error in
                if error != nil {
                    continuation.resume(throwing: HealthKitStepError.queryFailed)
                    return
                }
                guard let collection else {
                    continuation.resume(returning: [])
                    return
                }

                let formatter = Self.localDateFormatter(calendar: context.calendar, timezone: context.timezone)
                let observedAt = Date.now
                var output: [StepBucket] = []
                collection.enumerateStatistics(from: context.start, to: context.end) { statistics, _ in
                    guard let quantity = statistics.averageQuantity() else { return }
                    let value = Int(quantity.doubleValue(for: healthUnit).rounded())
                    let start = max(statistics.startDate, context.start)
                    let end = min(statistics.endDate, context.end)
                    guard value > 0, end > start else { return }
                    let localDate = formatter.string(from: start)
                    output.append(StepBucket(
                        id: StepBucketIdentity.makeDaily(
                            metric: metric,
                            ownerID: ownerID,
                            localDate: localDate,
                            algorithmVersion: 1
                        ),
                        metric: metric,
                        start: start,
                        end: end,
                        localDate: localDate,
                        timezoneId: context.timezone.identifier,
                        utcOffsetMinutes: context.timezone.secondsFromGMT(for: start) / 60,
                        value: value,
                        unit: unitName,
                        sourceUpdatedAt: observedAt
                    ))
                }
                continuation.resume(returning: output)
            }
            store.execute(query)
        }
    }

    private func fetchDailySleepBuckets(
        ownerID: String,
        type: HKCategoryType,
        context: HealthDateContext
    ) async throws -> [StepBucket] {
        guard let queryStart = context.calendar.date(byAdding: .day, value: -1, to: context.start) else {
            throw HealthKitStepError.invalidDateRange
        }
        let predicate = HKQuery.predicateForSamples(withStart: queryStart, end: context.end, options: [])
        let samples: [HKCategorySample] = try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: type,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
            ) { _, results, error in
                if error != nil {
                    continuation.resume(throwing: HealthKitStepError.queryFailed)
                    return
                }
                continuation.resume(returning: results as? [HKCategorySample] ?? [])
            }
            store.execute(query)
        }

        let asleepValues: Set<Int> = [
            HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
            HKCategoryValueSleepAnalysis.asleepCore.rawValue,
            HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
            HKCategoryValueSleepAnalysis.asleepREM.rawValue
        ]
        let intervals = samples.compactMap { sample -> DateInterval? in
            guard asleepValues.contains(sample.value) else { return nil }
            let start = max(sample.startDate, context.start)
            let end = min(sample.endDate, context.end)
            guard end > start else { return nil }
            return DateInterval(start: start, end: end)
        }
        let episodes = SleepSummaryBuilder.merge(intervals: intervals)
        let formatter = Self.localDateFormatter(calendar: context.calendar, timezone: context.timezone)
        var longestByWakeDate: [String: SleepEpisodeSummary] = [:]
        for episode in episodes where episode.asleepSeconds >= 30 * 60 && episode.end.timeIntervalSince(episode.start) <= 24 * 60 * 60 {
            let wakeDate = formatter.string(from: episode.end.addingTimeInterval(-1))
            if longestByWakeDate[wakeDate].map({ $0.asleepSeconds < episode.asleepSeconds }) ?? true {
                longestByWakeDate[wakeDate] = episode
            }
        }

        let remIntervals = samples.compactMap { sample -> DateInterval? in
            guard sample.value == HKCategoryValueSleepAnalysis.asleepREM.rawValue else { return nil }
            return DateInterval(start: sample.startDate, end: sample.endDate)
        }
        let deepIntervals = samples.compactMap { sample -> DateInterval? in
            guard sample.value == HKCategoryValueSleepAnalysis.asleepDeep.rawValue else { return nil }
            return DateInterval(start: sample.startDate, end: sample.endDate)
        }

        let observedAt = Date.now
        return longestByWakeDate.flatMap { localDate, episode -> [StepBucket] in
            let bounds = DateInterval(start: episode.start, end: episode.end)
            var output = [StepBucket(
                id: StepBucketIdentity.makeDaily(
                    metric: "sleep",
                    ownerID: ownerID,
                    localDate: localDate,
                    algorithmVersion: 1
                ),
                metric: "sleep",
                start: episode.start,
                end: episode.end,
                localDate: localDate,
                timezoneId: context.timezone.identifier,
                utcOffsetMinutes: context.timezone.secondsFromGMT(for: episode.start) / 60,
                value: max(1, Int((episode.asleepSeconds / 60).rounded())),
                unit: "minute",
                sourceUpdatedAt: observedAt
            )]
            let stages: [(metric: String, intervals: [DateInterval])] = [
                ("sleep_rem", remIntervals),
                ("sleep_deep", deepIntervals)
            ]
            for stage in stages {
                let minutes = Int((SleepSummaryBuilder.coveredSeconds(
                    intervals: stage.intervals,
                    within: bounds
                ) / 60).rounded())
                guard minutes > 0 else { continue }
                output.append(StepBucket(
                    id: StepBucketIdentity.makeDaily(
                        metric: stage.metric,
                        ownerID: ownerID,
                        localDate: localDate,
                        algorithmVersion: 1
                    ),
                    metric: stage.metric,
                    start: episode.start,
                    end: episode.end,
                    localDate: localDate,
                    timezoneId: context.timezone.identifier,
                    utcOffsetMinutes: context.timezone.secondsFromGMT(for: episode.start) / 60,
                    value: minutes,
                    unit: "minute",
                    sourceUpdatedAt: observedAt
                ))
            }
            return output
        }.sorted { $0.start < $1.start }
    }

    private func fetchWorkoutBuckets(
        ownerID: String,
        type: HKWorkoutType,
        context: HealthDateContext
    ) async throws -> [StepBucket] {
        let predicate = HKQuery.predicateForSamples(
            withStart: context.start,
            end: context.end,
            options: .strictStartDate
        )
        let workouts: [HKWorkout] = try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: type,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
            ) { _, results, error in
                if error != nil {
                    continuation.resume(throwing: HealthKitStepError.queryFailed)
                    return
                }
                continuation.resume(returning: results as? [HKWorkout] ?? [])
            }
            store.execute(query)
        }

        let formatter = Self.localDateFormatter(calendar: context.calendar, timezone: context.timezone)
        let observedAt = Date.now
        return workouts.compactMap { workout in
            let start = max(workout.startDate, context.start)
            let end = min(workout.endDate, context.end)
            let minutes = Int((workout.duration / 60).rounded())
            guard minutes > 0, end > start else { return nil }
            return StepBucket(
                id: StepBucketIdentity.make(
                    metric: "workout_duration",
                    ownerID: ownerID,
                    start: start,
                    end: end,
                    algorithmVersion: 1
                ),
                metric: "workout_duration",
                start: start,
                end: end,
                localDate: formatter.string(from: start),
                timezoneId: context.timezone.identifier,
                utcOffsetMinutes: context.timezone.secondsFromGMT(for: start) / 60,
                value: minutes,
                unit: "minute",
                sourceUpdatedAt: observedAt
            )
        }
    }

    private func enableBackgroundDelivery(for sampleType: HKSampleType) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            store.enableBackgroundDelivery(for: sampleType, frequency: .hourly) { success, _ in
                if success {
                    continuation.resume()
                } else {
                    continuation.resume(throwing: HealthKitStepError.backgroundDeliveryFailed)
                }
            }
        }
    }

    private static func localDateFormatter(calendar: Calendar, timezone: TimeZone) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timezone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }

}

private struct HealthDateContext: @unchecked Sendable {
    let calendar: Calendar
    let timezone: TimeZone
    let start: Date
    let end: Date
    let today: Date
}

private struct HealthTypes {
    let steps: HKQuantityType
    let activeEnergy: HKQuantityType
    let sleep: HKCategoryType
    let hrvSDNN: HKQuantityType
    let restingHeartRate: HKQuantityType
    let workout: HKWorkoutType
}

private final class HealthObserverCompletion: @unchecked Sendable {
    private let handler: () -> Void

    init(_ handler: @escaping () -> Void) {
        self.handler = handler
    }

    func call() {
        handler()
    }
}

enum HealthKitStepError: LocalizedError {
    case unavailable
    case invalidDateRange
    case queryFailed
    case backgroundDeliveryFailed

    var errorDescription: String? {
        switch self {
        case .unavailable: "HealthKit không khả dụng trên thiết bị này."
        case .invalidDateRange: "Không tạo được khoảng ngày để đọc dữ liệu HealthKit."
        case .queryFailed: "Chưa đọc được dữ liệu HealthKit. Hãy mở khóa iPhone và thử lại."
        case .backgroundDeliveryFailed: "Chưa bật được HealthKit background delivery."
        }
    }
}
