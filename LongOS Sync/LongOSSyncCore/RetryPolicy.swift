import Foundation

public enum UploadRetryPolicy {
    public static let maximumDelay: TimeInterval = 5 * 60

    public static func delay(afterAttempt attempt: Int, jitterUnit: Double = 0.5) -> TimeInterval {
        let safeAttempt = max(0, attempt)
        let exponent = min(safeAttempt, 4)
        let base = min(30 * pow(2, Double(exponent)), maximumDelay)
        let clampedJitter = min(max(jitterUnit, 0), 1)
        let factor = 0.85 + (0.3 * clampedJitter)
        return min(base * factor, maximumDelay)
    }

    public static func shouldRetry(statusCode: Int) -> Bool {
        statusCode == 408 || statusCode == 425 || statusCode == 429 || (500...599).contains(statusCode)
    }
}
