import Foundation

struct AppConfiguration: Sendable {
    let supabaseURL: URL
    let dashboardURL: URL
    let publishableKey: String
    let backgroundRefreshIdentifier: String

    static func load(bundle: Bundle = .main) throws -> AppConfiguration {
        let scheme = value(named: "LONGOS_SUPABASE_SCHEME", bundle: bundle)
        let host = value(named: "LONGOS_SUPABASE_HOST", bundle: bundle)
        let key = value(named: "LONGOS_SUPABASE_PUBLISHABLE_KEY", bundle: bundle)
        let refreshID = value(named: "LONGOS_BACKGROUND_REFRESH_IDENTIFIER", bundle: bundle)
        let dashboardHost = value(named: "LONGOS_DASHBOARD_HOST", bundle: bundle)
        let dashboardPath = value(named: "LONGOS_DASHBOARD_PATH", bundle: bundle)

        guard scheme == "https", !host.isEmpty, !host.contains("your-project") else {
            throw ConfigurationError.missingSupabaseURL
        }
        guard !key.isEmpty, !key.contains("replace_me") else {
            throw ConfigurationError.missingPublishableKey
        }
        guard !refreshID.isEmpty else {
            throw ConfigurationError.missingBackgroundIdentifier
        }
        guard !dashboardHost.isEmpty, !dashboardPath.isEmpty else {
            throw ConfigurationError.missingDashboardURL
        }

        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        guard let url = components.url else {
            throw ConfigurationError.invalidSupabaseURL
        }

        var dashboardComponents = URLComponents()
        dashboardComponents.scheme = "https"
        dashboardComponents.host = dashboardHost
        dashboardComponents.path = dashboardPath.hasPrefix("/") ? dashboardPath : "/\(dashboardPath)"
        dashboardComponents.queryItems = [URLQueryItem(name: "source", value: "cloud")]
        guard let dashboardURL = dashboardComponents.url else {
            throw ConfigurationError.invalidDashboardURL
        }

        return AppConfiguration(
            supabaseURL: url,
            dashboardURL: dashboardURL,
            publishableKey: key,
            backgroundRefreshIdentifier: refreshID
        )
    }

    private static func value(named key: String, bundle: Bundle) -> String {
        (bundle.object(forInfoDictionaryKey: key) as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }
}

enum ConfigurationError: LocalizedError {
    case missingSupabaseURL
    case invalidSupabaseURL
    case missingPublishableKey
    case missingBackgroundIdentifier
    case missingDashboardURL
    case invalidDashboardURL

    var errorDescription: String? {
        switch self {
        case .missingSupabaseURL:
            "Chưa cấu hình Supabase scheme/host trong Config/Secrets.xcconfig."
        case .invalidSupabaseURL:
            "Supabase URL không hợp lệ."
        case .missingPublishableKey:
            "Chưa cấu hình Supabase publishable key."
        case .missingBackgroundIdentifier:
            "Thiếu background refresh identifier."
        case .missingDashboardURL:
            "Thiếu cấu hình dashboard LongOS."
        case .invalidDashboardURL:
            "URL dashboard LongOS không hợp lệ."
        }
    }
}
