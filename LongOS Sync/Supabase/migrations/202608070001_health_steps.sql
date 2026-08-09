begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists longos_health_private;
revoke all on schema longos_health_private from public, anon, authenticated;

create table if not exists public.health_metric_buckets (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  metric_key text not null,
  bucket_start timestamptz not null,
  bucket_end timestamptz not null,
  local_date date not null,
  timezone_id text not null,
  utc_offset_minutes smallint not null,
  value_integer bigint not null,
  unit text not null,
  algorithm_version smallint not null,
  provenance text not null,
  source_updated_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),

  constraint health_metric_buckets_metric_check check (metric_key = 'steps'),
  constraint health_metric_buckets_time_check check (
    bucket_end > bucket_start
    and bucket_end - bucket_start <= interval '24 hours'
  ),
  constraint health_metric_buckets_timezone_check check (
    pg_catalog.char_length(timezone_id) between 1 and 64
  ),
  constraint health_metric_buckets_offset_check check (
    utc_offset_minutes between -900 and 900
  ),
  constraint health_metric_buckets_value_check check (
    value_integer between 0 and 2000000
  ),
  constraint health_metric_buckets_unit_check check (unit = 'count'),
  constraint health_metric_buckets_algorithm_check check (algorithm_version = 1),
  constraint health_metric_buckets_provenance_check check (
    provenance = 'healthkit_statistics'
  ),
  constraint health_metric_buckets_identity_unique unique (
    user_id,
    metric_key,
    bucket_start,
    bucket_end,
    algorithm_version
  )
);

create index if not exists health_metric_buckets_user_date_idx
on public.health_metric_buckets (user_id, local_date desc, bucket_start desc);

alter table public.health_metric_buckets enable row level security;
revoke all on table public.health_metric_buckets from public, anon, authenticated;
grant select on table public.health_metric_buckets to authenticated;

drop policy if exists health_metric_buckets_select_own on public.health_metric_buckets;
create policy health_metric_buckets_select_own
on public.health_metric_buckets
for select
to authenticated
using ((select auth.uid()) = user_id);

create table if not exists public.health_sync_status (
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id uuid not null,
  metric_key text not null,
  last_request_id uuid not null,
  last_source_updated_at timestamptz not null,
  last_ingested_at timestamptz not null,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (user_id, installation_id, metric_key),
  constraint health_sync_status_metric_check check (metric_key = 'steps')
);

alter table public.health_sync_status enable row level security;
revoke all on table public.health_sync_status from public, anon, authenticated;
grant select on table public.health_sync_status to authenticated;

drop policy if exists health_sync_status_select_own on public.health_sync_status;
create policy health_sync_status_select_own
on public.health_sync_status
for select
to authenticated
using ((select auth.uid()) = user_id);

create table if not exists longos_health_private.health_ingest_batches (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  installation_id uuid not null,
  payload_sha256 text not null,
  acknowledgement jsonb,
  received_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (user_id, request_id),
  constraint health_ingest_batches_hash_check check (
    payload_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint health_ingest_batches_ack_check check (
    acknowledgement is null or pg_catalog.jsonb_typeof(acknowledgement) = 'object'
  )
);

alter table longos_health_private.health_ingest_batches enable row level security;
revoke all on table longos_health_private.health_ingest_batches from public, anon, authenticated;

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

  if p_buckets is null
     or pg_catalog.jsonb_typeof(p_buckets) <> 'array'
  then
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
  where batch.user_id = p_user_id
    and batch.request_id = p_request_id;

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
    user_id,
    request_id,
    installation_id,
    payload_sha256,
    acknowledgement,
    received_at
  ) values (
    p_user_id,
    p_request_id,
    p_installation_id,
    p_payload_sha256,
    null,
    v_received_at
  );

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_buckets) item
    where pg_catalog.jsonb_typeof(item.value) <> 'object'
       or item.value ->> 'metric_key' <> 'steps'
       or item.value ->> 'unit' <> 'count'
       or item.value ->> 'provenance' <> 'healthkit_statistics'
       or (item.value ->> 'algorithm_version')::integer <> 1
       or (item.value ->> 'value_integer')::bigint not between 0 and 2000000
       or (item.value ->> 'bucket_end')::timestamptz <= (item.value ->> 'bucket_start')::timestamptz
       or (item.value ->> 'bucket_end')::timestamptz - (item.value ->> 'bucket_start')::timestamptz > interval '24 hours'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_BUCKET';
  end if;

  insert into public.health_metric_buckets as current_bucket (
    user_id,
    metric_key,
    bucket_start,
    bucket_end,
    local_date,
    timezone_id,
    utc_offset_minutes,
    value_integer,
    unit,
    algorithm_version,
    provenance,
    source_updated_at,
    created_at,
    updated_at
  )
  select
    p_user_id,
    item.value ->> 'metric_key',
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
    v_received_at,
    v_received_at
  from pg_catalog.jsonb_array_elements(p_buckets) item
  on conflict (
    user_id,
    metric_key,
    bucket_start,
    bucket_end,
    algorithm_version
  ) do update set
    local_date = excluded.local_date,
    timezone_id = excluded.timezone_id,
    utc_offset_minutes = excluded.utc_offset_minutes,
    value_integer = excluded.value_integer,
    unit = excluded.unit,
    provenance = excluded.provenance,
    source_updated_at = excluded.source_updated_at,
    updated_at = v_received_at
  where excluded.source_updated_at >= current_bucket.source_updated_at;

  insert into public.health_sync_status as current_status (
    user_id,
    installation_id,
    metric_key,
    last_request_id,
    last_source_updated_at,
    last_ingested_at,
    updated_at
  )
  select
    p_user_id,
    p_installation_id,
    'steps',
    p_request_id,
    pg_catalog.max((item.value ->> 'source_updated_at')::timestamptz),
    v_received_at,
    v_received_at
  from pg_catalog.jsonb_array_elements(p_buckets) item
  on conflict (user_id, installation_id, metric_key) do update set
    last_request_id = excluded.last_request_id,
    last_source_updated_at = case
      when current_status.last_source_updated_at >= excluded.last_source_updated_at
      then current_status.last_source_updated_at
      else excluded.last_source_updated_at
    end,
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
  where user_id = p_user_id
    and request_id = p_request_id;

  return v_ack;
end;
$function$;

revoke all on function public.longos_ingest_health_step_buckets(
  uuid,
  uuid,
  uuid,
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.longos_ingest_health_step_buckets(
  uuid,
  uuid,
  uuid,
  text,
  jsonb
) to service_role;

create or replace function public.longos_delete_health_user_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'INVALID_USER';
  end if;
  delete from public.health_metric_buckets where user_id = p_user_id;
  delete from public.health_sync_status where user_id = p_user_id;
  delete from longos_health_private.health_ingest_batches where user_id = p_user_id;
end;
$function$;

revoke all on function public.longos_delete_health_user_data(uuid)
from public, anon, authenticated;
grant execute on function public.longos_delete_health_user_data(uuid)
to service_role;

select pg_catalog.pg_notify('pgrst', 'reload schema');

commit;
