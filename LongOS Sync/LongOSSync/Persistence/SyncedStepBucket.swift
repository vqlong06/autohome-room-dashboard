import Foundation
import SwiftData

@Model
final class SyncedStepBucket {
    @Attribute(.unique) var operationID: String
    var ownerID: String
    var bucketStart: Date
    var bucketEnd: Date
    var localDate: String
    var timezoneID: String
    var utcOffsetMinutes: Int
    var stepValue: Int
    var algorithmVersion: Int
    var uploadedAt: Date

    init(ownerID: String, bucket: StepBucket, uploadedAt: Date) {
        operationID = bucket.id
        self.ownerID = ownerID
        bucketStart = bucket.start
        bucketEnd = bucket.end
        localDate = bucket.localDate
        timezoneID = bucket.timezoneId
        utcOffsetMinutes = bucket.utcOffsetMinutes
        stepValue = bucket.value
        algorithmVersion = bucket.algorithmVersion
        self.uploadedAt = uploadedAt
    }

    func matches(_ bucket: StepBucket) -> Bool {
        bucketStart == bucket.start &&
            bucketEnd == bucket.end &&
            localDate == bucket.localDate &&
            timezoneID == bucket.timezoneId &&
            utcOffsetMinutes == bucket.utcOffsetMinutes &&
            stepValue == bucket.value &&
            algorithmVersion == bucket.algorithmVersion
    }

    func replace(with bucket: StepBucket, uploadedAt: Date) {
        bucketStart = bucket.start
        bucketEnd = bucket.end
        localDate = bucket.localDate
        timezoneID = bucket.timezoneId
        utcOffsetMinutes = bucket.utcOffsetMinutes
        stepValue = bucket.value
        algorithmVersion = bucket.algorithmVersion
        self.uploadedAt = uploadedAt
    }
}
