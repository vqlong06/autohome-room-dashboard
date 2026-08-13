import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const health = await readFile(new URL("../LongOSSync/HealthKit/HealthKitStepReader.swift", import.meta.url), "utf8");
const coordinator = await readFile(new URL("../LongOSSync/Sync/StepSyncCoordinator.swift", import.meta.url), "utf8");
const entitlements = await readFile(new URL("../LongOSSync/LongOSSync.entitlements", import.meta.url), "utf8");
const info = await readFile(new URL("../LongOSSync/Info.plist", import.meta.url), "utf8");
const project = await readFile(new URL("../LongOSSync.xcodeproj/project.pbxproj", import.meta.url), "utf8");
const configuration = await readFile(new URL("../LongOSSync/App/AppConfiguration.swift", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../LongOSSync/Features/DashboardView.swift", import.meta.url), "utf8");
const healthGoals = await readFile(new URL("../LongOSSync/Features/HealthGoalsView.swift", import.meta.url), "utf8");
const core = await readFile(new URL("../LongOSSyncCore/StepBucket.swift", import.meta.url), "utf8");
const baseConfiguration = await readFile(new URL("../Config/Base.xcconfig", import.meta.url), "utf8");

async function filesRecursively(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesRecursively(absolute) : [absolute];
  }));
  return nested.flat();
}

test("requests the approved HealthKit summaries with read-only aggregate queries", () => {
  assert.match(health, /quantityType\(forIdentifier: \.stepCount\)/);
  assert.match(health, /quantityType\(forIdentifier: \.activeEnergyBurned\)/);
  assert.match(health, /categoryType\(forIdentifier: \.sleepAnalysis\)/);
  assert.match(health, /quantityType\(forIdentifier: \.heartRateVariabilitySDNN\)/);
  assert.match(health, /quantityType\(forIdentifier: \.restingHeartRate\)/);
  assert.match(health, /HKObjectType\.workoutType\(\)/);
  assert.match(health, /HKStatisticsCollectionQuery/);
  assert.match(health, /HKSampleQuery/);
  assert.match(health, /options: \.cumulativeSum/);
  assert.match(health, /types\.hrvSDNN/);
  assert.match(health, /types\.restingHeartRate/);
  assert.match(health, /types\.workout/);
  assert.match(health, /requestAuthorization\(toShare: \[\], read: readTypes\)/);
  assert.match(coordinator, /health-request-completed\..*\.v3/);
  assert.match(health, /metric: "active_energy"/);
  assert.match(health, /metric: "sleep"/);
  assert.match(health, /metric: "hrv_sdnn"/);
  assert.match(health, /metric: "resting_heart_rate"/);
  assert.match(health, /metric: "workout_duration"/);
  assert.match(health, /"sleep_rem"/);
  assert.match(health, /"sleep_deep"/);
  assert.match(health, /StepBucketIdentity\.makeDaily/);
  assert.doesNotMatch(health, /quantityType\(forIdentifier: \.heartRate\)/);
  assert.doesNotMatch(info, /NSHealthUpdateUsageDescription/);
});

test("queue is saved before upload and deleted only in acknowledgement path", () => {
  assert.match(coordinator, /persistChangedBuckets\(buckets/);
  assert.match(coordinator, /uploadEligibleItems\(ownerID/);
  const acknowledge = coordinator.slice(coordinator.indexOf("private func acknowledge"));
  assert.match(acknowledge, /modelContext\.delete\(item\)/);
});

test("daily intelligence uses local goals and never uploads derived scores", () => {
  assert.match(core, /HealthDailySummaryBuilder/);
  assert.match(core, /available\.isEmpty \? nil/);
  assert.match(dashboard, /dailyIntelligenceCard/);
  assert.match(dashboard, /HealthGoalsView\(store: healthGoals\)/);
  assert.match(healthGoals, /longos\.health-goal\.steps\.v1/);
  assert.match(healthGoals, /Mục tiêu chỉ được lưu trên iPhone này/);
  assert.doesNotMatch(healthGoals, /URLSession|HealthIngest|functions\/v1/);
});

test("HealthKit and Data Protection entitlements are present", () => {
  assert.match(entitlements, /com\.apple\.developer\.healthkit/);
  assert.match(entitlements, /com\.apple\.developer\.healthkit\.background-delivery/);
  assert.match(entitlements, /NSFileProtectionComplete/);
});

test("every Swift source is included in the Xcode project", async () => {
  const sourceRoots = ["LongOSSync", "LongOSSyncCore", "LongOSSyncCoreTests"];
  const files = (await Promise.all(
    sourceRoots.map((directory) => filesRecursively(path.join(root, directory)))
  )).flat().filter((file) => file.endsWith(".swift"));

  for (const file of files) {
    const name = path.basename(file);
    assert.match(project, new RegExp(`${name.replace(".", "\\.")} in Sources`), `${name} is not in Sources`);
  }
});

test("app icon and privacy manifest are target resources", () => {
  assert.match(project, /Assets\.xcassets in Resources/);
  assert.match(project, /PrivacyInfo\.xcprivacy in Resources/);
  assert.match(project, /ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon/);
  assert.match(project, /ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME = AccentColor/);
});

test("M1.3 opens the HTTPS LongOS dashboard without transferring app credentials", () => {
  assert.match(info, /LONGOS_DASHBOARD_HOST/);
  assert.match(info, /LONGOS_DASHBOARD_PATH/);
  assert.match(baseConfiguration, /LONGOS_DASHBOARD_HOST = vqlong06\.github\.io/);
  assert.match(configuration, /dashboardComponents\.scheme = "https"/);
  assert.match(configuration, /URLQueryItem\(name: "source", value: "cloud"\)/);
  assert.match(dashboard, /Link\(destination: coordinator\.dashboardURL\)/);
  assert.match(dashboard, /không chuyển mật khẩu hoặc token sang website/);
  assert.doesNotMatch(dashboard, /accessToken|refreshToken/);
});

test("client sources and build config never contain a service-role credential", async () => {
  const clientFiles = (await Promise.all([
    filesRecursively(path.join(root, "LongOSSync")),
    filesRecursively(path.join(root, "LongOSSyncCore")),
    filesRecursively(path.join(root, "Config"))
  ])).flat().filter((file) => !file.endsWith("Secrets.example.xcconfig"));
  const clientText = (await Promise.all(clientFiles.map((file) => readFile(file, "utf8")))).join("\n");

  assert.doesNotMatch(clientText, /service[_-]?role/i);
  assert.doesNotMatch(clientText, /sb_secret_[A-Za-z0-9_-]+/);
});
