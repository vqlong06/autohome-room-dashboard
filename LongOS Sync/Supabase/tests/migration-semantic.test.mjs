import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migration = await readFile(
  new URL("../migrations/202608070001_health_steps.sql", import.meta.url),
  "utf8"
);

const bootstrap = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid()
  returns uuid
  language sql
  stable
  as $$
    select nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
`;

async function withRole(database, role, userID, operation) {
  await database.exec(`set role ${role}`);
  try {
    await database.query(
      "select pg_catalog.set_config('request.jwt.claim.sub', $1, false)",
      [userID ?? ""]
    );
    return await operation();
  } finally {
    await database.exec("reset role");
    await database.query(
      "select pg_catalog.set_config('request.jwt.claim.sub', '', false)"
    );
  }
}

test("migration executes idempotently and enforces ingest/RLS semantics", async () => {
  const database = await PGlite.create({ extensions: { pgcrypto } });
  const userA = "00000000-0000-4000-8000-0000000000a1";
  const userB = "00000000-0000-4000-8000-0000000000b2";
  const requestID = "00000000-0000-4000-8000-000000000001";
  const installationID = "00000000-0000-4000-8000-000000000002";
  const hash = "a".repeat(64);
  const buckets = [{
    metric_key: "steps",
    bucket_start: "2026-08-07T00:00:00.000Z",
    bucket_end: "2026-08-07T01:00:00.000Z",
    local_date: "2026-08-07",
    timezone_id: "Asia/Ho_Chi_Minh",
    utc_offset_minutes: 420,
    value_integer: 321,
    unit: "count",
    algorithm_version: 1,
    provenance: "healthkit_statistics",
    source_updated_at: "2026-08-07T01:05:00.000Z"
  }];

  try {
    await database.exec(bootstrap);
    await database.exec(migration);
    await database.exec(migration);
    await database.query("insert into auth.users (id) values ($1), ($2)", [userA, userB]);

    const privileges = await database.query(`
      select
        pg_catalog.has_table_privilege('authenticated', 'public.health_metric_buckets', 'SELECT') as can_select,
        pg_catalog.has_table_privilege('authenticated', 'public.health_metric_buckets', 'INSERT') as can_insert,
        pg_catalog.has_function_privilege(
          'authenticated',
          'public.longos_ingest_health_step_buckets(uuid,uuid,uuid,text,jsonb)',
          'EXECUTE'
        ) as app_can_ingest,
        pg_catalog.has_function_privilege(
          'service_role',
          'public.longos_ingest_health_step_buckets(uuid,uuid,uuid,text,jsonb)',
          'EXECUTE'
        ) as service_can_ingest,
        pg_catalog.has_function_privilege(
          'authenticated',
          'public.longos_delete_health_user_data(uuid)',
          'EXECUTE'
        ) as app_can_delete,
        pg_catalog.has_function_privilege(
          'service_role',
          'public.longos_delete_health_user_data(uuid)',
          'EXECUTE'
        ) as service_can_delete
    `);
    assert.deepEqual(privileges.rows[0], {
      can_select: true,
      can_insert: false,
      app_can_ingest: false,
      service_can_ingest: true,
      app_can_delete: false,
      service_can_delete: true
    });

    const first = await database.query(
      `select public.longos_ingest_health_step_buckets(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::jsonb
      ) as acknowledgement`,
      [userA, requestID, installationID, hash, JSON.stringify(buckets)]
    );
    assert.equal(first.rows[0].acknowledgement.replayed, false);
    assert.equal(first.rows[0].acknowledgement.bucketCount, 1);

    const replay = await database.query(
      `select public.longos_ingest_health_step_buckets(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::jsonb
      ) as acknowledgement`,
      [userA, requestID, installationID, hash, JSON.stringify(buckets)]
    );
    assert.equal(replay.rows[0].acknowledgement.replayed, true);

    await assert.rejects(
      database.query(
        `select public.longos_ingest_health_step_buckets(
          $1::uuid, $2::uuid, $3::uuid, $4::text, $5::jsonb
        )`,
        [userA, requestID, installationID, "b".repeat(64), JSON.stringify(buckets)]
      ),
      /REQUEST_ID_CONFLICT/
    );

    const ownRows = await withRole(database, "authenticated", userA, () =>
      database.query("select value_integer from public.health_metric_buckets")
    );
    assert.deepEqual(ownRows.rows, [{ value_integer: 321 }]);

    const otherRows = await withRole(database, "authenticated", userB, () =>
      database.query("select value_integer from public.health_metric_buckets")
    );
    assert.equal(otherRows.rows.length, 0);

    await assert.rejects(
      withRole(database, "anon", null, () =>
        database.query("select value_integer from public.health_metric_buckets")
      ),
      /permission denied/
    );

    await database.query(
      "select public.longos_delete_health_user_data($1::uuid)",
      [userA]
    );
    const afterDeletion = await database.query(`
      select
        (select pg_catalog.count(*) from public.health_metric_buckets) as bucket_count,
        (select pg_catalog.count(*) from public.health_sync_status) as status_count,
        (select pg_catalog.count(*) from longos_health_private.health_ingest_batches) as batch_count
    `);
    assert.deepEqual(afterDeletion.rows[0], {
      bucket_count: 0,
      status_count: 0,
      batch_count: 0
    });
  } finally {
    await database.close();
  }
});
