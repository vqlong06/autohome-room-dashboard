import XCTest
#if SWIFT_PACKAGE
@testable import LongOSSyncCore
#else
@testable import LongOSSync
#endif

final class RetryPolicyTests: XCTestCase {
    func testBackoffIsBounded() {
        XCTAssertEqual(UploadRetryPolicy.delay(afterAttempt: 0, jitterUnit: 0.5), 30)
        XCTAssertEqual(UploadRetryPolicy.delay(afterAttempt: 1, jitterUnit: 0.5), 60)
        XCTAssertEqual(UploadRetryPolicy.delay(afterAttempt: 4, jitterUnit: 0.5), 300)
        XCTAssertEqual(UploadRetryPolicy.delay(afterAttempt: 100, jitterUnit: 0.5), 300)
    }

    func testRetryClassification() {
        XCTAssertTrue(UploadRetryPolicy.shouldRetry(statusCode: 408))
        XCTAssertTrue(UploadRetryPolicy.shouldRetry(statusCode: 429))
        XCTAssertTrue(UploadRetryPolicy.shouldRetry(statusCode: 503))
        XCTAssertFalse(UploadRetryPolicy.shouldRetry(statusCode: 400))
        XCTAssertFalse(UploadRetryPolicy.shouldRetry(statusCode: 401))
        XCTAssertFalse(UploadRetryPolicy.shouldRetry(statusCode: 409))
    }

    func testManualSyncReactivatesOnlyPermanentHTTPFailures() {
        XCTAssertTrue(UploadRetryPolicy.shouldReactivateForManualSync(errorCode: "permanent_400"))
        XCTAssertTrue(UploadRetryPolicy.shouldReactivateForManualSync(errorCode: "permanent_422"))
        XCTAssertFalse(UploadRetryPolicy.shouldReactivateForManualSync(errorCode: "request_conflict"))
        XCTAssertFalse(UploadRetryPolicy.shouldReactivateForManualSync(errorCode: "retryable_503"))
        XCTAssertFalse(UploadRetryPolicy.shouldReactivateForManualSync(errorCode: nil))
    }
}
