alter table public.room_latest
add column if not exists chip_temperature_c numeric;

alter table if exists public.room_readings
add column if not exists chip_temperature_c numeric;

select pg_notify('pgrst', 'reload schema');
