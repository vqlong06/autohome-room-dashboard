begin;

alter table public.health_metric_buckets
  drop constraint if exists health_metric_buckets_metric_check,
  drop constraint if exists health_metric_buckets_value_check,
  drop constraint if exists health_metric_buckets_unit_check,
  drop constraint if exists health_metric_buckets_provenance_check;

alter table public.health_metric_buckets
  add constraint health_metric_buckets_metric_check check (
    metric_key in (
      'steps', 'active_energy', 'sleep', 'sleep_rem', 'sleep_deep',
      'hrv_sdnn', 'resting_heart_rate', 'workout_duration'
    )
  ),
  add constraint health_metric_buckets_value_check check (
    case metric_key
      when 'steps' then value_integer between 0 and 2000000
      when 'active_energy' then value_integer between 0 and 100000
      when 'sleep' then value_integer between 1 and 1440
      when 'sleep_rem' then value_integer between 1 and 1440
      when 'sleep_deep' then value_integer between 1 and 1440
      when 'hrv_sdnn' then value_integer between 1 and 2000
      when 'resting_heart_rate' then value_integer between 20 and 300
      when 'workout_duration' then value_integer between 1 and 1440
      else false
    end
  ),
  add constraint health_metric_buckets_unit_check check (
    (metric_key = 'steps' and unit = 'count')
    or (metric_key = 'active_energy' and unit = 'kcal')
    or (metric_key in ('sleep', 'sleep_rem', 'sleep_deep', 'workout_duration') and unit = 'minute')
    or (metric_key = 'hrv_sdnn' and unit = 'ms')
    or (metric_key = 'resting_heart_rate' and unit = 'bpm')
  ),
  add constraint health_metric_buckets_provenance_check check (
    (metric_key in ('steps', 'active_energy') and provenance = 'healthkit_statistics')
    or (metric_key = 'sleep' and provenance = 'healthkit_sleep_summary')
    or (metric_key in ('sleep_rem', 'sleep_deep') and provenance = 'healthkit_sleep_stage_summary')
    or (metric_key in ('hrv_sdnn', 'resting_heart_rate') and provenance = 'healthkit_statistics_daily')
    or (metric_key = 'workout_duration' and provenance = 'healthkit_workout_summary')
  );

create unique index if not exists health_metric_buckets_daily_summary_unique
on public.health_metric_buckets (user_id, metric_key, local_date, algorithm_version)
where metric_key in ('sleep', 'sleep_rem', 'sleep_deep', 'hrv_sdnn', 'resting_heart_rate');

alter table public.health_sync_status
  drop constraint if exists health_sync_status_metric_check;

alter table public.health_sync_status
  add constraint health_sync_status_metric_check check (
    metric_key in (
      'steps', 'active_energy', 'sleep', 'sleep_rem', 'sleep_deep',
      'hrv_sdnn', 'resting_heart_rate', 'workout_duration'
    )
  );

create or replace function public.longos_ingest_health_step_buckets(
  p_user_id uuid,
  p_request_id uuid,
  p_installation_id uuid,
  p_payload_sha256 text,
  p_buckets jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $function$
declare
  v_existing_hash text;
  v_existing_ack jsonb;
  v_received_at timestamptz := pg_catalog.clock_timestamp();
  v_ack jsonb;
  v_bucket_count integer;
begin
  if p_user_id is null
     or p_request_id is null
     or p_installation_id is null
     or p_payload_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'INVALID_INGEST_ARGUMENTS';
  end if;

  if p_buckets is null or pg_catalog.jsonb_typeof(p_buckets) <> 'array' then
    raise exception using errcode = '22023', message = 'INVALID_BUCKETS';
  end if;

  v_bucket_count := pg_catalog.jsonb_array_length(p_buckets);
  if v_bucket_count < 1 or v_bucket_count > 500 then
    raise exception using errcode = '22023', message = 'INVALID_BUCKET_COUNT';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':' || p_request_id::text, 741127)
  );

  select batch.payload_sha256, batch.acknowledgement
  into v_existing_hash, v_existing_ack
  from longos_health_private.health_ingest_batches batch
  where batch.user_id = p_user_id and batch.request_id = p_request_id;

  if found then
    if v_existing_hash is distinct from p_payload_sha256 then
      raise exception using errcode = 'P0001', message = 'REQUEST_ID_CONFLICT';
    end if;
    if v_existing_ack is null then
      raise exception using errcode = 'P0001', message = 'ACK_UNAVAILABLE';
    end if;
    return v_existing_ack || pg_catalog.jsonb_build_object('replayed', true);
  end if;

  insert into longos_health_private.health_ingest_batches (
    user_id, request_id, installation_id, payload_sha256, acknowledgement, received_at
  ) values (
    p_user_id, p_request_id, p_installation_id, p_payload_sha256, null, v_received_at
  );

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_buckets) item
    where pg_catalog.jsonb_typeof(item.value) <> 'object'
       or (item.value ->> 'algorithm_version')::integer <> 1
       or (item.value ->> 'bucket_end')::timestamptz <= (item.value ->> 'bucket_start')::timestamptz
       or (item.value ->> 'bucket_end')::timestamptz - (item.value ->> 'bucket_start')::timestamptz > interval '24 hours'
       or not (
         (item.value ->> 'metric_key' = 'steps' and item.value ->> 'unit' = 'count'
           and item.value ->> 'provenance' = 'healthkit_statistics'
           and (item.value ->> 'value_integer')::bigint between 0 and 2000000)
         or (item.value ->> 'metric_key' = 'active_energy' and item.value ->> 'unit' = 'kcal'
           and item.value ->> 'provenance' = 'healthkit_statistics'
           and (item.value ->> 'value_integer')::bigint between 0 and 100000)
         or (item.value ->> 'metric_key' = 'sleep' and item.value ->> 'unit' = 'minute'
           and item.value ->> 'provenance' = 'healthkit_sleep_summary'
           and (item.value ->> 'value_integer')::bigint between 1 and 1440)
         or (item.value ->> 'metric_key' in ('sleep_rem', 'sleep_deep') and item.value ->> 'unit' = 'minute'
           and item.value ->> 'provenance' = 'healthkit_sleep_stage_summary'
           and (item.value ->> 'value_integer')::bigint between 1 and 1440)
         or (item.value ->> 'metric_key' = 'hrv_sdnn' and item.value ->> 'unit' = 'ms'
           and item.value ->> 'provenance' = 'healthkit_statistics_daily'
           and (item.value ->> 'value_integer')::bigint between 1 and 2000)
         or (item.value ->> 'metric_key' = 'resting_heart_rate' and item.value ->> 'unit' = 'bpm'
           and item.value ->> 'provenance' = 'healthkit_statistics_daily'
           and (item.value ->> 'value_integer')::bigint between 20 and 300)
         or (item.value ->> 'metric_key' = 'workout_duration' and item.value ->> 'unit' = 'minute'
           and item.value ->> 'provenance' = 'healthkit_workout_summary'
           and (item.value ->> 'value_integer')::bigint between 1 and 1440)
       )
  ) then
    raise exception using errcode = '22023', message = 'INVALID_BUCKET';
  end if;

  insert into public.health_metric_buckets as current_bucket (
    user_id, metric_key, bucket_start, bucket_end, local_date, timezone_id,
    utc_offset_minutes, value_integer, unit, algorithm_version, provenance,
    source_updated_at, created_at, updated_at
  )
  select
    p_user_id, item.value ->> 'metric_key',
    (item.value ->> 'bucket_start')::timestamptz,
    (item.value ->> 'bucket_end')::timestamptz,
    (item.value ->> 'local_date')::date,
    item.value ->> 'timezone_id',
    (item.value ->> 'utc_offset_minutes')::smallint,
    (item.value ->> 'value_integer')::bigint,
    item.value ->> 'unit',
    (item.value ->> 'algorithm_version')::smallint,
    item.value ->> 'provenance',
    (item.value ->> 'source_updated_at')::timestamptz,
    v_received_at, v_received_at
  from pg_catalog.jsonb_array_elements(p_buckets) item
  where item.value ->> 'metric_key' not in (
    'sleep', 'sleep_rem', 'sleep_deep', 'hrv_sdnn', 'resting_heart_rate'
  )
  on conflict (user_id, metric_key, bucket_start, bucket_end, algorithm_version)
  do update set
    local_date = excluded.local_date,
    timezone_id = excluded.timezone_id,
    utc_offset_minutes = excluded.utc_offset_minutes,
    value_integer = excluded.value_integer,
    unit = excluded.unit,
    provenance = excluded.provenance,
    source_updated_at = excluded.source_updated_at,
    updated_at = v_received_at
  where excluded.source_updated_at >= current_bucket.source_updated_at;

  insert into public.health_metric_buckets as current_daily (
    user_id, metric_key, bucket_start, bucket_end, local_date, timezone_id,
    utc_offset_minutes, value_integer, unit, algorithm_version, provenance,
    source_updated_at, created_at, updated_at
  )
  select
    p_user_id, item.value ->> 'metric_key',
    (item.value ->> 'bucket_start')::timestamptz,
    (item.value ->> 'bucket_end')::timestamptz,
    (item.value ->> 'local_date')::date,
    item.value ->> 'timezone_id',
    (item.value ->> 'utc_offset_minutes')::smallint,
    (item.value ->> 'value_integer')::bigint,
    item.value ->> 'unit',
    (item.value ->> 'algorithm_version')::smallint,
    item.value ->> 'provenance',
    (item.value ->> 'source_updated_at')::timestamptz,
    v_received_at, v_received_at
  from pg_catalog.jsonb_array_elements(p_buckets) item
  where item.value ->> 'metric_key' in (
    'sleep', 'sleep_rem', 'sleep_deep', 'hrv_sdnn', 'resting_heart_rate'
  )
  on conflict (user_id, metric_key, local_date, algorithm_version)
  where metric_key in ('sleep', 'sleep_rem', 'sleep_deep', 'hrv_sdnn', 'resting_heart_rate')
  do update set
    bucket_start = excluded.bucket_start,
    bucket_end = excluded.bucket_end,
    timezone_id = excluded.timezone_id,
    utc_offset_minutes = excluded.utc_offset_minutes,
    value_integer = excluded.value_integer,
    unit = excluded.unit,
    provenance = excluded.provenance,
    source_updated_at = excluded.source_updated_at,
    updated_at = v_received_at
  where excluded.source_updated_at >= current_daily.source_updated_at;

  insert into public.health_sync_status as current_status (
    user_id, installation_id, metric_key, last_request_id,
    last_source_updated_at, last_ingested_at, updated_at
  )
  select
    p_user_id, p_installation_id, item.value ->> 'metric_key', p_request_id,
    pg_catalog.max((item.value ->> 'source_updated_at')::timestamptz),
    v_received_at, v_received_at
  from pg_catalog.jsonb_array_elements(p_buckets) item
  group by item.value ->> 'metric_key'
  on conflict (user_id, installation_id, metric_key) do update set
    last_request_id = excluded.last_request_id,
    last_source_updated_at = case
      when current_status.last_source_updated_at >= excluded.last_source_updated_at
      then current_status.last_source_updated_at else excluded.last_source_updated_at end,
    last_ingested_at = excluded.last_ingested_at,
    updated_at = excluded.updated_at;

  v_ack := pg_catalog.jsonb_build_object(
    'requestId', p_request_id,
    'acknowledgedAt', v_received_at,
    'bucketCount', v_bucket_count,
    'replayed', false
  );

  update longos_health_private.health_ingest_batches
  set acknowledgement = v_ack
  where user_id = p_user_id and request_id = p_request_id;

  return v_ack;
end;
$function$;

revoke all on function public.longos_ingest_health_step_buckets(
  uuid, uuid, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.longos_ingest_health_step_buckets(
  uuid, uuid, uuid, text, jsonb
) to service_role;

select pg_catalog.pg_notify('pgrst', 'reload schema');

commit;
