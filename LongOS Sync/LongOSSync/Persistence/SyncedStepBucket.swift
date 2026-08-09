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
    var metricKey: String = "steps"
    var stepValue: Int
    var unit: String = "count"
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
        metricKey = bucket.metric
        stepValue = bucket.value
        unit = bucket.unit
        algorithmVersion = bucket.algorithmVersion
        self.uploadedAt = uploadedAt
    }

    func matches(_ bucket: StepBucket) -> Bool {
        bucketStart == bucket.start &&
            bucketEnd == bucket.end &&
            localDate == bucket.localDate &&
            timezoneID == bucket.timezoneId &&
            utcOffsetMinutes == bucket.utcOffsetMinutes &&
            metricKey == bucket.metric &&
            stepValue == bucket.value &&
            unit == bucket.unit &&
            algorithmVersion == bucket.algorithmVersion
    }

    func replace(with bucket: StepBucket, uploadedAt: Date) {
        bucketStart = bucket.start
        bucketEnd = bucket.end
        localDate = bucket.localDate
        timezoneID = bucket.timezoneId
        utcOffsetMinutes = bucket.utcOffsetMinutes
        metricKey = bucket.metric
        stepValue = bucket.value
        unit = bucket.unit
        algorithmVersion = bucket.algorithmVersion
        self.uploadedAt = uploadedAt
    }
}
