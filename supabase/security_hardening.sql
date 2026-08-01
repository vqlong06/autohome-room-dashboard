-- ============================================================
-- LongOS - one-time database setup
-- Run this in Supabase SQL Editor before uploading the new firmware/web.
-- Public read access is enabled for main-room; writes still require the ESP32 token.
-- ============================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.room_latest
add column if not exists chip_temperature_c numeric;

alter table public.room_readings
add column if not exists chip_temperature_c numeric;

alter table public.room_latest enable row level security;
alter table public.room_readings enable row level security;

create or replace function public.valid_room_device_token()
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select encode(extensions.digest(coalesce(
    nullif(current_setting('request.headers', true), '')::json ->> 'x-device-token',
    ''
  ), 'sha256'), 'hex') = '3e3d040c85243da01de6bee6ea1193fdee6c0c61cdd9e5ca34a886c490255f9f';
$$;

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
with check (room_id = 'main-room' and public.valid_room_device_token());

drop policy if exists room_latest_update_device on public.room_latest;
create policy room_latest_update_device
on public.room_latest
for update
to anon
using (room_id = 'main-room' and public.valid_room_device_token())
with check (room_id = 'main-room' and public.valid_room_device_token());

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
with check (room_id = 'main-room' and public.valid_room_device_token());

grant select, insert, update on public.room_latest to anon;
grant select, insert on public.room_readings to anon;
grant usage, select on sequence public.room_readings_id_seq to anon;

drop function if exists public.valid_room_dashboard_token();

select pg_notify('pgrst', 'reload schema');
