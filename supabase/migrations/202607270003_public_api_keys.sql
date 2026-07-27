-- MailFlow Studio: organization API keys, scopes, atomic rate limiting and request audit.

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default '{}'::text[],
  status text not null default 'active',
  rate_limit_per_minute integer not null default 120,
  allowed_ips inet[] not null default '{}'::inet[],
  expires_at timestamptz,
  last_used_at timestamptz,
  last_used_ip inet,
  usage_count bigint not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint api_keys_name_not_blank check (length(trim(name)) > 0),
  constraint api_keys_prefix_format
    check (key_prefix ~ '^mfs_(live|test)_[A-Za-z0-9_-]{6,24}$'),
  constraint api_keys_hash_format check (key_hash ~ '^[a-f0-9]{64}$'),
  constraint api_keys_status_check check (status in ('active', 'revoked')),
  constraint api_keys_rate_limit_check
    check (rate_limit_per_minute between 1 and 5000),
  constraint api_keys_usage_count_check check (usage_count >= 0),
  constraint api_keys_expiry_check
    check (expires_at is null or expires_at > created_at)
);

create index api_keys_organization_created_idx
  on public.api_keys (organization_id, created_at desc);
create index api_keys_active_idx
  on public.api_keys (organization_id, status, expires_at)
  where status = 'active';

create table private.api_rate_limit_buckets (
  api_key_id uuid not null references public.api_keys(id) on delete cascade,
  bucket_start timestamptz not null,
  request_count integer not null default 0,
  primary key (api_key_id, bucket_start),
  constraint api_rate_limit_count_check check (request_count >= 0)
);

create index api_rate_limit_buckets_cleanup_idx
  on private.api_rate_limit_buckets (bucket_start);

create table public.api_request_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  api_key_id uuid references public.api_keys(id) on delete set null,
  request_id uuid not null,
  method text not null,
  path text not null,
  status_code integer not null,
  duration_ms integer not null default 0,
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint api_request_logs_method_check
    check (method in ('GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS')),
  constraint api_request_logs_status_check
    check (status_code between 100 and 599),
  constraint api_request_logs_duration_check check (duration_ms >= 0)
);

create index api_request_logs_organization_created_idx
  on public.api_request_logs (organization_id, created_at desc, id desc);
create index api_request_logs_key_created_idx
  on public.api_request_logs (api_key_id, created_at desc)
  where api_key_id is not null;
create index api_request_logs_errors_idx
  on public.api_request_logs (organization_id, created_at desc)
  where status_code >= 400;

create or replace function public.authorize_api_key(
  candidate_hash text,
  requested_scope text,
  source_ip inet default null
)
returns table (
  authorized boolean,
  reason text,
  api_key_id uuid,
  organization_id uuid,
  api_key_name text,
  api_key_scopes text[],
  remaining integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  key_record public.api_keys%rowtype;
  current_bucket timestamptz := date_trunc('minute', now());
  next_count integer;
begin
  select *
  into key_record
  from public.api_keys key_row
  where key_row.key_hash = candidate_hash
  for update;

  if not found or key_record.status <> 'active' then
    return query
      select false, 'invalid_key', null::uuid, null::uuid, null::text,
        null::text[], 0, current_bucket + interval '1 minute';
    return;
  end if;

  if key_record.expires_at is not null and key_record.expires_at <= now() then
    return query
      select false, 'expired', key_record.id, key_record.organization_id,
        key_record.name, key_record.scopes, 0,
        current_bucket + interval '1 minute';
    return;
  end if;

  if cardinality(key_record.allowed_ips) > 0 and (
    source_ip is null or not exists (
      select 1
      from unnest(key_record.allowed_ips) allowed_network
      where source_ip <<= allowed_network
    )
  ) then
    return query
      select false, 'ip_not_allowed', key_record.id,
        key_record.organization_id, key_record.name, key_record.scopes, 0,
        current_bucket + interval '1 minute';
    return;
  end if;

  if requested_scope <> '' and not (
    requested_scope = any(key_record.scopes)
    or '*' = any(key_record.scopes)
  ) then
    return query
      select false, 'scope_missing', key_record.id,
        key_record.organization_id, key_record.name, key_record.scopes, 0,
        current_bucket + interval '1 minute';
    return;
  end if;

  insert into private.api_rate_limit_buckets (
    api_key_id,
    bucket_start,
    request_count
  )
  values (key_record.id, current_bucket, 1)
  on conflict on constraint api_rate_limit_buckets_pkey
  do update
    set request_count = private.api_rate_limit_buckets.request_count + 1
    where private.api_rate_limit_buckets.request_count
      < key_record.rate_limit_per_minute
  returning request_count into next_count;

  if next_count is null then
    return query
      select false, 'rate_limit_exceeded', key_record.id,
        key_record.organization_id, key_record.name, key_record.scopes, 0,
        current_bucket + interval '1 minute';
    return;
  end if;

  update public.api_keys
  set
    last_used_at = now(),
    last_used_ip = source_ip,
    usage_count = usage_count + 1
  where id = key_record.id;

  return query
    select true, 'ok', key_record.id, key_record.organization_id,
      key_record.name, key_record.scopes,
      greatest(key_record.rate_limit_per_minute - next_count, 0),
      current_bucket + interval '1 minute';
end;
$$;

create or replace function public.cleanup_api_history(
  request_log_retention_days integer default 90,
  rate_bucket_retention_hours integer default 24
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_logs bigint;
  deleted_buckets bigint;
begin
  delete from public.api_request_logs
  where created_at < now() - make_interval(days => greatest(request_log_retention_days, 1));
  get diagnostics deleted_logs = row_count;

  delete from private.api_rate_limit_buckets
  where bucket_start
    < now() - make_interval(hours => greatest(rate_bucket_retention_hours, 1));
  get diagnostics deleted_buckets = row_count;

  return jsonb_build_object(
    'deleted_request_logs', deleted_logs,
    'deleted_rate_buckets', deleted_buckets
  );
end;
$$;

revoke all on function public.authorize_api_key(text, text, inet) from public;
revoke all on function public.cleanup_api_history(integer, integer) from public;
grant execute on function public.authorize_api_key(text, text, inet) to service_role;
grant execute on function public.cleanup_api_history(integer, integer) to service_role;

create trigger api_keys_set_updated_at
before update on public.api_keys
for each row execute function public.set_updated_at();

alter table public.api_keys enable row level security;
alter table public.api_request_logs enable row level security;

-- API key hashes and raw request logs are intentionally unavailable through
-- the browser Supabase client. They are exposed only through the authenticated
-- Admin API, which strips hashes and enforces per-organization permissions.
revoke all on public.api_keys from anon, authenticated;
revoke all on public.api_request_logs from anon, authenticated;

update public.organization_roles
set permissions = (
  select array_agg(distinct permission order by permission)
  from unnest(
    permissions ||
    case
      when key in ('owner', 'admin')
        then array['api_keys.view', 'api_keys.manage']::text[]
      when key = 'operator'
        then array['api_keys.view']::text[]
      else '{}'::text[]
    end
  ) permission
);

create or replace function public.seed_organization_roles(target_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_key text;
  role_permissions text[];
begin
  foreach role_key in array array['owner','admin','operator','reviewer','viewer'] loop
    role_permissions := public.default_role_permissions(role_key);
    if role_key in ('owner', 'admin') then
      role_permissions := role_permissions ||
        array['api_keys.view', 'api_keys.manage']::text[];
    elsif role_key = 'operator' then
      role_permissions := role_permissions || array['api_keys.view']::text[];
    end if;

    insert into public.organization_roles (
      organization_id,
      key,
      name,
      description,
      color,
      built_in,
      permissions
    )
    values (
      target_organization_id,
      role_key,
      case role_key
        when 'owner' then 'Właściciel'
        when 'admin' then 'Administrator'
        when 'operator' then 'Operator'
        when 'reviewer' then 'Recenzent'
        else 'Obserwator'
      end,
      'Wbudowana rola systemowa',
      case role_key
        when 'owner' then '#0f766e'
        when 'admin' then '#1d4ed8'
        when 'operator' then '#7c3aed'
        when 'reviewer' then '#b45309'
        else '#64748b'
      end,
      true,
      role_permissions
    )
    on conflict (organization_id, key)
    do update set
      permissions = (
        select array_agg(distinct permission order by permission)
        from unnest(
          public.organization_roles.permissions || excluded.permissions
        ) permission
      );
  end loop;
end;
$$;
