import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const rootHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const publicHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const migration = await readFile(
  new URL('../LongOS Sync/Supabase/migrations/202608070001_health_steps.sql', import.meta.url),
  'utf8'
);

assert.equal(publicHtml, rootHtml, 'root and public dashboards must remain identical');

const scriptMatch = rootHtml.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
assert.ok(scriptMatch, 'dashboard inline script must exist');
new vm.Script(scriptMatch[1], { filename: 'LongOS-dashboard-inline.js' });

for (const id of [
  'healthAccountBtn',
  'healthAuthState',
  'healthStepsToday',
  'healthStepsMeta',
  'healthSyncFreshness',
  'healthCardAction',
  'healthAuthOverlay',
  'healthAuthForm',
  'healthEmail',
  'healthPassword',
  'healthSignIn',
  'healthRefresh',
  'healthSignOut'
]) {
  assert.equal((rootHtml.match(new RegExp(`id=["']${id}["']`, 'g')) || []).length, 1, `${id} must exist exactly once`);
}

assert.match(rootHtml, /autocomplete="username"/);
assert.match(rootHtml, /autocomplete="current-password"/);
assert.match(rootHtml, /const HEALTH_SESSION_KEY = 'longos\.health\.session\.v1'/);
assert.match(rootHtml, /sessionStorage\.getItem\(HEALTH_SESSION_KEY\)/);
assert.match(rootHtml, /sessionStorage\.setItem\(HEALTH_SESSION_KEY, JSON\.stringify\(session\)\)/);
assert.match(rootHtml, /sessionStorage\.removeItem\(HEALTH_SESSION_KEY\)/);
assert.doesNotMatch(rootHtml, /localStorage\.(?:getItem|setItem)\(HEALTH_SESSION_KEY/);
assert.doesNotMatch(rootHtml, /service[_-]?role/i, 'dashboard must not contain a service credential name or value');

assert.match(rootHtml, /\/auth\/v1\/token\?grant_type=\$\{encodeURIComponent\(grantType\)\}/);
assert.match(rootHtml, /requestHealthAuth\('password', \{ email, password \}\)/);
assert.match(rootHtml, /requestHealthAuth\('refresh_token', \{ refresh_token: current\.refreshToken \}\)/);
assert.match(rootHtml, /Authorization: `Bearer \$\{accessToken\}`/);
assert.match(rootHtml, /healthHeaders\(session\.accessToken\)/);

assert.match(rootHtml, /\/rest\/v1\/health_metric_buckets\?metric_key=eq\.steps/);
assert.match(rootHtml, /\/rest\/v1\/health_sync_status\?metric_key=eq\.steps/);
assert.match(rootHtml, /select=value_integer,source_updated_at,updated_at/);
assert.match(rootHtml, /select=last_source_updated_at,last_ingested_at,updated_at/);
assert.doesNotMatch(rootHtml, /health_metric_buckets[^\n]*user_id=/, 'web must rely on owner RLS rather than choose a user id');
assert.doesNotMatch(rootHtml, /health_sync_status[^\n]*user_id=/, 'web must rely on owner RLS rather than choose a user id');

assert.match(migration, /alter table public\.health_metric_buckets enable row level security;/i);
assert.match(migration, /grant select on table public\.health_metric_buckets to authenticated;/i);
assert.match(migration, /using \(\(select auth\.uid\(\)\) = user_id\);/i);
assert.match(migration, /alter table public\.health_sync_status enable row level security;/i);
assert.match(migration, /grant select on table public\.health_sync_status to authenticated;/i);

console.log('LongOS authenticated HealthKit web tests: OK');
