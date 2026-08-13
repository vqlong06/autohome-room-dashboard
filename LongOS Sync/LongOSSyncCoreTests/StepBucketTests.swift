import Foundation
import XCTest
#if SWIFT_PACKAGE
@testable import LongOSSyncCore
#else
@testable import LongOSSync
#endif

final class StepBucketTests: XCTestCase {
    func testIdentityIsDeterministicAndOwnerScoped() throws {
        let start = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-08-07T00:00:00Z"))
        let end = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-08-07T01:00:00Z"))

        let first = StepBucketIdentity.make(
            ownerID: "USER-A",
            start: start,
            end: end,
            algorithmVersion: 1
        )
        let second = StepBucketIdentity.make(
            ownerID: "user-a",
            start: start,
            end: end,
            algorithmVersion: 1
        )
        let otherOwner = StepBucketIdentity.make(
            ownerID: "user-b",
            start: start,
            end: end,
            algorithmVersion: 1
        )

        XCTAssertEqual(first, second)
        XCTAssertNotEqual(first, otherOwner)
    }

    func testIdentityMatchesBackendKeyAndDoesNotDependOnTimezoneContext() throws {
        let start = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-08-07T00:00:00Z"))
        let end = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-08-07T01:00:00Z"))

        let identity = StepBucketIdentity.make(
            ownerID: "user-a",
            start: start,
            end: end,
            algorithmVersion: 1
        )

        XCTAssertEqual(
            identity,
            "steps|user-a|2026-08-07T00:00:00.000Z|2026-08-07T01:00:00.000Z|1"
        )
    }

    func testMetricIdentitySeparatesStepsEnergyAndDailySleep() throws {
        let start = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-08-07T00:00:00Z"))
        let end = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-08-07T01:00:00Z"))
        let steps = StepBucketIdentity.make(
            metric: "steps",
            ownerID: "user-a",
            start: start,
            end: end,
            algorithmVersion: 1
        )
        let energy = StepBucketIdentity.make(
            metric: "active_energy",
            ownerID: "user-a",
            start: start,
            end: end,
            algorithmVersion: 1
        )
        let sleep = StepBucketIdentity.makeDaily(
            metric: "sleep",
            ownerID: "user-a",
            localDate: "2026-08-07",
            algorithmVersion: 1
        )

        XCTAssertNotEqual(steps, energy)
        XCTAssertEqual(sleep, "sleep|user-a|2026-08-07|1")
    }

    func testSleepSummaryMergesOverlappingStagesWithoutDoubleCounting() {
        let base = Date(timeIntervalSince1970: 0)
        let episodes = SleepSummaryBuilder.merge(intervals: [
            DateInterval(start: base, duration: 2 * 60 * 60),
            DateInterval(start: base.addingTimeInterval(30 * 60), duration: 60 * 60),
            DateInterval(start: base.addingTimeInterval(2.5 * 60 * 60), duration: 60 * 60)
        ])

        XCTAssertEqual(episodes.count, 1)
        XCTAssertEqual(episodes[0].start, base)
        XCTAssertEqual(episodes[0].end, base.addingTimeInterval(3.5 * 60 * 60))
        XCTAssertEqual(episodes[0].asleepSeconds, 3 * 60 * 60)
    }

    func testSleepSummarySeparatesEpisodesAcrossLongWakeGap() {
        let base = Date(timeIntervalSince1970: 0)
        let episodes = SleepSummaryBuilder.merge(intervals: [
            DateInterval(start: base, duration: 60 * 60),
            DateInterval(start: base.addingTimeInterval(3 * 60 * 60), duration: 60 * 60)
        ])

        XCTAssertEqual(episodes.count, 2)
    }

    func testSleepStageCoverageClipsAndDoesNotDoubleCount() {
        let base = Date(timeIntervalSince1970: 0)
        let coverage = SleepSummaryBuilder.coveredSeconds(
            intervals: [
                DateInterval(start: base.addingTimeInterval(-30 * 60), duration: 90 * 60),
                DateInterval(start: base.addingTimeInterval(30 * 60), duration: 60 * 60)
            ],
            within: DateInterval(start: base, duration: 2 * 60 * 60)
        )

        XCTAssertEqual(coverage, 90 * 60)
    }

    func testDailySummaryDoesNotTreatMissingMetricsAsZero() {
        let summary = HealthDailySummaryBuilder.make(
            steps: 5_000,
            activeEnergyKcal: nil,
            sleepMinutes: nil,
            goals: HealthDailyGoals(),
            localHour: 12
        )

        XCTAssertEqual(summary.score, 50)
        XCTAssertEqual(summary.availableMetricCount, 1)
        XCTAssertNil(summary.activeEnergy.percent)
        XCTAssertNil(summary.sleep.percent)
    }

    func testDailySummaryCapsProgressAndAveragesAvailableMetrics() {
        let summary = HealthDailySummaryBuilder.make(
            steps: 15_000,
            activeEnergyKcal: 250,
            sleepMinutes: 480,
            goals: HealthDailyGoals(),
            localHour: 12
        )

        XCTAssertEqual(summary.steps.percent, 100)
        XCTAssertEqual(summary.activeEnergy.percent, 50)
        XCTAssertEqual(summary.sleep.percent, 100)
        XCTAssertEqual(summary.score, 83)
    }

    func testDailySummaryPrioritizesLowSleep() {
        let summary = HealthDailySummaryBuilder.make(
            steps: 4_000,
            activeEnergyKcal: 200,
            sleepMinutes: 300,
            goals: HealthDailyGoals(),
            localHour: 18
        )

        XCTAssertEqual(summary.title, "Ưu tiên hồi phục")
    }

    func testDailySummarySuggestsWalkingLateInDay() {
        let summary = HealthDailySummaryBuilder.make(
            steps: 3_000,
            activeEnergyKcal: 350,
            sleepMinutes: 420,
            goals: HealthDailyGoals(),
            localHour: 18
        )

        XCTAssertEqual(summary.title, "Còn thiếu vận động")
    }

    func testRequestUsesCamelCaseContractAndNeverContainsUserID() throws {
        let requestID = UUID(uuidString: "00000000-0000-4000-8000-000000000001")!
        let installationID = UUID(uuidString: "00000000-0000-4000-8000-000000000002")!
        let start = Date(timeIntervalSince1970: 0)
        let bucket = StepBucket(
            id: "bucket",
            start: start,
            end: start.addingTimeInterval(3600),
            localDate: "1970-01-01",
            timezoneId: "UTC",
            utcOffsetMinutes: 0,
            value: 321,
            sourceUpdatedAt: start
        )
        let request = HealthIngestRequest(
            requestId: requestID,
            installationId: installationID,
            buckets: [StepBucketPayload(bucket: bucket)]
        )

        let json = String(decoding: try LongOSJSON.encoder().encode(request), as: UTF8.self)
        XCTAssertTrue(json.contains("\"requestId\""))
        XCTAssertTrue(json.contains("\"timezoneId\""))
        XCTAssertFalse(json.lowercased().contains("userid"))
    }

    func testAcknowledgementDecodesFractionalPostgresTimestamp() throws {
        let json = Data("""
        {
          "requestId": "00000000-0000-4000-8000-000000000001",
          "acknowledgedAt": "2026-08-07T12:34:56.123456+00:00",
          "bucketCount": 1,
          "replayed": false
        }
        """.utf8)

        let acknowledgement = try LongOSJSON.decoder().decode(
            HealthIngestAcknowledgement.self,
            from: json
        )
        XCTAssertEqual(acknowledgement.bucketCount, 1)
    }
}
