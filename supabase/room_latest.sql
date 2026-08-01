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
grant usage on schema extensions to anon;
grant execute on function extensions.digest(text, text) to anon;

revoke create on schema public from public, anon, authenticated, service_role;

-- Keep policy helpers outside every schema exposed by the Supabase Data API.
create schema if not exists longos_private;
revoke all on schema longos_private from public, anon, authenticated, service_role;
grant usage on schema longos_private to anon;

-- New functions are private by default. Grant only the exact helper below.
alter default privileges for role postgres
revoke execute on functions from public;

alter default privileges for role postgres in schema public
revoke execute on functions from public, anon, authenticated, service_role;

alter table public.room_latest enable row level security;

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

revoke all on function public.set_room_latest_updated_at()
from public, anon, authenticated, service_role;

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
with check (room_id = 'main-room' and longos_private.valid_room_device_token());

drop policy if exists room_latest_update_device on public.room_latest;
create policy room_latest_update_device
on public.room_latest
for update
to anon
using (room_id = 'main-room' and longos_private.valid_room_device_token())
with check (room_id = 'main-room' and longos_private.valid_room_device_token());

revoke all on table public.room_latest from public, anon, authenticated;
grant select, insert, update on table public.room_latest to anon;

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

select pg_notify('pgrst', 'reload schema');
