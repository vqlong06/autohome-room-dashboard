import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = (await Promise.all([
  "202608070001_health_steps.sql",
  "202608090001_health_sleep_energy.sql"
].map((name) => readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8")))).join("\n");
const ingest = await readFile(new URL("../functions/health-ingest/index.ts", import.meta.url), "utf8");
const deletion = await readFile(new URL("../functions/health-delete/index.ts", import.meta.url), "utf8");

test("health tables are authenticated read-only and owner-scoped", () => {
  assert.match(migration, /enable row level security/gi);
  assert.match(migration, /grant select on table public\.health_metric_buckets to authenticated/i);
  assert.match(migration, /using \(\(select auth\.uid\(\)\) = user_id\)/i);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete)[^;]*authenticated/i);
  assert.match(migration, /grant execute[^;]+to service_role/is);
});

test("edge functions authenticate callers and never log payloads", () => {
  for (const source of [ingest, deletion]) {
    assert.match(source, /\/auth\/v1\/user/);
    assert.doesNotMatch(source, /console\./);
    assert.doesNotMatch(source, /sb_secret_[A-Za-z0-9_-]+/);
  }
  assert.match(ingest, /REQUEST_ID_CONFLICT/);
  assert.match(ingest, /Cache-Control.*no-store/s);
});
