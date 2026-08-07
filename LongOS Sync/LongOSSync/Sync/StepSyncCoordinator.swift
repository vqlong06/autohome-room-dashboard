import Combine
import Foundation
import SwiftData

enum SyncReason: String, Sendable {
    case manual
    case launch
    case foreground
    case healthObserver
    case backgroundRefresh
}

@MainActor
final class StepSyncCoordinator: ObservableObject {
    @Published private(set) var session: AuthSession?
    @Published private(set) var isBusy = false
    @Published private(set) var healthRequestCompleted = false
    @Published private(set) var todaySteps: Int?
    @Published private(set) var lastSuccessfulSyncAt: Date?
    @Published private(set) var pendingUploadCount = 0
    @Published private(set) var lastErrorMessage: String?
    @Published private(set) var statusMessage = "Chưa đồng bộ"

    let cloudConsent: CloudSyncConsentStore

    private let modelContext: ModelContext
    private let healthReader: HealthKitStepReader
    private let authClient: SupabaseAuthClient
    private let ingestClient: HealthIngestClient
    private let secureStorage: SecureSessionStorage
    private let defaults: UserDefaults
    private let installationID: UUID
    private var observerStarted = false

    init(
        modelContext: ModelContext,
        configuration: AppConfiguration,
        defaults: UserDefaults = .standard
    ) throws {
        self.modelContext = modelContext
        healthReader = HealthKitStepReader()
        authClient = SupabaseAuthClient(configuration: configuration)
        ingestClient = HealthIngestClient(configuration: configuration)
        secureStorage = SecureSessionStorage(service: configuration.supabaseURL.host ?? "LongOSSync")
        self.defaults = defaults
        cloudConsent = CloudSyncConsentStore(defaults: defaults)
        installationID = try secureStorage.installationID()
        session = try secureStorage.loadSession()
        activateSessionState()
    }

    var signedInEmail: String {
        session?.email ?? "Tài khoản LongOS"
    }

    var healthDataAvailable: Bool {
        healthReader.isAvailable
    }

    func bootstrap() async {
        refreshLocalState()
        guard session != nil else { return }
        if healthRequestCompleted {
            await startObserverIfNeeded()
            await synchronize(reason: .launch)
        }
    }

    func signIn(email: String, password: String) async {
        guard !isBusy else { return }
        isBusy = true
        lastErrorMessage = nil
        statusMessage = "Đang đăng nhập…"
        defer { isBusy = false }

        do {
            let signedIn = try await authClient.signIn(email: email, password: password)
            try secureStorage.save(session: signedIn)
            session = signedIn
            activateSessionState()
            statusMessage = "Đã đăng nhập"
            refreshLocalState()
            if healthRequestCompleted {
                await startObserverIfNeeded()
                await synchronize(reason: .launch)
            }
        } catch {
            lastErrorMessage = userMessage(for: error)
            statusMessage = "Đăng nhập chưa thành công"
        }
    }

    func signOut() {
        do {
            try secureStorage.clearSession()
        } catch {
            lastErrorMessage = userMessage(for: error)
        }
        healthReader.stopObserver()
        observerStarted = false
        session = nil
        cloudConsent.activate(ownerID: nil)
        healthRequestCompleted = false
        todaySteps = nil
        lastSuccessfulSyncAt = nil
        pendingUploadCount = 0
        statusMessage = "Đã đăng xuất"
    }

    func requestHealthAccess() async {
        guard let ownerID = session?.userID, !isBusy else { return }
        isBusy = true
        lastErrorMessage = nil
        statusMessage = "Đang yêu cầu quyền Steps…"
        defer { isBusy = false }

        do {
            try await healthReader.requestStepAuthorization()
            defaults.set(true, forKey: healthRequestKey(ownerID: ownerID))
            healthRequestCompleted = true
            statusMessage = "Đã gửi yêu cầu HealthKit"
            await startObserverIfNeeded()
            await synchronize(reason: .manual)
        } catch {
            lastErrorMessage = userMessage(for: error)
            statusMessage = "Chưa thể đọc HealthKit"
        }
    }

    func synchronize(reason: SyncReason) async {
        guard !isBusy, let ownerID = session?.userID, healthRequestCompleted else { return }
        isBusy = true
        lastErrorMessage = nil
        statusMessage = reason == .manual ? "Đang đồng bộ…" : "Đang cập nhật Steps…"
        defer {
            isBusy = false
            refreshLocalState()
        }

        do {
            let reconciliationDays = shouldRunThirtyDayReconciliation(ownerID: ownerID) ? 30 : 8
            let buckets = try await healthReader.fetchHourlyBuckets(ownerID: ownerID, days: reconciliationDays)
            updateTodaySteps(from: buckets)
            try updateReconciliationState(ownerID: ownerID, days: reconciliationDays)

            if cloudConsent.isGranted {
                try persistChangedBuckets(buckets, ownerID: ownerID)
                if reason == .manual {
                    try reactivatePermanentFailures(ownerID: ownerID)
                }
                try await uploadEligibleItems(ownerID: ownerID)
            } else {
                statusMessage = buckets.isEmpty ? "Chưa có dữ liệu Steps" : "Đã đọc Steps trên iPhone"
            }
        } catch is CancellationError {
            statusMessage = "Đồng bộ đã dừng"
        } catch {
            lastErrorMessage = userMessage(for: error)
            statusMessage = "Đồng bộ chưa hoàn tất"
        }
    }

    func grantCloudConsentAndSync() async {
        cloudConsent.grant()
        await synchronize(reason: .manual)
    }

    func revokeCloudConsent() {
        cloudConsent.revoke()
        statusMessage = "Cloud sync đã tắt"
    }

    func deleteCloudHealthData() async {
        guard !isBusy, let ownerID = session?.userID else { return }
        isBusy = true
        lastErrorMessage = nil
        statusMessage = "Đang xóa dữ liệu cloud…"
        defer {
            isBusy = false
            refreshLocalState()
        }

        do {
            let validSession = try await refreshedSessionIfNeeded(force: false)
            try await ingestClient.deleteAllHealthData(accessToken: validSession.accessToken)
            try deleteLocalSyncRecords(ownerID: ownerID)
            cloudConsent.revoke()
            lastSuccessfulSyncAt = nil
            statusMessage = "Đã xóa dữ liệu Health trên cloud"
        } catch {
            lastErrorMessage = userMessage(for: error)
            statusMessage = "Chưa xóa được dữ liệu cloud"
        }
    }

    private func startObserverIfNeeded() async {
        guard !observerStarted else { return }
        do {
            try await healthReader.startObserver { [weak self] in
                await self?.synchronize(reason: .healthObserver)
            }
            observerStarted = true
        } catch {
            lastErrorMessage = userMessage(for: error)
        }
    }

    private func activateSessionState() {
        let ownerID = session?.userID
        cloudConsent.activate(ownerID: ownerID)
        healthRequestCompleted = ownerID.map { defaults.bool(forKey: healthRequestKey(ownerID: $0)) } ?? false
    }

    private func healthRequestKey(ownerID: String) -> String {
        "longos.health-request-completed.\(ownerID.lowercased()).v1"
    }

    private func updateTodaySteps(from buckets: [StepBucket]) {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        let today = formatter.string(from: .now)
        let values = buckets.filter { $0.localDate == today }.map(\.value)
        todaySteps = values.isEmpty ? nil : values.reduce(0, +)
    }

    private func persistChangedBuckets(_ buckets: [StepBucket], ownerID: String) throws {
        let allPending = try modelContext.fetch(FetchDescriptor<PendingStepUpload>())
        let allSynced = try modelContext.fetch(FetchDescriptor<SyncedStepBucket>())
        let pendingByID = Dictionary(uniqueKeysWithValues: allPending
            .filter { $0.ownerID == ownerID }
            .map { ($0.operationID, $0) })
        let syncedByID = Dictionary(uniqueKeysWithValues: allSynced
            .filter { $0.ownerID == ownerID }
            .map { ($0.operationID, $0) })

        for bucket in buckets {
            if let synced = syncedByID[bucket.id], synced.matches(bucket) {
                continue
            }
            if let pending = pendingByID[bucket.id] {
                if pending.stepValue != bucket.value ||
                    pending.bucketStart != bucket.start ||
                    pending.bucketEnd != bucket.end ||
                    pending.timezoneID != bucket.timezoneId ||
                    pending.utcOffsetMinutes != bucket.utcOffsetMinutes {
                    pending.replace(with: bucket)
                }
            } else {
                modelContext.insert(PendingStepUpload(
                    ownerID: ownerID,
                    installationID: installationID,
                    bucket: bucket
                ))
            }
        }
        try modelContext.save()
        refreshPendingCount(ownerID: ownerID)
    }

    private func uploadEligibleItems(ownerID: String) async throws {
        var validSession = try await refreshedSessionIfNeeded(force: false)
        let now = Date.now
        let items = try modelContext.fetch(FetchDescriptor<PendingStepUpload>())
            .filter { $0.ownerID == ownerID && $0.nextAttemptAt <= now }
            .sorted { $0.createdAt < $1.createdAt }
            .prefix(100)

        var uploadedAny = false
        for item in items {
            try Task.checkCancellation()
            let request = HealthIngestRequest(
                requestId: item.requestID,
                installationId: item.installationID,
                buckets: [StepBucketPayload(bucket: item.bucket)]
            )

            do {
                let acknowledgement: HealthIngestAcknowledgement
                do {
                    acknowledgement = try await ingestClient.send(request, accessToken: validSession.accessToken)
                } catch IngestClientError.unauthorized {
                    validSession = try await refreshedSessionIfNeeded(force: true)
                    acknowledgement = try await ingestClient.send(request, accessToken: validSession.accessToken)
                }
                try acknowledge(item: item, at: acknowledgement.acknowledgedAt)
                uploadedAny = true
            } catch let error as IngestClientError {
                try schedule(item: item, after: error)
                if case .requestConflict = error { throw error }
                if case .permanent = error { throw error }
            } catch {
                try scheduleUnknownNetworkFailure(item: item)
            }
        }

        refreshPendingCount(ownerID: ownerID)
        if uploadedAny {
            lastSuccessfulSyncAt = .now
            try updateSuccessfulUploadState(ownerID: ownerID, at: .now)
            statusMessage = pendingUploadCount == 0 ? "Đồng bộ hoàn tất" : "Đã đồng bộ một phần"
        } else if items.isEmpty {
            statusMessage = pendingUploadCount == 0 ? "Dữ liệu đã cập nhật" : "Còn dữ liệu đang chờ thử lại"
        } else {
            statusMessage = "Đã giữ dữ liệu để thử lại"
        }
    }

    private func reactivatePermanentFailures(ownerID: String) throws {
        let items = try modelContext.fetch(FetchDescriptor<PendingStepUpload>())
        var changed = false
        for item in items where item.ownerID == ownerID &&
            UploadRetryPolicy.shouldReactivateForManualSync(errorCode: item.lastErrorCode) {
            item.nextAttemptAt = .distantPast
            item.lastErrorCode = nil
            changed = true
        }
        if changed {
            try modelContext.save()
        }
    }

    private func acknowledge(item: PendingStepUpload, at date: Date) throws {
        let allSynced = try modelContext.fetch(FetchDescriptor<SyncedStepBucket>())
        if let existing = allSynced.first(where: { $0.operationID == item.operationID && $0.ownerID == item.ownerID }) {
            existing.replace(with: item.bucket, uploadedAt: date)
        } else {
            modelContext.insert(SyncedStepBucket(ownerID: item.ownerID, bucket: item.bucket, uploadedAt: date))
        }
        modelContext.delete(item)
        try modelContext.save()
    }

    private func schedule(item: PendingStepUpload, after error: IngestClientError) throws {
        item.attemptCount += 1
        item.lastErrorCode = errorCode(for: error)
        switch error {
        case .requestConflict, .permanent, .invalidResponse:
            item.nextAttemptAt = .distantFuture
        case .retryable, .unauthorized:
            item.nextAttemptAt = .now.addingTimeInterval(UploadRetryPolicy.delay(
                afterAttempt: item.attemptCount - 1,
                jitterUnit: Double.random(in: 0...1)
            ))
        }
        try modelContext.save()
    }

    private func scheduleUnknownNetworkFailure(item: PendingStepUpload) throws {
        item.attemptCount += 1
        item.lastErrorCode = "network_unavailable"
        item.nextAttemptAt = .now.addingTimeInterval(UploadRetryPolicy.delay(
            afterAttempt: item.attemptCount - 1,
            jitterUnit: Double.random(in: 0...1)
        ))
        try modelContext.save()
    }

    private func refreshedSessionIfNeeded(force: Bool) async throws -> AuthSession {
        guard let current = session else { throw AuthClientError.invalidCredentials }
        guard force || current.needsRefresh else { return current }
        let refreshed = try await authClient.refresh(current)
        try secureStorage.save(session: refreshed)
        session = refreshed
        return refreshed
    }

    private func updateReconciliationState(ownerID: String, days: Int) throws {
        let state = try syncState(ownerID: ownerID)
        state.lastReconciledEnd = .now
        state.lastReconciledStart = Calendar.current.date(byAdding: .day, value: -(days - 1), to: .now)
        if days == 30 { state.lastThirtyDayReconciliationAt = .now }
        try modelContext.save()
    }

    private func updateSuccessfulUploadState(ownerID: String, at date: Date) throws {
        let state = try syncState(ownerID: ownerID)
        state.lastSuccessfulUploadAt = date
        try modelContext.save()
    }

    private func syncState(ownerID: String) throws -> MetricSyncState {
        let states = try modelContext.fetch(FetchDescriptor<MetricSyncState>())
        if let existing = states.first(where: { $0.ownerID == ownerID && $0.metricKey == "steps" }) {
            return existing
        }
        let created = MetricSyncState(ownerID: ownerID)
        modelContext.insert(created)
        return created
    }

    private func shouldRunThirtyDayReconciliation(ownerID: String) -> Bool {
        guard let states = try? modelContext.fetch(FetchDescriptor<MetricSyncState>()),
              let state = states.first(where: { $0.ownerID == ownerID && $0.metricKey == "steps" }),
              let last = state.lastThirtyDayReconciliationAt else {
            return true
        }
        return Date.now.timeIntervalSince(last) >= 7 * 24 * 60 * 60
    }

    private func refreshLocalState() {
        guard let ownerID = session?.userID else { return }
        refreshPendingCount(ownerID: ownerID)
        if let states = try? modelContext.fetch(FetchDescriptor<MetricSyncState>()),
           let state = states.first(where: { $0.ownerID == ownerID && $0.metricKey == "steps" }) {
            lastSuccessfulSyncAt = state.lastSuccessfulUploadAt
        }
    }

    private func refreshPendingCount(ownerID: String) {
        pendingUploadCount = (try? modelContext.fetch(FetchDescriptor<PendingStepUpload>())
            .filter { $0.ownerID == ownerID }
            .count) ?? 0
    }

    private func deleteLocalSyncRecords(ownerID: String) throws {
        for item in try modelContext.fetch(FetchDescriptor<PendingStepUpload>()) where item.ownerID == ownerID {
            modelContext.delete(item)
        }
        for item in try modelContext.fetch(FetchDescriptor<SyncedStepBucket>()) where item.ownerID == ownerID {
            modelContext.delete(item)
        }
        for item in try modelContext.fetch(FetchDescriptor<MetricSyncState>()) where item.ownerID == ownerID {
            modelContext.delete(item)
        }
        try modelContext.save()
    }

    private func errorCode(for error: IngestClientError) -> String {
        switch error {
        case .unauthorized: "unauthorized"
        case .requestConflict: "request_conflict"
        case .retryable(let statusCode): "retryable_\(statusCode)"
        case .permanent(let statusCode): "permanent_\(statusCode)"
        case .invalidResponse: "invalid_ack"
        }
    }

    private func userMessage(for error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? "Có lỗi tạm thời. Hãy thử lại sau."
    }
}
