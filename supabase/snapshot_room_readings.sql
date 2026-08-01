-- ============================================================
-- LongOS - LEGACY history snapshot fallback
--
-- Do not run this with current LongOS firmware: the ESP32 already writes
-- room_readings every 10 minutes, so enabling this job creates a second
-- history stream. Use only when deliberately running firmware that updates
-- room_latest but cannot write room_readings.
--
-- The legacy autohome-* job names are retained to replace old jobs safely.
-- ============================================================

begin;

create extension if not exists pg_cron;

create schema if not exists longos_private;
revoke all on schema longos_private from public, anon, authenticated, service_role;
-- Keep the existing device-token RLS helper reachable by anon. Without this,
-- enabling the legacy snapshot fallback would also stop ESP32 writes.
grant usage on schema longos_private to anon;

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

select cron.unschedule('autohome-snapshot')
where exists (
  select 1 from cron.job where jobname = 'autohome-snapshot'
);

select cron.schedule(
  'autohome-snapshot',
  '*/5 * * * *',
  $$ select longos_private.snapshot_room_reading(); $$
);

select cron.unschedule('autohome-cleanup')
where exists (
  select 1 from cron.job where jobname = 'autohome-cleanup'
);

select cron.schedule(
  'autohome-cleanup',
  '17 3 * * *',
  $$ delete from public.room_readings where recorded_at < now() - interval '90 days'; $$
);

drop function if exists public.snapshot_room_reading() restrict;

-- Run once immediately instead of waiting five minutes.
select longos_private.snapshot_room_reading();

commit;

-- Inspect jobs:
-- select jobname, schedule, command, active from cron.job order by jobname;
-- select * from cron.job_run_details order by start_time desc limit 20;
