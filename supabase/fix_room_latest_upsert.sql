-- Public dashboards and the ESP32 upsert can read the main room row.
drop policy if exists room_latest_read on public.room_latest;

create policy room_latest_read
on public.room_latest
for select
to anon
using (room_id = 'main-room');

select pg_notify('pgrst', 'reload schema');
