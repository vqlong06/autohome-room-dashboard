import Combine
import Foundation

@MainActor
final class CloudSyncConsentStore: ObservableObject {
    @Published private(set) var isGranted: Bool
    @Published private(set) var grantedAt: Date?

    private let defaults: UserDefaults
    private var activeOwnerID: String?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        isGranted = false
        grantedAt = nil
    }

    func activate(ownerID: String?) {
        activeOwnerID = ownerID?.lowercased()
        guard let activeOwnerID else {
            isGranted = false
            grantedAt = nil
            return
        }
        isGranted = defaults.bool(forKey: grantedKey(for: activeOwnerID))
        grantedAt = defaults.object(forKey: dateKey(for: activeOwnerID)) as? Date
    }

    func grant() {
        guard let activeOwnerID else { return }
        let now = Date.now
        defaults.set(true, forKey: grantedKey(for: activeOwnerID))
        defaults.set(now, forKey: dateKey(for: activeOwnerID))
        isGranted = true
        grantedAt = now
    }

    func revoke() {
        guard let activeOwnerID else { return }
        defaults.removeObject(forKey: grantedKey(for: activeOwnerID))
        defaults.removeObject(forKey: dateKey(for: activeOwnerID))
        isGranted = false
        grantedAt = nil
    }

    private func grantedKey(for ownerID: String) -> String {
        "longos.cloud-sync-consent.\(ownerID).v1"
    }

    private func dateKey(for ownerID: String) -> String {
        "longos.cloud-sync-consent-date.\(ownerID).v1"
    }
}
