-- ============================================================
-- LongOS - emergency write-policy rollback
--
-- Run only if security_hardening.sql committed successfully but the ESP32
-- heartbeat stops while the device and Wi-Fi are healthy. This rollback keeps
-- RLS enabled, keeps both old public RPCs removed, and does not delete data.
-- It replaces the private helper call with the same token check inline.
-- ============================================================

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon;
grant execute on function extensions.digest(text, text) to anon;

alter table public.room_latest enable row level security;
alter table public.room_readings enable row level security;

drop policy if exists room_latest_insert_device on public.room_latest;
create policy room_latest_insert_device
on public.room_latest
for insert
to anon
with check (
  room_id = 'main-room'
  and pg_catalog.encode(extensions.digest(coalesce(
    nullif(pg_catalog.current_setting('request.headers', true), '')::pg_catalog.json ->> 'x-device-token',
    ''
  ), 'sha256'), 'hex') = '3e3d040c85243da01de6bee6ea1193fdee6c0c61cdd9e5ca34a886c490255f9f'
);

drop policy if exists room_latest_update_device on public.room_latest;
create policy room_latest_update_device
on public.room_latest
for update
to anon
using (
  room_id = 'main-room'
  and pg_catalog.encode(extensions.digest(coalesce(
    nullif(pg_catalog.current_setting('request.headers', true), '')::pg_catalog.json ->> 'x-device-token',
    ''
  ), 'sha256'), 'hex') = '3e3d040c85243da01de6bee6ea1193fdee6c0c61cdd9e5ca34a886c490255f9f'
)
with check (
  room_id = 'main-room'
  and pg_catalog.encode(extensions.digest(coalesce(
    nullif(pg_catalog.current_setting('request.headers', true), '')::pg_catalog.json ->> 'x-device-token',
    ''
  ), 'sha256'), 'hex') = '3e3d040c85243da01de6bee6ea1193fdee6c0c61cdd9e5ca34a886c490255f9f'
);

drop policy if exists room_readings_insert_device on public.room_readings;
create policy room_readings_insert_device
on public.room_readings
for insert
to anon
with check (
  room_id = 'main-room'
  and pg_catalog.encode(extensions.digest(coalesce(
    nullif(pg_catalog.current_setting('request.headers', true), '')::pg_catalog.json ->> 'x-device-token',
    ''
  ), 'sha256'), 'hex') = '3e3d040c85243da01de6bee6ea1193fdee6c0c61cdd9e5ca34a886c490255f9f'
);

revoke all on table public.room_latest from public, anon, authenticated;
grant select, insert, update on table public.room_latest to anon;

revoke all on table public.room_readings from public, anon, authenticated;
grant select, insert on table public.room_readings to anon;

revoke all on sequence public.room_readings_id_seq from public, anon, authenticated;
grant usage on sequence public.room_readings_id_seq to anon;

drop function if exists longos_private.valid_room_device_token() restrict;
revoke all on schema longos_private from public, anon, authenticated, service_role;

select pg_notify('pgrst', 'reload schema');

commit;

-- This file intentionally does not re-enable autohome-snapshot. Current
-- firmware remains the history writer; use snapshot_room_readings.sql only as
-- a deliberate fallback for legacy firmware.
