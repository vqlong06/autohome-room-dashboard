-- LongOS production security verification (read-only).
-- Run after security_hardening.sql. The final row must say PASS.
-- This production-project verifier expects pg_cron to be installed because it
-- also proves that the legacy snapshot job was removed and cleanup stayed on.
-- Also confirm in Supabase API settings that longos_private is NOT listed in
-- Exposed schemas.

with expected_policy(
  tablename,
  policyname,
  command,
  qual_normalized,
  with_check_normalized,
  qual_has_main_room,
  with_check_has_main_room,
  uses_private_helper
) as (
  values
    (
      'room_latest'::text,
      'room_latest_read'::text,
      'SELECT'::text,
      'room_id=''main-room'''::text,
      null::text,
      true,
      false,
      false
    ),
    (
      'room_latest',
      'room_latest_insert_device',
      'INSERT',
      null,
      'room_id=''main-room''ANDvalid_room_device_token',
      false,
      true,
      true
    ),
    (
      'room_latest',
      'room_latest_update_device',
      'UPDATE',
      'room_id=''main-room''ANDvalid_room_device_token',
      'room_id=''main-room''ANDvalid_room_device_token',
      true,
      true,
      true
    ),
    (
      'room_readings',
      'room_readings_read',
      'SELECT',
      'room_id=''main-room''',
      null,
      true,
      false,
      false
    ),
    (
      'room_readings',
      'room_readings_insert_device',
      'INSERT',
      null,
      'room_id=''main-room''ANDvalid_room_device_token',
      false,
      true,
      true
    )
),
actual_policy as (
  select
    policy.tablename,
    policy.policyname,
    policy.cmd as command,
    policy.permissive,
    policy.roles,
    case when policy.qual is null then null else
      pg_catalog.regexp_replace(
        pg_catalog.replace(
          pg_catalog.replace(policy.qual, '::text', ''),
          'longos_private.',
          ''
        ),
        '[[:space:]()]',
        '',
        'g'
      )
    end as qual_normalized,
    case when policy.with_check is null then null else
      pg_catalog.regexp_replace(
        pg_catalog.replace(
          pg_catalog.replace(policy.with_check, '::text', ''),
          'longos_private.',
          ''
        ),
        '[[:space:]()]',
        '',
        'g'
      )
    end as with_check_normalized,
    coalesce(pg_catalog.strpos(policy.qual, '''main-room''') > 0, false)
      as qual_has_main_room,
    coalesce(pg_catalog.strpos(policy.with_check, '''main-room''') > 0, false)
      as with_check_has_main_room,
    exists (
      select 1
      from pg_catalog.pg_depend dependency
      where dependency.classid = 'pg_catalog.pg_policy'::pg_catalog.regclass
        and dependency.objid = raw_policy.oid
        and dependency.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
        and dependency.refobjid = pg_catalog.to_regprocedure(
          'longos_private.valid_room_device_token()'
        )
    ) as uses_private_helper
  from pg_catalog.pg_policies policy
  join pg_catalog.pg_class relation
    on relation.relname = policy.tablename
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
    and namespace.nspname = policy.schemaname
  join pg_catalog.pg_policy raw_policy
    on raw_policy.polrelid = relation.oid
    and raw_policy.polname = policy.policyname
  where policy.schemaname = 'public'
    and policy.tablename in ('room_latest', 'room_readings')
),
policy_state as (
  select not exists (
    select 1
    from expected_policy expected
    full join actual_policy actual
      on actual.tablename = expected.tablename
      and actual.policyname = expected.policyname
    where expected.policyname is null
      or actual.policyname is null
      or actual.command is distinct from expected.command
      or actual.permissive is distinct from 'PERMISSIVE'
      or actual.roles is distinct from array['anon']::name[]
      or actual.qual_normalized is distinct from expected.qual_normalized
      or actual.with_check_normalized is distinct from expected.with_check_normalized
      or actual.qual_has_main_room is distinct from expected.qual_has_main_room
      or actual.with_check_has_main_room is distinct from expected.with_check_has_main_room
      or actual.uses_private_helper is distinct from expected.uses_private_helper
  ) as exact_policy_configuration
),
wanted_table_privilege(role_name, object_name, privilege_name, wanted) as (
  values
    ('anon'::text, 'public.room_latest'::text, 'SELECT'::text, true),
    ('anon', 'public.room_latest', 'INSERT', true),
    ('anon', 'public.room_latest', 'UPDATE', true),
    ('anon', 'public.room_latest', 'DELETE', false),
    ('anon', 'public.room_latest', 'TRUNCATE', false),
    ('anon', 'public.room_latest', 'REFERENCES', false),
    ('anon', 'public.room_latest', 'TRIGGER', false),
    ('anon', 'public.room_readings', 'SELECT', true),
    ('anon', 'public.room_readings', 'INSERT', true),
    ('anon', 'public.room_readings', 'UPDATE', false),
    ('anon', 'public.room_readings', 'DELETE', false),
    ('anon', 'public.room_readings', 'TRUNCATE', false),
    ('anon', 'public.room_readings', 'REFERENCES', false),
    ('anon', 'public.room_readings', 'TRIGGER', false),
    ('authenticated', 'public.room_latest', 'SELECT', false),
    ('authenticated', 'public.room_latest', 'INSERT', false),
    ('authenticated', 'public.room_latest', 'UPDATE', false),
    ('authenticated', 'public.room_latest', 'DELETE', false),
    ('authenticated', 'public.room_latest', 'TRUNCATE', false),
    ('authenticated', 'public.room_latest', 'REFERENCES', false),
    ('authenticated', 'public.room_latest', 'TRIGGER', false),
    ('authenticated', 'public.room_readings', 'SELECT', false),
    ('authenticated', 'public.room_readings', 'INSERT', false),
    ('authenticated', 'public.room_readings', 'UPDATE', false),
    ('authenticated', 'public.room_readings', 'DELETE', false),
    ('authenticated', 'public.room_readings', 'TRUNCATE', false),
    ('authenticated', 'public.room_readings', 'REFERENCES', false),
    ('authenticated', 'public.room_readings', 'TRIGGER', false)
),
privilege_state as (
  select
    not exists (
      select 1
      from wanted_table_privilege wanted
      where pg_catalog.has_table_privilege(
        wanted.role_name,
        wanted.object_name,
        wanted.privilege_name
      ) is distinct from wanted.wanted
    )
    and not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          relation.relacl,
          pg_catalog.acldefault('r', relation.relowner)
        )
      ) acl
      where namespace.nspname = 'public'
        and relation.relname in ('room_latest', 'room_readings')
        and acl.privilege_type in (
          'SELECT', 'INSERT', 'UPDATE', 'DELETE',
          'TRUNCATE', 'REFERENCES', 'TRIGGER'
        )
        and (
          acl.grantee = 0
          or (
            acl.grantee in (
              (select oid from pg_catalog.pg_roles where rolname = 'anon'),
              (select oid from pg_catalog.pg_roles where rolname = 'authenticated')
            )
            and acl.is_grantable
          )
        )
    ) as exact_table_privileges
),
rls_state as (
  select pg_catalog.count(*) = 2
    and pg_catalog.bool_and(relation.relrowsecurity) as both_tables_use_rls
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname in ('room_latest', 'room_readings')
),
managed_function as (
  select
    procedure.oid,
    namespace.nspname,
    procedure.proname,
    procedure.pronargs,
    procedure.proowner,
    owner.rolname as owner_name,
    procedure.prosecdef,
    procedure.provolatile,
    procedure.proconfig,
    procedure.proacl,
    procedure.prosrc,
    language.lanname,
    pg_catalog.pg_get_function_result(procedure.oid) as result_type
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  join pg_catalog.pg_roles owner
    on owner.oid = procedure.proowner
  join pg_catalog.pg_language language
    on language.oid = procedure.prolang
  where (namespace.nspname, procedure.proname) in (
    ('longos_private', 'valid_room_device_token'),
    ('longos_private', 'snapshot_room_reading'),
    ('public', 'set_room_latest_updated_at')
  )
),
function_state as (
  select
    not exists (
      select 1
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'valid_room_device_token'
    ) as public_token_rpc_removed,
    not exists (
      select 1
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'snapshot_room_reading'
    ) as public_snapshot_rpc_removed,
    not exists (
      select 1
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'valid_room_dashboard_token'
    ) as legacy_dashboard_rpc_removed,
    (
      select pg_catalog.count(*) = 1
        and pg_catalog.bool_and(
          function.pronargs = 0
          and function.owner_name = 'postgres'
          and function.prosecdef = false
          and function.provolatile = 's'
          and function.proconfig is not distinct from array['search_path=""']::text[]
          and function.lanname = 'sql'
          and function.result_type = 'boolean'
          and function.prosrc = $longos_token_source$
  select pg_catalog.encode(extensions.digest(coalesce(
    nullif(pg_catalog.current_setting('request.headers', true), '')::pg_catalog.json ->> 'x-device-token',
    ''
  ), 'sha256'), 'hex') = '3e3d040c85243da01de6bee6ea1193fdee6c0c61cdd9e5ca34a886c490255f9f';
$longos_token_source$
        )
      from managed_function function
      where function.nspname = 'longos_private'
        and function.proname = 'valid_room_device_token'
    ) as private_token_helper_definition,
    pg_catalog.to_regprocedure('longos_private.valid_room_device_token()') is not null
      and coalesce(pg_catalog.has_function_privilege(
        'anon',
        pg_catalog.to_regprocedure('longos_private.valid_room_device_token()'),
        'EXECUTE'
      ), false)
      and not coalesce(pg_catalog.has_function_privilege(
        'authenticated',
        pg_catalog.to_regprocedure('longos_private.valid_room_device_token()'),
        'EXECUTE'
      ), false)
      and not coalesce(pg_catalog.has_function_privilege(
        'service_role',
        pg_catalog.to_regprocedure('longos_private.valid_room_device_token()'),
        'EXECUTE'
      ), false)
      and not exists (
        select 1
        from managed_function function
        cross join lateral pg_catalog.aclexplode(
          coalesce(
            function.proacl,
            pg_catalog.acldefault('f', function.proowner)
          )
        ) acl
        where function.nspname = 'longos_private'
          and function.proname = 'valid_room_device_token'
          and acl.privilege_type = 'EXECUTE'
          and (
            acl.grantee = 0
            or (
              acl.grantee in (
                (select oid from pg_catalog.pg_roles where rolname = 'anon'),
                (select oid from pg_catalog.pg_roles where rolname = 'authenticated'),
                (select oid from pg_catalog.pg_roles where rolname = 'service_role')
              )
              and acl.is_grantable
            )
          )
      )
      as private_token_helper_acl,
    (
      select pg_catalog.count(*) = 1
        and pg_catalog.bool_and(
          function.pronargs = 0
          and function.owner_name = 'postgres'
          and function.prosecdef = false
          and function.provolatile = 'v'
          and function.proconfig is not distinct from array['search_path=""']::text[]
          and function.lanname = 'sql'
          and function.result_type = 'void'
          and function.prosrc = $longos_snapshot_source$
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
    pg_catalog.now(),
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
    and latest.updated_at > pg_catalog.now() - interval '90 seconds'
    and not exists (
      select 1
      from public.room_readings existing
      where existing.room_id = latest.room_id
        and existing.sensor_online = true
        and existing.recorded_at > pg_catalog.now() - interval '150 seconds'
    );
$longos_snapshot_source$
        )
      from managed_function function
      where function.nspname = 'longos_private'
        and function.proname = 'snapshot_room_reading'
    ) as private_snapshot_helper_definition,
    pg_catalog.to_regprocedure('longos_private.snapshot_room_reading()') is not null
      and not coalesce(pg_catalog.has_function_privilege(
        'anon',
        pg_catalog.to_regprocedure('longos_private.snapshot_room_reading()'),
        'EXECUTE'
      ), false)
      and not coalesce(pg_catalog.has_function_privilege(
        'authenticated',
        pg_catalog.to_regprocedure('longos_private.snapshot_room_reading()'),
        'EXECUTE'
      ), false)
      and not coalesce(pg_catalog.has_function_privilege(
        'service_role',
        pg_catalog.to_regprocedure('longos_private.snapshot_room_reading()'),
        'EXECUTE'
      ), false)
      and not exists (
        select 1
        from managed_function function
        cross join lateral pg_catalog.aclexplode(
          coalesce(
            function.proacl,
            pg_catalog.acldefault('f', function.proowner)
          )
        ) acl
        where function.nspname = 'longos_private'
          and function.proname = 'snapshot_room_reading'
          and acl.privilege_type = 'EXECUTE'
          and (
            acl.grantee = 0
            or (
              acl.grantee in (
                (select oid from pg_catalog.pg_roles where rolname = 'anon'),
                (select oid from pg_catalog.pg_roles where rolname = 'authenticated'),
                (select oid from pg_catalog.pg_roles where rolname = 'service_role')
              )
              and acl.is_grantable
            )
          )
      )
      as private_snapshot_helper_acl,
    (
      select pg_catalog.count(*) = 1
        and pg_catalog.bool_and(
          function.pronargs = 0
          and function.owner_name = 'postgres'
          and function.prosecdef = false
          and function.provolatile = 'v'
          and function.proconfig is not distinct from array['search_path=""']::text[]
          and function.lanname = 'plpgsql'
          and function.result_type = 'trigger'
          and function.prosrc = $longos_trigger_source$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$longos_trigger_source$
        )
      from managed_function function
      where function.nspname = 'public'
        and function.proname = 'set_room_latest_updated_at'
    ) as trigger_function_definition,
    pg_catalog.to_regprocedure('public.set_room_latest_updated_at()') is not null
      and not coalesce(pg_catalog.has_function_privilege(
        'anon',
        pg_catalog.to_regprocedure('public.set_room_latest_updated_at()'),
        'EXECUTE'
      ), false)
      and not coalesce(pg_catalog.has_function_privilege(
        'authenticated',
        pg_catalog.to_regprocedure('public.set_room_latest_updated_at()'),
        'EXECUTE'
      ), false)
      and not coalesce(pg_catalog.has_function_privilege(
        'service_role',
        pg_catalog.to_regprocedure('public.set_room_latest_updated_at()'),
        'EXECUTE'
      ), false)
      and not exists (
        select 1
        from managed_function function
        cross join lateral pg_catalog.aclexplode(
          coalesce(
            function.proacl,
            pg_catalog.acldefault('f', function.proowner)
          )
        ) acl
        where function.nspname = 'public'
          and function.proname = 'set_room_latest_updated_at'
          and acl.privilege_type = 'EXECUTE'
          and (
            acl.grantee = 0
            or (
              acl.grantee in (
                (select oid from pg_catalog.pg_roles where rolname = 'anon'),
                (select oid from pg_catalog.pg_roles where rolname = 'authenticated'),
                (select oid from pg_catalog.pg_roles where rolname = 'service_role')
              )
              and acl.is_grantable
            )
          )
      )
      as trigger_function_not_rpc
),
trigger_state as (
  select pg_catalog.count(*) = 1
    and pg_catalog.bool_and(
      trigger.tgenabled = 'O'
      and trigger.tgisinternal = false
      and trigger.tgtype = 23
      and trigger.tgfoid = pg_catalog.to_regprocedure(
        'public.set_room_latest_updated_at()'
      )
    ) as exact_updated_at_trigger
  from pg_catalog.pg_trigger trigger
  join pg_catalog.pg_class relation
    on relation.oid = trigger.tgrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = 'room_latest'
    and trigger.tgname = 'set_room_latest_updated_at'
),
wanted_sequence_privilege(role_name, privilege_name, wanted) as (
  values
    ('anon'::text, 'USAGE'::text, true),
    ('anon', 'SELECT', false),
    ('anon', 'UPDATE', false),
    ('authenticated', 'USAGE', false),
    ('authenticated', 'SELECT', false),
    ('authenticated', 'UPDATE', false)
),
sequence_state as (
  select
    pg_catalog.to_regclass('public.room_readings_id_seq') is not null
    and not exists (
      select 1
      from wanted_sequence_privilege wanted
      where pg_catalog.has_sequence_privilege(
        wanted.role_name,
        pg_catalog.to_regclass('public.room_readings_id_seq'),
        wanted.privilege_name
      ) is distinct from wanted.wanted
    )
    and not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          relation.relacl,
          pg_catalog.acldefault('s', relation.relowner)
        )
      ) acl
      where namespace.nspname = 'public'
        and relation.relname = 'room_readings_id_seq'
        and acl.privilege_type in ('USAGE', 'SELECT', 'UPDATE')
        and (
          acl.grantee = 0
          or (
            acl.grantee in (
              (select oid from pg_catalog.pg_roles where rolname = 'anon'),
              (select oid from pg_catalog.pg_roles where rolname = 'authenticated')
            )
            and acl.is_grantable
          )
        )
    ) as exact_sequence_privileges
),
schema_state as (
  select
    pg_catalog.has_schema_privilege('anon', 'public', 'USAGE')
    and not pg_catalog.has_schema_privilege('anon', 'public', 'CREATE')
    and not pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE')
    and not pg_catalog.has_schema_privilege('service_role', 'public', 'CREATE')
      as public_schema_create_locked,
    (
      select pg_catalog.count(*) = 1
        and pg_catalog.bool_and(owner.rolname = 'postgres')
      from pg_catalog.pg_namespace namespace
      join pg_catalog.pg_roles owner
        on owner.oid = namespace.nspowner
      where namespace.nspname = 'longos_private'
    )
    and pg_catalog.has_schema_privilege('anon', 'longos_private', 'USAGE')
    and not pg_catalog.has_schema_privilege('anon', 'longos_private', 'CREATE')
    and not pg_catalog.has_schema_privilege('authenticated', 'longos_private', 'USAGE')
    and not pg_catalog.has_schema_privilege('authenticated', 'longos_private', 'CREATE')
    and not pg_catalog.has_schema_privilege('service_role', 'longos_private', 'USAGE')
    and not pg_catalog.has_schema_privilege('service_role', 'longos_private', 'CREATE')
    and not exists (
      select 1
      from pg_catalog.pg_namespace namespace
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          namespace.nspacl,
          pg_catalog.acldefault('n', namespace.nspowner)
        )
      ) acl
      where namespace.nspname = 'longos_private'
        and acl.grantee <> namespace.nspowner
        and not (
          acl.grantee = (
            select role.oid
            from pg_catalog.pg_roles role
            where role.rolname = 'anon'
          )
          and acl.privilege_type = 'USAGE'
          and acl.is_grantable = false
        )
    ) as private_schema_acl,
    pg_catalog.has_schema_privilege('anon', 'extensions', 'USAGE')
    and coalesce(pg_catalog.has_function_privilege(
      'anon',
      pg_catalog.to_regprocedure('extensions.digest(text,text)'),
      'EXECUTE'
    ), false) as token_hash_dependency_acl
),
cron_state as (
  select
    not exists (
      select 1
      from cron.job
      where jobname = 'autohome-snapshot'
    ) as legacy_snapshot_disabled,
    (
      select pg_catalog.count(*) = 1
        and pg_catalog.bool_and(
          active
          and schedule = '17 3 * * *'
          and pg_catalog.regexp_replace(
            pg_catalog.lower(command),
            '[[:space:];]',
            '',
            'g'
          ) = 'deletefrompublic.room_readingswhererecorded_at<now()-interval''90days'''
        )
      from cron.job
      where jobname = 'autohome-cleanup'
        and database = pg_catalog.current_database()
    ) as cleanup_job_present
),
default_acl_state as (
  select
    exists (
      select 1
      from pg_catalog.pg_default_acl defaults
      where defaults.defaclrole = (
        select role.oid
        from pg_catalog.pg_roles role
        where role.rolname = 'postgres'
      )
        and defaults.defaclnamespace = 0
        and defaults.defaclobjtype = 'f'
    )
    and not exists (
      select 1
      from pg_catalog.pg_default_acl defaults
      cross join lateral pg_catalog.aclexplode(defaults.defaclacl) acl
      where defaults.defaclrole = (
        select role.oid
        from pg_catalog.pg_roles role
        where role.rolname = 'postgres'
      )
        and defaults.defaclobjtype = 'f'
        and defaults.defaclnamespace in (
          0,
          (
            select namespace.oid
            from pg_catalog.pg_namespace namespace
            where namespace.nspname = 'public'
          )
        )
        and acl.privilege_type = 'EXECUTE'
        and acl.grantee in (
          0,
          (
            select role.oid
            from pg_catalog.pg_roles role
            where role.rolname = 'anon'
          ),
          (
            select role.oid
            from pg_catalog.pg_roles role
            where role.rolname = 'authenticated'
          ),
          (
            select role.oid
            from pg_catalog.pg_roles role
            where role.rolname = 'service_role'
          )
        )
    ) as future_untrusted_function_execute_revoked
)
select
  case when
    policy_state.exact_policy_configuration
    and privilege_state.exact_table_privileges
    and rls_state.both_tables_use_rls
    and function_state.public_token_rpc_removed
    and function_state.public_snapshot_rpc_removed
    and function_state.legacy_dashboard_rpc_removed
    and function_state.private_token_helper_definition
    and function_state.private_token_helper_acl
    and function_state.private_snapshot_helper_definition
    and function_state.private_snapshot_helper_acl
    and function_state.trigger_function_definition
    and function_state.trigger_function_not_rpc
    and trigger_state.exact_updated_at_trigger
    and sequence_state.exact_sequence_privileges
    and schema_state.public_schema_create_locked
    and schema_state.private_schema_acl
    and schema_state.token_hash_dependency_acl
    and cron_state.legacy_snapshot_disabled
    and cron_state.cleanup_job_present
    and default_acl_state.future_untrusted_function_execute_revoked
  then 'PASS' else 'FAIL' end as longos_security_result,
  policy_state.*,
  privilege_state.*,
  rls_state.*,
  function_state.*,
  trigger_state.*,
  sequence_state.*,
  schema_state.*,
  cron_state.*,
  default_acl_state.*
from policy_state
cross join privilege_state
cross join rls_state
cross join function_state
cross join trigger_state
cross join sequence_state
cross join schema_state
cross join cron_state
cross join default_acl_state;
