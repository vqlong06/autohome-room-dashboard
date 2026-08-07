import Foundation
import HealthKit

final class HealthKitStepReader: @unchecked Sendable {
    private let store = HKHealthStore()
    private var observerQuery: HKObserverQuery?

    var isAvailable: Bool {
        HKHealthStore.isHealthDataAvailable()
    }

    func requestStepAuthorization() async throws {
        guard isAvailable else { throw HealthKitStepError.unavailable }
        guard let steps = HKObjectType.quantityType(forIdentifier: .stepCount) else {
            throw HealthKitStepError.unavailable
        }
        try await store.requestAuthorization(toShare: [], read: [steps])
    }

    func fetchHourlyBuckets(ownerID: String, days: Int) async throws -> [StepBucket] {
        guard isAvailable else { throw HealthKitStepError.unavailable }
        guard let steps = HKObjectType.quantityType(forIdentifier: .stepCount) else {
            throw HealthKitStepError.unavailable
        }

        let timezone = TimeZone.current
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: "en_US_POSIX")
        calendar.timeZone = timezone
        let end = Date.now
        let today = calendar.startOfDay(for: end)
        guard let start = calendar.date(byAdding: .day, value: -max(0, days - 1), to: today) else {
            throw HealthKitStepError.invalidDateRange
        }

        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsCollectionQuery(
                quantityType: steps,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum,
                anchorDate: today,
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

                var output: [StepBucket] = []
                let observedAt = Date.now
                let formatter = DateFormatter()
                formatter.calendar = calendar
                formatter.locale = Locale(identifier: "en_US_POSIX")
                formatter.timeZone = timezone
                formatter.dateFormat = "yyyy-MM-dd"

                collection.enumerateStatistics(from: start, to: end) { statistics, _ in
                    guard let quantity = statistics.sumQuantity() else { return }
                    let value = Int(quantity.doubleValue(for: .count()).rounded())
                    let offsetMinutes = timezone.secondsFromGMT(for: statistics.startDate) / 60
                    let id = StepBucketIdentity.make(
                        ownerID: ownerID,
                        start: statistics.startDate,
                        end: statistics.endDate,
                        algorithmVersion: 1
                    )
                    output.append(StepBucket(
                        id: id,
                        start: statistics.startDate,
                        end: statistics.endDate,
                        localDate: formatter.string(from: statistics.startDate),
                        timezoneId: timezone.identifier,
                        utcOffsetMinutes: offsetMinutes,
                        value: max(0, value),
                        sourceUpdatedAt: observedAt
                    ))
                }
                continuation.resume(returning: output)
            }
            self.store.execute(query)
        }
    }

    func startObserver(onChange: @escaping @Sendable () async -> Void) async throws {
        guard let steps = HKObjectType.quantityType(forIdentifier: .stepCount) else {
            throw HealthKitStepError.unavailable
        }

        if observerQuery == nil {
            let query = HKObserverQuery(sampleType: steps, predicate: nil) { _, completion, error in
                Task {
                    defer { completion() }
                    guard error == nil else { return }
                    await onChange()
                }
            }
            observerQuery = query
            store.execute(query)
        }

        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            store.enableBackgroundDelivery(for: steps, frequency: .hourly) { success, _ in
                if success {
                    continuation.resume()
                } else {
                    continuation.resume(throwing: HealthKitStepError.backgroundDeliveryFailed)
                }
            }
        }
    }

    func stopObserver() {
        if let observerQuery {
            store.stop(observerQuery)
        }
        observerQuery = nil
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
        case .invalidDateRange: "Không tạo được khoảng ngày để đọc Steps."
        case .queryFailed: "Chưa đọc được Steps từ HealthKit. Hãy mở khóa iPhone và thử lại."
        case .backgroundDeliveryFailed: "Chưa bật được HealthKit background delivery."
        }
    }
}
