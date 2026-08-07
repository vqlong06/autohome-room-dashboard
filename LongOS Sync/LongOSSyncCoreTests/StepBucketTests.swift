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
