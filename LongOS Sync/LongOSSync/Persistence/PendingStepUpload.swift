import Foundation
import SwiftData

@Model
final class PendingStepUpload {
    @Attribute(.unique) var operationID: String
    var ownerID: String
    var requestID: UUID
    var installationID: UUID
    var bucketStart: Date
    var bucketEnd: Date
    var localDate: String
    var timezoneID: String
    var utcOffsetMinutes: Int
    var stepValue: Int
    var algorithmVersion: Int
    var sourceUpdatedAt: Date
    var attemptCount: Int
    var nextAttemptAt: Date
    var lastErrorCode: String?
    var createdAt: Date

    init(ownerID: String, installationID: UUID, bucket: StepBucket) {
        operationID = bucket.id
        self.ownerID = ownerID
        requestID = UUID()
        self.installationID = installationID
        bucketStart = bucket.start
        bucketEnd = bucket.end
        localDate = bucket.localDate
        timezoneID = bucket.timezoneId
        utcOffsetMinutes = bucket.utcOffsetMinutes
        stepValue = bucket.value
        algorithmVersion = bucket.algorithmVersion
        sourceUpdatedAt = bucket.sourceUpdatedAt
        attemptCount = 0
        nextAttemptAt = .distantPast
        lastErrorCode = nil
        createdAt = .now
    }

    var bucket: StepBucket {
        StepBucket(
            id: operationID,
            start: bucketStart,
            end: bucketEnd,
            localDate: localDate,
            timezoneId: timezoneID,
            utcOffsetMinutes: utcOffsetMinutes,
            value: stepValue,
            algorithmVersion: algorithmVersion,
            sourceUpdatedAt: sourceUpdatedAt
        )
    }

    func replace(with bucket: StepBucket) {
        guard bucket.id == operationID else { return }
        requestID = UUID()
        bucketStart = bucket.start
        bucketEnd = bucket.end
        localDate = bucket.localDate
        timezoneID = bucket.timezoneId
        utcOffsetMinutes = bucket.utcOffsetMinutes
        stepValue = bucket.value
        algorithmVersion = bucket.algorithmVersion
        sourceUpdatedAt = bucket.sourceUpdatedAt
        attemptCount = 0
        nextAttemptAt = .distantPast
        lastErrorCode = nil
    }
}
