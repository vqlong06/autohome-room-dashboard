create table if not exists public.room_latest (
  room_id text primary key,
  updated_at timestamptz not null default now(),
  app_version text,
  device_online boolean not null default false,
  wifi_connected boolean not null default false,
  wifi_mode text,
  wifi_rssi integer,
  free_heap integer,
  chip_temperature_c numeric,
  last_sensor_ok_ms bigint,
  temperature_c numeric,
  humidity numeric,
  sensor_online boolean not null default false,
  source text,
  uptime_ms bigint,
  local_ip text
);

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.room_latest enable row level security;

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

create or replace function public.set_room_latest_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_room_latest_updated_at on public.room_latest;
create trigger set_room_latest_updated_at
before insert or update on public.room_latest
for each row
execute function public.set_room_latest_updated_at();

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

grant select, insert, update on public.room_latest to anon;

insert into public.room_latest (
  room_id,
  app_version,
  device_online,
  wifi_connected,
  sensor_online,
  source
) values (
  'main-room',
  'waiting-for-esp32',
  false,
  false,
  false,
  'No data'
) on conflict (room_id) do nothing;
