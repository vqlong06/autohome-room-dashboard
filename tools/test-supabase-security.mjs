import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

const [
  roomLatest,
  addHistory,
  hardening,
  rollback,
  snapshot,
  verification,
  semanticMigrationTest,
  legacySemanticFixture,
  firmware,
  readme
] = await Promise.all([
  read('supabase/room_latest.sql'),
  read('supabase/add_history.sql'),
  read('supabase/security_hardening.sql'),
  read('supabase/security_hardening_rollback.sql'),
  read('supabase/snapshot_room_readings.sql'),
  read('supabase/verify_security_hardening.sql'),
  read('tools/test-supabase-migrations.mjs'),
  read('tools/fixtures/supabase-legacy-f589e75.sql'),
  read('src/main.cpp'),
  read('README.md')
]);

const tokenHash = '3e3d040c85243da01de6bee6ea1193fdee6c0c61cdd9e5ca34a886c490255f9f';
const bootstrapFiles = [roomLatest, addHistory, hardening];
const allSecuritySql = [roomLatest, addHistory, hardening, rollback, snapshot];

for (const sql of allSecuritySql) {
  assert.doesNotMatch(
    sql,
    /create\s+or\s+replace\s+function\s+public\.valid_room_device_token/iu,
    'The device-token oracle must never be recreated in the exposed public schema'
  );
  assert.doesNotMatch(
    sql,
    /create\s+or\s+replace\s+function\s+public\.snapshot_room_reading/iu,
    'The history writer must never be recreated in the exposed public schema'
  );
  assert.doesNotMatch(sql, /security\s+definer/iu, 'LongOS SQL does not require SECURITY DEFINER');
}

for (const sql of bootstrapFiles) {
  assert.match(sql, /create schema if not exists longos_private;/u);
  assert.match(sql, /revoke all on schema longos_private from public, anon, authenticated, service_role;/u);
  assert.match(sql, /grant usage on schema longos_private to anon;/u);
  assert.match(sql, /create or replace function longos_private\.valid_room_device_token\(\)/u);
  assert.match(sql, /security invoker\s+set search_path = ''/u);
  assert.match(sql, /revoke all on function longos_private\.valid_room_device_token\(\)/u);
  assert.match(sql, /grant execute on function longos_private\.valid_room_device_token\(\) to anon;/u);
  assert.match(sql, /grant usage on schema extensions to anon;/u);
  assert.match(sql, /grant execute on function extensions\.digest\(text, text\) to anon;/u);
  assert.match(sql, /revoke create on schema public from public, anon, authenticated, service_role;/u);
  assert.match(sql, new RegExp(tokenHash, 'u'));
  assert.match(sql, /alter default privileges for role postgres\s+revoke execute on functions from public;/u);
  assert.match(
    sql,
    /alter default privileges for role postgres in schema public\s+revoke execute on functions from public, anon, authenticated, service_role;/u
  );
}

assert.equal(
  (roomLatest.match(/longos_private\.valid_room_device_token\(\)/g) || []).length >= 6,
  true,
  'room_latest policies must use the private token helper'
);
assert.equal(
  (addHistory.match(/longos_private\.valid_room_device_token\(\)/g) || []).length >= 4,
  true,
  'room_readings policy must use the private token helper'
);
assert.equal(
  (hardening.match(/longos_private\.valid_room_device_token\(\)/g) || []).length >= 7,
  true,
  'production migration must replace all three write policies'
);

assert.match(roomLatest, /revoke all on table public\.room_latest from public, anon, authenticated;/u);
assert.match(roomLatest, /grant select, insert, update on table public\.room_latest to anon;/u);
assert.match(roomLatest, /revoke all on function public\.set_room_latest_updated_at\(\)/u);
assert.match(addHistory, /revoke all on table public\.room_readings from public, anon, authenticated;/u);
assert.match(addHistory, /grant select, insert on table public\.room_readings to anon;/u);
assert.match(addHistory, /grant usage on sequence public\.room_readings_id_seq to anon;/u);
assert.doesNotMatch(addHistory, /grant usage, select on sequence/u);
assert.match(addHistory, /create extension if not exists pg_cron;/u);
assert.match(addHistory, /cron\.schedule\(/u);
assert.match(addHistory, /'autohome-cleanup'/u);
assert.doesNotMatch(addHistory, /'autohome-snapshot'/u);

assert.match(hardening, /^begin;/mu);
assert.match(hardening, /^commit;/mu);
assert.match(hardening, /LongOS tables are missing/u);
assert.match(hardening, /Unexpected LongOS policies/u);
assert.match(hardening, /Unexpected valid_room_device_token dependencies/u);
assert.match(hardening, /room_readings_id_seq is missing/u);
assert.match(hardening, /create or replace function public\.set_room_latest_updated_at\(\)/u);
assert.match(hardening, /drop trigger if exists set_room_latest_updated_at/u);
assert.match(hardening, /create trigger set_room_latest_updated_at/u);
assert.match(hardening, /where jobname = 'autohome-snapshot'/u);
assert.doesNotMatch(hardening, /cron\.unschedule\('autohome-cleanup'\)/u);
assert.match(hardening, /cron\.schedule\(/u);
assert.match(hardening, /database = current_database\(\)/u);
assert.match(hardening, /drop function if exists public\.snapshot_room_reading\(\) restrict;/u);
assert.match(hardening, /drop function if exists public\.valid_room_device_token\(\) restrict;/u);
assert.match(hardening, /drop function if exists public\.valid_room_dashboard_token\(\) restrict;/u);
const hardeningWithoutCleanupCommand = hardening.replace(
  /\$cleanup_command\$[\s\S]*?\$cleanup_command\$/gu,
  ''
);
assert.doesNotMatch(hardeningWithoutCleanupCommand, /delete from public\.room_readings/iu);

assert.match(snapshot, /LEGACY history snapshot fallback/u);
assert.match(snapshot, /Do not run this with current LongOS firmware/u);
assert.match(snapshot, /grant usage on schema longos_private to anon;/u);
assert.match(snapshot, /create or replace function longos_private\.snapshot_room_reading\(\)/u);
assert.match(snapshot, /security invoker\s+set search_path = ''/u);
assert.match(snapshot, /revoke all on function longos_private\.snapshot_room_reading\(\)/u);
assert.match(snapshot, /select longos_private\.snapshot_room_reading\(\);/u);
assert.match(snapshot, /^begin;/mu);
assert.match(snapshot, /^commit;/mu);

assert.match(rollback, /^begin;/mu);
assert.match(rollback, /^commit;/mu);
assert.match(rollback, /same token check inline/u);
assert.match(rollback, new RegExp(tokenHash, 'u'));
assert.match(rollback, /drop function if exists longos_private\.valid_room_device_token\(\) restrict;/u);
assert.doesNotMatch(rollback, /cron\.schedule/u);
assert.doesNotMatch(rollback, /disable row level security/iu);
assert.doesNotMatch(rollback, /delete from public\.room_/iu);

const verificationWithoutComments = verification
  .replace(/\$([A-Za-z_][A-Za-z0-9_]*)\$[\s\S]*?\$\1\$/gu, '')
  .replace(/^\s*--.*$/gmu, '');
assert.doesNotMatch(
  verificationWithoutComments,
  /^\s*(?:begin|commit|create|alter|drop|grant|revoke|insert|update|delete|truncate|do|call)\b/imu,
  'Security verification must remain read-only'
);
assert.match(verification, /then 'PASS' else 'FAIL' end as longos_security_result/u);
assert.match(verification, /exact_policy_configuration/u);
assert.match(verification, /qual_normalized/u);
assert.match(verification, /with_check_normalized/u);
assert.match(verification, /public_token_rpc_removed/u);
assert.match(verification, /public_snapshot_rpc_removed/u);
assert.match(verification, /exact_table_privileges/u);
assert.match(verification, /exact_sequence_privileges/u);
assert.match(verification, /private_token_helper_definition/u);
assert.match(verification, /private_snapshot_helper_definition/u);
assert.match(verification, /trigger_function_definition/u);
assert.match(verification, /exact_updated_at_trigger/u);
assert.match(verification, /procedure\.prosecdef/u);
assert.match(verification, /procedure\.proconfig/u);
assert.match(verification, /pg_catalog\.aclexplode/u);
assert.match(verification, /legacy_snapshot_disabled/u);
assert.match(verification, /and cron_state\.cleanup_job_present/u);
assert.match(verification, /future_untrusted_function_execute_revoked/u);
assert.match(verification, /defaults\.defaclnamespace in/u);
assert.match(verification, /token_hash_dependency_acl/u);

assert.match(semanticMigrationTest, /from '@electric-sql\/pglite'/u);
assert.match(semanticMigrationTest, /from '@electric-sql\/pglite\/contrib\/pgcrypto'/u);
assert.match(semanticMigrationTest, /const fixtureToken = 'longos-ci-device-token';/u);
assert.match(semanticMigrationTest, /source\.replaceAll\(productionTokenHash, fixtureTokenHash\)/u);
assert.match(semanticMigrationTest, /expectedTokenHashOccurrences/u);
assert.match(semanticMigrationTest, /supabase-legacy-f589e75\.sql/u);
assert.match(semanticMigrationTest, /set role \$\{role\};/u);
assert.match(semanticMigrationTest, /await assertVerifierPass\(database/u);
assert.match(semanticMigrationTest, /runFreshBootstrap/u);
assert.match(semanticMigrationTest, /runVerifierMutations/u);
assert.match(semanticMigrationTest, /runPreflightFailure/u);
assert.match(semanticMigrationTest, /runDependencyPreflightFailure/u);
assert.match(semanticMigrationTest, /telemetryFingerprint/u);
assert.doesNotMatch(semanticMigrationTest, /include\/secrets\.h|process\.env|fetch\s*\(/u);
assert.match(semanticMigrationTest, new RegExp(tokenHash, 'u'));

assert.match(legacySemanticFixture, /captured from commit f589e75/u);
assert.equal((legacySemanticFixture.match(new RegExp(tokenHash, 'gu')) || []).length, 2);
assert.match(legacySemanticFixture, /create or replace function public\.valid_room_device_token\(\)/u);
assert.match(legacySemanticFixture, /security definer/u);
assert.match(legacySemanticFixture, /grant usage, select on sequence public\.room_readings_id_seq to anon;/u);
assert.match(legacySemanticFixture, /'autohome-snapshot'/u);

assert.match(firmware, /CLOUD_HISTORY_INTERVAL_MS = 10UL \* 60UL \* 1000UL;/u);
assert.match(firmware, /uploadHistoryToSupabase\(\);/u);
assert.match(readme, /security_hardening\.sql/u);
assert.match(readme, /verify_security_hardening\.sql/u);
assert.match(readme, /security_hardening_rollback\.sql/u);
assert.match(readme, /mọi function tạo mới sau đó đều cần được cấp `EXECUTE` tường minh/u);

console.log('LongOS Supabase security tests: OK');
