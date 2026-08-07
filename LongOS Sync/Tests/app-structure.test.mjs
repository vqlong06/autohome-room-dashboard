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

async function filesRecursively(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesRecursively(absolute) : [absolute];
  }));
  return nested.flat();
}

test("M1 requests only read-only Steps and uses HealthKit statistics", () => {
  assert.match(health, /quantityType\(forIdentifier: \.stepCount\)/);
  assert.match(health, /HKStatisticsCollectionQuery/);
  assert.match(health, /options: \.cumulativeSum/);
  assert.match(health, /requestAuthorization\(toShare: \[\], read: \[steps\]\)/);
  assert.doesNotMatch(info, /NSHealthUpdateUsageDescription/);
});

test("queue is saved before upload and deleted only in acknowledgement path", () => {
  assert.match(coordinator, /persistChangedBuckets\(buckets/);
  assert.match(coordinator, /uploadEligibleItems\(ownerID/);
  const acknowledge = coordinator.slice(coordinator.indexOf("private func acknowledge"));
  assert.match(acknowledge, /modelContext\.delete\(item\)/);
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
