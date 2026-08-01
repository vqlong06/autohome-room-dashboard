-- AutoHome public dashboard migration.
-- Anyone with the dashboard URL can read main-room telemetry.
-- Insert and update policies remain protected by the ESP32 device token.

alter table public.room_latest enable row level security;
alter table public.room_readings enable row level security;

drop policy if exists room_latest_read on public.room_latest;
create policy room_latest_read
on public.room_latest
for select
to anon
using (room_id = 'main-room');

drop policy if exists room_readings_read on public.room_readings;
create policy room_readings_read
on public.room_readings
for select
to anon
using (room_id = 'main-room');

grant select on public.room_latest to anon;
grant select on public.room_readings to anon;

drop function if exists public.valid_room_dashboard_token();

select pg_notify('pgrst', 'reload schema');
