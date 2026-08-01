-- ============================================================
-- LongOS - transactional production security hardening
--
-- Run once in Supabase SQL Editor for an existing LongOS database.
-- This migration keeps the current device-token hash, preserves all
-- telemetry, keeps/restores autohome-cleanup, and makes the ESP32 firmware the
-- only writer of room_readings by disabling autohome-snapshot.
-- ============================================================

begin;

-- Fail closed instead of deleting project-specific policies that are not
-- part of LongOS. Share the error before changing this allowlist.
do $longos_preflight$
declare
  unexpected_policies text;
  unexpected_dependencies text;
begin
  if pg_catalog.to_regclass('public.room_latest') is null
     or pg_catalog.to_regclass('public.room_readings') is null then
    raise exception 'LongOS tables are missing; run room_latest.sql and add_history.sql first';
  end if;

  if pg_catalog.to_regclass('public.room_readings_id_seq') is null then
    raise exception 'LongOS room_readings_id_seq is missing; inspect the room_readings id default before hardening';
  end if;

  select pg_catalog.string_agg(
    pg_catalog.format('%I.%I', policy.schemaname, policy.policyname),
    ', ' order by policy.tablename, policy.policyname
  )
  into unexpected_policies
  from pg_catalog.pg_policies policy
  where policy.schemaname = 'public'
    and policy.tablename in ('room_latest', 'room_readings')
    and not (
      (policy.tablename = 'room_latest' and policy.policyname in (
        'room_latest_read',
        'room_latest_insert_device',
        'room_latest_update_device'
      ))
      or
      (policy.tablename = 'room_readings' and policy.policyname in (
        'room_readings_read',
        'room_readings_insert_device'
      ))
    );

  if unexpected_policies is not null then
    raise exception 'Unexpected LongOS policies: %', unexpected_policies;
  end if;

  if pg_catalog.to_regprocedure('public.valid_room_device_token()') is not null then
    select pg_catalog.string_agg(
      pg_catalog.pg_describe_object(
        dependency.classid,
        dependency.objid,
        dependency.objsubid
      ),
      ', '
    )
    into unexpected_dependencies
    from pg_catalog.pg_depend dependency
    left join pg_catalog.pg_policy policy
      on dependency.classid = 'pg_catalog.pg_policy'::pg_catalog.regclass
      and dependency.objid = policy.oid
    left join pg_catalog.pg_class relation
      on policy.polrelid = relation.oid
    left join pg_catalog.pg_namespace namespace
      on relation.relnamespace = namespace.oid
    where dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
      and dependency.refobjid = pg_catalog.to_regprocedure('public.valid_room_device_token()')
      and not (
        dependency.classid = 'pg_catalog.pg_policy'::pg_catalog.regclass
        and namespace.nspname = 'public'
        and (relation.relname, policy.polname) in (
          ('room_latest', 'room_latest_insert_device'),
          ('room_latest', 'room_latest_update_device'),
          ('room_readings', 'room_readings_insert_device')
        )
      );

    if unexpected_dependencies is not null then
      raise exception 'Unexpected valid_room_device_token dependencies: %', unexpected_dependencies;
    end if;
  end if;
end;
$longos_preflight$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon;
grant execute on function extensions.digest(text, text) to anon;

alter table public.room_latest
add column if not exists chip_temperature_c numeric;

alter table public.room_readings
add column if not exists chip_temperature_c numeric;

alter table public.room_latest enable row level security;
alter table public.room_readings enable row level security;

-- Do not let untrusted roles create objects in the exposed public schema.
revoke create on schema public from public, anon, authenticated, service_role;

create schema if not exists longos_private;
revoke all on schema longos_private from public, anon, authenticated, service_role;
grant usage on schema longos_private to anon;

-- Future functions created by postgres require an explicit EXECUTE grant.
alter default privileges for role postgres
revoke execute on functions from public;

alter default privileges for role postgres in schema public
revoke execute on functions from public, anon, authenticated, service_role;

create or replace function longos_private.valid_room_device_token()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.encode(extensions.digest(coalesce(
    nullif(pg_catalog.current_setting('request.headers', true), '')::pg_catalog.json ->> 'x-device-token',
    ''
  ), 'sha256'), 'hex') = '3e3d040c85243da01de6bee6ea1193fdee6c0c61cdd9e5ca34a886c490255f9f';
$$;

revoke all on function longos_private.valid_room_device_token()
from public, anon, authenticated, service_role;
grant execute on function longos_private.valid_room_device_token() to anon;

-- Keep a secured, owner-only fallback implementation. It is not scheduled by
-- this migration; the current firmware writes history every 10 minutes.
create or replace function longos_private.snapshot_room_reading()
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.room_readings (
    room_id,
    recorded_at,
    app_version,
    sensor_online,
    temperature_c,
    humidity,
    chip_temperature_c,
    wifi_rssi,
    source,
    uptime_ms
  )
  select
    latest.room_id,
    pg_catalog.now(),
    latest.app_version,
    latest.sensor_online,
    latest.temperature_c,
    latest.humidity,
    latest.chip_temperature_c,
    latest.wifi_rssi,
    coalesce(latest.source, 'room_latest snapshot'),
    latest.uptime_ms
  from public.room_latest latest
  where latest.room_id = 'main-room'
    and latest.sensor_online = true
    and latest.temperature_c is not null
    and latest.humidity is not null
    and latest.updated_at > pg_catalog.now() - interval '90 seconds'
    and not exists (
      select 1
      from public.room_readings existing
      where existing.room_id = latest.room_id
        and existing.sensor_online = true
        and existing.recorded_at > pg_catalog.now() - interval '150 seconds'
    );
$$;

revoke all on function longos_private.snapshot_room_reading()
from public, anon, authenticated, service_role;

-- Normalize the pre-existing trigger too; older installations created this
-- function without a fixed search_path.
create or replace function public.set_room_latest_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists set_room_latest_updated_at on public.room_latest;
create trigger set_room_latest_updated_at
before insert or update on public.room_latest
for each row execute function public.set_room_latest_updated_at();

drop policy if exists room_latest_read on public.room_latest;
create policy room_latest_read
on public.room_latest
for select
to anon
using (room_id = 'main-room');

drop policy if exists room_latest_insert_device on public.room_latest;
create policy room_latest_insert_device
on public.room_latest
for insert
to anon
with check (room_id = 'main-room' and longos_private.valid_room_device_token());

drop policy if exists room_latest_update_device on public.room_latest;
create policy room_latest_update_device
on public.room_latest
for update
to anon
using (room_id = 'main-room' and longos_private.valid_room_device_token())
with check (room_id = 'main-room' and longos_private.valid_room_device_token());

drop policy if exists room_readings_read on public.room_readings;
create policy room_readings_read
on public.room_readings
for select
to anon
using (room_id = 'main-room');

drop policy if exists room_readings_insert_device on public.room_readings;
create policy room_readings_insert_device
on public.room_readings
for insert
to anon
with check (room_id = 'main-room' and longos_private.valid_room_device_token());

-- Supabase projects can have broad automatic grants on objects in public.
-- Replace them with the exact privileges used by the dashboard and ESP32.
revoke all on table public.room_latest from public, anon, authenticated;
grant select, insert, update on table public.room_latest to anon;

revoke all on table public.room_readings from public, anon, authenticated;
grant select, insert on table public.room_readings to anon;

revoke all on sequence public.room_readings_id_seq from public, anon, authenticated;
grant usage on sequence public.room_readings_id_seq to anon;

-- Trigger functions do not need to be callable through the Data API.
revoke all on function public.set_room_latest_updated_at()
from public, anon, authenticated, service_role;

-- The legacy cron command is stored as text, so unschedule it before removing
-- the old public function. Keep an existing cleanup job unchanged, or restore
-- the standard 90-day cleanup if it is missing.
do $longos_cron$
begin
  if pg_catalog.to_regclass('cron.job') is not null then
    execute $cron_sql$
      select cron.unschedule(jobid)
      from cron.job
      where jobname = 'autohome-snapshot'
    $cron_sql$;

    execute $cron_cleanup$
      select cron.schedule(
        'autohome-cleanup',
        '17 3 * * *',
        $cleanup_command$
          delete from public.room_readings
          where recorded_at < now() - interval '90 days';
        $cleanup_command$
      )
      where not exists (
        select 1
        from cron.job
        where jobname = 'autohome-cleanup'
          and database = current_database()
      )
    $cron_cleanup$;
  end if;
end;
$longos_cron$;

drop function if exists public.snapshot_room_reading() restrict;
drop function if exists public.valid_room_device_token() restrict;
drop function if exists public.valid_room_dashboard_token() restrict;

select pg_notify('pgrst', 'reload schema');

commit;

-- Next: run supabase/verify_security_hardening.sql.
