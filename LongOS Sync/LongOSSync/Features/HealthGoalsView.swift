import Foundation
import SwiftUI

@MainActor
final class HealthGoalsStore: ObservableObject {
    @Published private(set) var goals: HealthDailyGoals

    private let defaults: UserDefaults
    private static let stepsKey = "longos.health-goal.steps.v1"
    private static let energyKey = "longos.health-goal.energy.v1"
    private static let sleepKey = "longos.health-goal.sleep.v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        goals = HealthDailyGoals(
            steps: Self.value(forKey: Self.stepsKey, fallback: 10_000, defaults: defaults),
            activeEnergyKcal: Self.value(forKey: Self.energyKey, fallback: 500, defaults: defaults),
            sleepMinutes: Self.value(forKey: Self.sleepKey, fallback: 480, defaults: defaults)
        )
    }

    func update(steps: Int, activeEnergyKcal: Int, sleepMinutes: Int) {
        let updated = HealthDailyGoals(
            steps: steps,
            activeEnergyKcal: activeEnergyKcal,
            sleepMinutes: sleepMinutes
        )
        defaults.set(updated.steps, forKey: Self.stepsKey)
        defaults.set(updated.activeEnergyKcal, forKey: Self.energyKey)
        defaults.set(updated.sleepMinutes, forKey: Self.sleepKey)
        goals = updated
    }

    func restoreDefaults() {
        update(steps: 10_000, activeEnergyKcal: 500, sleepMinutes: 480)
    }

    private static func value(forKey key: String, fallback: Int, defaults: UserDefaults) -> Int {
        defaults.object(forKey: key) == nil ? fallback : defaults.integer(forKey: key)
    }
}

struct HealthGoalsView: View {
    @ObservedObject var store: HealthGoalsStore
    @Environment(\.dismiss) private var dismiss

    @State private var stepsGoal: Int
    @State private var energyGoal: Int
    @State private var sleepGoal: Int

    init(store: HealthGoalsStore) {
        self.store = store
        _stepsGoal = State(initialValue: store.goals.steps)
        _energyGoal = State(initialValue: store.goals.activeEnergyKcal)
        _sleepGoal = State(initialValue: store.goals.sleepMinutes)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Stepper(value: $stepsGoal, in: 1_000...100_000, step: 500) {
                        goalRow(title: "Bước chân", value: stepsGoal.formatted(), unit: "bước")
                    }
                    Stepper(value: $energyGoal, in: 50...5_000, step: 50) {
                        goalRow(title: "Năng lượng", value: energyGoal.formatted(), unit: "kcal")
                    }
                    Stepper(value: $sleepGoal, in: 180...720, step: 30) {
                        goalRow(title: "Giấc ngủ", value: durationText(sleepGoal), unit: "")
                    }
                } header: {
                    Text("Mục tiêu mỗi ngày")
                } footer: {
                    Text("Mục tiêu chỉ được lưu trên iPhone này để tính tiến độ và điểm ngày. App không upload mục tiêu lên Supabase hay ghi vào Apple Health.")
                }

                Section {
                    Button("Khôi phục mặc định", role: .destructive) {
                        stepsGoal = 10_000
                        energyGoal = 500
                        sleepGoal = 480
                    }
                }
            }
            .navigationTitle("Mục tiêu sức khỏe")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Hủy") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Lưu") {
                        store.update(
                            steps: stepsGoal,
                            activeEnergyKcal: energyGoal,
                            sleepMinutes: sleepGoal
                        )
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
    }

    private func goalRow(title: String, value: String, unit: String) -> some View {
        HStack {
            Text(title)
            Spacer()
            Text([value, unit].filter { !$0.isEmpty }.joined(separator: " "))
                .foregroundStyle(.secondary)
                .monospacedDigit()
        }
    }

    private func durationText(_ minutes: Int) -> String {
        let hours = minutes / 60
        let remainder = minutes % 60
        return remainder == 0 ? "\(hours) giờ" : "\(hours)g \(remainder)p"
    }
}
