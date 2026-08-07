import Foundation
import SwiftData

@Model
final class MetricSyncState {
    @Attribute(.unique) var stateID: String
    var ownerID: String
    var metricKey: String
    var schemaVersion: Int
    var lastReconciledStart: Date?
    var lastReconciledEnd: Date?
    var lastSuccessfulUploadAt: Date?
    var lastThirtyDayReconciliationAt: Date?

    init(ownerID: String, metricKey: String = "steps", schemaVersion: Int = 1) {
        stateID = "\(ownerID.lowercased())|\(metricKey)|\(schemaVersion)"
        self.ownerID = ownerID
        self.metricKey = metricKey
        self.schemaVersion = schemaVersion
    }
}
