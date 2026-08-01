-- ============================================================
-- LongOS - Snapshot room_latest sang room_readings bằng pg_cron
-- Giữ tên job autohome-* để không tạo cron job trùng trên database đang chạy.
-- Paste vào Supabase -> SQL Editor -> Run.
--
-- Mục tiêu: không cần đổi firmware ESP32. ESP32 chỉ cần tiếp tục
-- cập nhật room_latest. Supabase tự ghi lịch sử mỗi 5 phút.
-- ============================================================

create extension if not exists pg_cron;

create or replace function public.snapshot_room_reading()
returns void
language sql
security definer
set search_path = public
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
    now(),
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
    and latest.updated_at > now() - interval '90 seconds'
    and not exists (
      select 1
      from public.room_readings existing
      where existing.room_id = latest.room_id
        and existing.sensor_online = true
        and existing.recorded_at > now() - interval '150 seconds'
    );
$$;

select cron.unschedule('autohome-snapshot')
where exists (
  select 1 from cron.job where jobname = 'autohome-snapshot'
);

select cron.schedule(
  'autohome-snapshot',
  '*/5 * * * *',
  $$ select public.snapshot_room_reading(); $$
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

-- Chạy thử ngay, không cần đợi 5 phút.
select public.snapshot_room_reading();

-- Kiểm tra job:
-- select * from cron.job;
-- select * from cron.job_run_details order by start_time desc limit 20;
--
-- Gỡ job nếu cần:
-- select cron.unschedule('autohome-snapshot');
-- select cron.unschedule('autohome-cleanup');
