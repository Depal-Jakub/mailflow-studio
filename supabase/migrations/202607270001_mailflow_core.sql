-- MailFlow Studio: universal email ingestion, classification and automation.

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'Europe/Warsaw',
  locale text not null default 'pl-PL',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_not_blank check (length(trim(name)) > 0),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$')
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  timezone text not null default 'Europe/Warsaw',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'viewer',
  status text not null default 'active',
  invited_by uuid references public.profiles(id) on delete set null,
  invited_at timestamptz,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  constraint organization_members_role_check
    check (role in ('owner', 'admin', 'operator', 'reviewer', 'viewer')),
  constraint organization_members_status_check
    check (status in ('invited', 'active', 'suspended'))
);

create index organization_members_user_id_idx
  on public.organization_members (user_id, organization_id);
create index organization_members_invited_by_idx
  on public.organization_members (invited_by)
  where invited_by is not null;

create or replace function public.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  );
$$;

create or replace function public.has_org_role(
  target_organization_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and membership.role = any(allowed_roles)
  );
$$;

create or replace function public.shares_organization(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs
      on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid())
      and mine.status = 'active'
      and theirs.user_id = target_user_id
      and theirs.status in ('active', 'invited')
  );
$$;

revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.has_org_role(uuid, text[]) from public;
revoke all on function public.shares_organization(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, text[]) to authenticated;
grant execute on function public.shares_organization(uuid) to authenticated;

create table public.source_connectors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  type text not null,
  name text not null,
  address text,
  status text not null default 'paused',
  sync_interval_minutes integer not null default 5,
  sync_cursor text,
  folders text[] not null default '{}'::text[],
  public_config jsonb not null default '{}'::jsonb,
  credentials_version integer not null default 1,
  last_sync_at timestamptz,
  next_sync_at timestamptz,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_connectors_type_check
    check (type in ('gmail', 'outlook', 'imap', 'webhook', 'scraper', 'rss')),
  constraint source_connectors_status_check
    check (status in ('active', 'warning', 'error', 'paused')),
  constraint source_connectors_interval_check
    check (sync_interval_minutes between 1 and 10080),
  constraint source_connectors_name_not_blank check (length(trim(name)) > 0)
);

create index source_connectors_organization_id_idx
  on public.source_connectors (organization_id, status, type);
create index source_connectors_created_by_idx
  on public.source_connectors (created_by)
  where created_by is not null;
create index source_connectors_due_idx
  on public.source_connectors (next_sync_at)
  where status in ('active', 'warning');

create table public.delivery_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_connector_id uuid references public.source_connectors(id) on delete set null,
  provider text not null,
  name text not null,
  from_email text not null,
  from_name text,
  reply_to text,
  status text not null default 'paused',
  daily_limit integer not null default 1000,
  hourly_limit integer not null default 200,
  public_config jsonb not null default '{}'::jsonb,
  credentials_version integer not null default 1,
  sent_today integer not null default 0,
  last_reset_at timestamptz not null default now(),
  last_test_at timestamptz,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_accounts_provider_check
    check (provider in ('gmail', 'outlook', 'smtp', 'ses', 'sendgrid', 'resend')),
  constraint delivery_accounts_status_check
    check (status in ('active', 'warning', 'error', 'paused')),
  constraint delivery_accounts_daily_limit_check check (daily_limit > 0),
  constraint delivery_accounts_hourly_limit_check check (hourly_limit > 0),
  constraint delivery_accounts_from_email_check check (position('@' in from_email) > 1)
);

create index delivery_accounts_organization_id_idx
  on public.delivery_accounts (organization_id, status);
create index delivery_accounts_source_connector_id_idx
  on public.delivery_accounts (source_connector_id)
  where source_connector_id is not null;
create index delivery_accounts_created_by_idx
  on public.delivery_accounts (created_by)
  where created_by is not null;

create table private.connector_secrets (
  source_connector_id uuid primary key
    references public.source_connectors(id) on delete cascade,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  encrypted_payload text not null,
  encryption_version integer not null default 1,
  rotated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connector_secrets_version_check check (encryption_version > 0)
);

create index connector_secrets_organization_id_idx
  on private.connector_secrets (organization_id);

create table private.delivery_account_secrets (
  delivery_account_id uuid primary key
    references public.delivery_accounts(id) on delete cascade,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  encrypted_payload text not null,
  encryption_version integer not null default 1,
  rotated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_account_secrets_version_check check (encryption_version > 0)
);

create index delivery_account_secrets_organization_id_idx
  on private.delivery_account_secrets (organization_id);

revoke all on private.connector_secrets from public, anon, authenticated;
revoke all on private.delivery_account_secrets from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update, delete on private.connector_secrets to service_role;
grant select, insert, update, delete on private.delivery_account_secrets to service_role;

create or replace function public.store_connector_secret(
  target_connector_id uuid,
  target_organization_id uuid,
  encrypted_secret text,
  secret_version integer default 1
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.connector_secrets (
    source_connector_id,
    organization_id,
    encrypted_payload,
    encryption_version,
    rotated_at
  )
  values (
    target_connector_id,
    target_organization_id,
    encrypted_secret,
    secret_version,
    now()
  )
  on conflict (source_connector_id)
  do update set
    encrypted_payload = excluded.encrypted_payload,
    encryption_version = excluded.encryption_version,
    rotated_at = now(),
    updated_at = now();
$$;

create or replace function public.store_delivery_account_secret(
  target_delivery_account_id uuid,
  target_organization_id uuid,
  encrypted_secret text,
  secret_version integer default 1
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.delivery_account_secrets (
    delivery_account_id,
    organization_id,
    encrypted_payload,
    encryption_version,
    rotated_at
  )
  values (
    target_delivery_account_id,
    target_organization_id,
    encrypted_secret,
    secret_version,
    now()
  )
  on conflict (delivery_account_id)
  do update set
    encrypted_payload = excluded.encrypted_payload,
    encryption_version = excluded.encryption_version,
    rotated_at = now(),
    updated_at = now();
$$;

create or replace function public.get_connector_secret(target_connector_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encrypted_payload
  from private.connector_secrets
  where source_connector_id = target_connector_id;
$$;

create or replace function public.get_delivery_account_secret(
  target_delivery_account_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encrypted_payload
  from private.delivery_account_secrets
  where delivery_account_id = target_delivery_account_id;
$$;

revoke all on function public.store_connector_secret(uuid, uuid, text, integer) from public;
revoke all on function public.store_delivery_account_secret(uuid, uuid, text, integer) from public;
revoke all on function public.get_connector_secret(uuid) from public;
revoke all on function public.get_delivery_account_secret(uuid) from public;
grant execute on function public.store_connector_secret(uuid, uuid, text, integer) to service_role;
grant execute on function public.store_delivery_account_secret(uuid, uuid, text, integer) to service_role;
grant execute on function public.get_connector_secret(uuid) to service_role;
grant execute on function public.get_delivery_account_secret(uuid) to service_role;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  color text not null default '#64748b',
  icon text,
  default_score smallint not null default 0,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_name_not_blank check (length(trim(name)) > 0),
  constraint categories_score_check check (default_score between -100 and 100),
  constraint categories_color_check check (color ~ '^#[0-9a-fA-F]{6}$'),
  unique (organization_id, slug)
);

create index categories_organization_id_idx
  on public.categories (organization_id, active, name);
create index categories_created_by_idx
  on public.categories (created_by)
  where created_by is not null;

create table public.rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  category_id uuid references public.categories(id) on delete set null,
  priority integer not null default 50,
  active boolean not null default false,
  current_version integer not null default 1,
  hit_count bigint not null default 0,
  last_hit_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rules_name_not_blank check (length(trim(name)) > 0),
  constraint rules_priority_check check (priority between 0 and 1000),
  constraint rules_version_check check (current_version > 0)
);

create index rules_organization_id_idx
  on public.rules (organization_id, active, priority desc);
create index rules_category_id_idx on public.rules (category_id)
  where category_id is not null;
create index rules_created_by_idx on public.rules (created_by)
  where created_by is not null;
create index rules_updated_by_idx on public.rules (updated_by)
  where updated_by is not null;

create table public.rule_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_id uuid not null references public.rules(id) on delete cascade,
  version integer not null,
  match_mode text not null default 'all',
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint rule_versions_version_check check (version > 0),
  constraint rule_versions_match_mode_check check (match_mode in ('all', 'any')),
  constraint rule_versions_conditions_array check (jsonb_typeof(conditions) = 'array'),
  constraint rule_versions_actions_array check (jsonb_typeof(actions) = 'array'),
  unique (rule_id, version)
);

create index rule_versions_organization_id_idx
  on public.rule_versions (organization_id, created_at desc);
create index rule_versions_rule_id_idx
  on public.rule_versions (rule_id, version desc);
create index rule_versions_created_by_idx
  on public.rule_versions (created_by)
  where created_by is not null;
create index rule_versions_conditions_gin_idx
  on public.rule_versions using gin (conditions jsonb_path_ops);
create index rule_versions_actions_gin_idx
  on public.rule_versions using gin (actions jsonb_path_ops);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_connector_id uuid references public.source_connectors(id) on delete set null,
  external_id text,
  thread_id text,
  direction text not null default 'incoming',
  sender_email text not null,
  sender_name text,
  recipients jsonb not null default '[]'::jsonb,
  subject text not null default '',
  preview text,
  body_text text,
  body_html text,
  headers jsonb not null default '{}'::jsonb,
  received_at timestamptz not null,
  status text not null default 'new',
  category_id uuid references public.categories(id) on delete set null,
  score smallint not null default 0,
  review_reason text,
  review_assignee_id uuid references public.profiles(id) on delete set null,
  tags text[] not null default '{}'::text[],
  dedupe_hash text,
  claimed_by text,
  claimed_at timestamptz,
  processed_at timestamptz,
  failed_at timestamptz,
  error_message text,
  search_vector tsvector generated always as (
    to_tsvector(
      'simple',
      coalesce(subject, '') || ' ' ||
      coalesce(sender_email, '') || ' ' ||
      coalesce(body_text, '')
    )
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint messages_direction_check check (direction in ('incoming', 'outgoing')),
  constraint messages_status_check
    check (status in ('new', 'processing', 'classified', 'review', 'automated', 'failed', 'archived')),
  constraint messages_score_check check (score between 0 and 100),
  constraint messages_recipients_array check (jsonb_typeof(recipients) = 'array')
);

create unique index messages_source_external_unique_idx
  on public.messages (organization_id, source_connector_id, external_id)
  where external_id is not null and source_connector_id is not null;
create unique index messages_dedupe_hash_unique_idx
  on public.messages (organization_id, dedupe_hash)
  where dedupe_hash is not null;
create index messages_organization_received_idx
  on public.messages (organization_id, received_at desc, id desc);
create index messages_queue_idx
  on public.messages (organization_id, created_at, id)
  where status = 'new';
create index messages_review_queue_idx
  on public.messages (organization_id, score desc, received_at desc)
  where status = 'review';
create index messages_category_received_idx
  on public.messages (category_id, received_at desc)
  where category_id is not null;
create index messages_source_received_idx
  on public.messages (source_connector_id, received_at desc)
  where source_connector_id is not null;
create index messages_review_assignee_idx
  on public.messages (review_assignee_id, received_at desc)
  where review_assignee_id is not null;
create index messages_search_vector_idx
  on public.messages using gin (search_vector);
create index messages_tags_idx
  on public.messages using gin (tags);

create table public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  external_id text,
  filename text not null,
  content_type text,
  size_bytes bigint not null default 0,
  storage_bucket text,
  storage_path text,
  extracted_text text,
  extraction_status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint message_attachments_size_check check (size_bytes >= 0),
  constraint message_attachments_status_check
    check (extraction_status in ('pending', 'processing', 'complete', 'failed', 'skipped'))
);

create index message_attachments_organization_id_idx
  on public.message_attachments (organization_id, created_at desc);
create index message_attachments_message_id_idx
  on public.message_attachments (message_id);
create index message_attachments_pending_idx
  on public.message_attachments (created_at, id)
  where extraction_status = 'pending';

create table public.message_rule_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  rule_id uuid not null references public.rules(id) on delete cascade,
  rule_version integer not null,
  matched boolean not null,
  score_delta integer not null default 0,
  condition_results jsonb not null default '[]'::jsonb,
  actions_executed jsonb not null default '[]'::jsonb,
  evaluated_at timestamptz not null default now(),
  constraint message_rule_matches_results_array
    check (jsonb_typeof(condition_results) = 'array'),
  constraint message_rule_matches_actions_array
    check (jsonb_typeof(actions_executed) = 'array'),
  unique (message_id, rule_id, rule_version)
);

create index message_rule_matches_organization_id_idx
  on public.message_rule_matches (organization_id, evaluated_at desc);
create index message_rule_matches_message_id_idx
  on public.message_rule_matches (message_id, evaluated_at);
create index message_rule_matches_rule_id_idx
  on public.message_rule_matches (rule_id, evaluated_at desc);

create table public.scrape_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_connector_id uuid references public.source_connectors(id) on delete set null,
  message_id uuid references public.messages(id) on delete cascade,
  url text not null,
  status text not null default 'pending',
  priority integer not null default 50,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  scheduled_at timestamptz not null default now(),
  claimed_by text,
  claimed_at timestamptz,
  completed_at timestamptz,
  response_status integer,
  content_hash text,
  extracted_title text,
  extracted_text text,
  metadata jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scrape_jobs_status_check
    check (status in ('pending', 'processing', 'complete', 'failed', 'cancelled')),
  constraint scrape_jobs_attempt_check
    check (attempt_count >= 0 and max_attempts between 1 and 20),
  constraint scrape_jobs_priority_check check (priority between 0 and 1000)
);

create index scrape_jobs_organization_id_idx
  on public.scrape_jobs (organization_id, created_at desc);
create index scrape_jobs_source_connector_id_idx
  on public.scrape_jobs (source_connector_id)
  where source_connector_id is not null;
create index scrape_jobs_message_id_idx
  on public.scrape_jobs (message_id)
  where message_id is not null;
create index scrape_jobs_pending_idx
  on public.scrape_jobs (priority desc, scheduled_at, id)
  where status = 'pending';

create table public.automations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  trigger_type text not null,
  trigger_config jsonb not null default '{}'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  active boolean not null default false,
  version integer not null default 1,
  run_count bigint not null default 0,
  success_count bigint not null default 0,
  failure_count bigint not null default 0,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automations_name_not_blank check (length(trim(name)) > 0),
  constraint automations_trigger_type_check
    check (trigger_type in ('message_ingested', 'message_classified', 'schedule', 'webhook', 'manual')),
  constraint automations_steps_array check (jsonb_typeof(steps) = 'array'),
  constraint automations_version_check check (version > 0)
);

create index automations_organization_id_idx
  on public.automations (organization_id, active, trigger_type);
create index automations_due_idx
  on public.automations (next_run_at)
  where active and next_run_at is not null;
create index automations_created_by_idx
  on public.automations (created_by)
  where created_by is not null;
create index automations_updated_by_idx
  on public.automations (updated_by)
  where updated_by is not null;

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  automation_id uuid not null references public.automations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  status text not null default 'pending',
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  current_step integer not null default 0,
  attempt_count integer not null default 0,
  claimed_by text,
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  constraint automation_runs_status_check
    check (status in ('pending', 'processing', 'complete', 'failed', 'cancelled')),
  constraint automation_runs_step_check check (current_step >= 0),
  constraint automation_runs_attempt_check check (attempt_count >= 0)
);

create index automation_runs_organization_id_idx
  on public.automation_runs (organization_id, created_at desc);
create index automation_runs_automation_id_idx
  on public.automation_runs (automation_id, created_at desc);
create index automation_runs_message_id_idx
  on public.automation_runs (message_id)
  where message_id is not null;
create index automation_runs_pending_idx
  on public.automation_runs (created_at, id)
  where status = 'pending';

create table public.action_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  rule_id uuid references public.rules(id) on delete set null,
  action_type text not null,
  action_config jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  priority integer not null default 50,
  scheduled_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  claimed_by text,
  claimed_at timestamptz,
  completed_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint action_jobs_type_check
    check (
      action_type in (
        'forward_smtp',
        'send_webhook',
        'create_task',
        'notify_team',
        'send_email',
        'custom'
      )
    ),
  constraint action_jobs_status_check
    check (status in ('pending', 'processing', 'complete', 'failed', 'cancelled')),
  constraint action_jobs_priority_check check (priority between 0 and 1000),
  constraint action_jobs_attempt_check
    check (attempt_count >= 0 and max_attempts between 1 and 20),
  constraint action_jobs_config_object check (jsonb_typeof(action_config) = 'object'),
  constraint action_jobs_result_object check (jsonb_typeof(result) = 'object')
);

create index action_jobs_organization_created_idx
  on public.action_jobs (organization_id, created_at desc);
create index action_jobs_message_id_idx
  on public.action_jobs (message_id)
  where message_id is not null;
create index action_jobs_rule_id_idx
  on public.action_jobs (rule_id)
  where rule_id is not null;
create index action_jobs_pending_idx
  on public.action_jobs (priority desc, scheduled_at, id)
  where status = 'pending';

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  kind text not null default 'email',
  subject_template text,
  text_template text,
  html_template text,
  variables jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  version integer not null default 1,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint templates_kind_check check (kind in ('email', 'webhook', 'task')),
  constraint templates_variables_array check (jsonb_typeof(variables) = 'array'),
  constraint templates_version_check check (version > 0)
);

create index templates_organization_id_idx
  on public.templates (organization_id, active, kind);
create index templates_created_by_idx
  on public.templates (created_by)
  where created_by is not null;
create index templates_updated_by_idx
  on public.templates (updated_by)
  where updated_by is not null;

create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  delivery_account_id uuid references public.delivery_accounts(id) on delete set null,
  template_id uuid references public.templates(id) on delete set null,
  source_message_id uuid references public.messages(id) on delete set null,
  subject text not null,
  text_body text,
  html_body text,
  audience_definition jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  scheduled_at timestamptz,
  claimed_by text,
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  recipient_count integer not null default 0,
  delivered_count integer not null default 0,
  failed_count integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbound_messages_status_check
    check (status in ('draft', 'scheduled', 'pending', 'processing', 'sent', 'partial', 'failed', 'cancelled')),
  constraint outbound_messages_counts_check
    check (
      recipient_count >= 0 and delivered_count >= 0 and failed_count >= 0
      and delivered_count + failed_count <= recipient_count
    )
);

create index outbound_messages_organization_id_idx
  on public.outbound_messages (organization_id, created_at desc);
create index outbound_messages_delivery_account_id_idx
  on public.outbound_messages (delivery_account_id)
  where delivery_account_id is not null;
create index outbound_messages_template_id_idx
  on public.outbound_messages (template_id)
  where template_id is not null;
create index outbound_messages_source_message_id_idx
  on public.outbound_messages (source_message_id)
  where source_message_id is not null;
create index outbound_messages_created_by_idx
  on public.outbound_messages (created_by)
  where created_by is not null;
create index outbound_messages_pending_idx
  on public.outbound_messages (scheduled_at, created_at, id)
  where status in ('scheduled', 'pending');

create table public.outbound_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  outbound_message_id uuid not null references public.outbound_messages(id) on delete cascade,
  email text not null,
  name text,
  variables jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  provider_message_id text,
  attempt_count integer not null default 0,
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  failed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  constraint outbound_recipients_status_check
    check (status in ('pending', 'processing', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed', 'skipped')),
  constraint outbound_recipients_attempt_check check (attempt_count >= 0),
  unique (outbound_message_id, email)
);

create index outbound_recipients_organization_id_idx
  on public.outbound_recipients (organization_id, created_at desc);
create index outbound_recipients_message_status_idx
  on public.outbound_recipients (outbound_message_id, status);
create index outbound_recipients_pending_idx
  on public.outbound_recipients (created_at, id)
  where status = 'pending';
create index outbound_recipients_email_idx
  on public.outbound_recipients (organization_id, lower(email));

create table public.connector_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_connector_id uuid not null references public.source_connectors(id) on delete cascade,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  discovered_count integer not null default 0,
  inserted_count integer not null default 0,
  duplicate_count integer not null default 0,
  error_count integer not null default 0,
  cursor_before text,
  cursor_after text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  constraint connector_sync_runs_status_check
    check (status in ('running', 'complete', 'failed', 'partial')),
  constraint connector_sync_runs_counts_check
    check (
      discovered_count >= 0 and inserted_count >= 0
      and duplicate_count >= 0 and error_count >= 0
    )
);

create index connector_sync_runs_organization_id_idx
  on public.connector_sync_runs (organization_id, started_at desc);
create index connector_sync_runs_connector_id_idx
  on public.connector_sync_runs (source_connector_id, started_at desc);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_type text not null default 'user',
  action text not null,
  target_type text,
  target_id uuid,
  target_label text,
  severity text not null default 'info',
  ip_address inet,
  user_agent text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_actor_type_check check (actor_type in ('user', 'system', 'api')),
  constraint audit_events_severity_check check (severity in ('info', 'success', 'warning', 'error'))
);

create index audit_events_organization_created_idx
  on public.audit_events (organization_id, created_at desc, id desc);
create index audit_events_actor_user_id_idx
  on public.audit_events (actor_user_id, created_at desc)
  where actor_user_id is not null;
create index audit_events_target_idx
  on public.audit_events (target_type, target_id, created_at desc)
  where target_id is not null;
create index audit_events_errors_idx
  on public.audit_events (organization_id, created_at desc)
  where severity in ('warning', 'error');

create table public.organization_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  value jsonb not null,
  is_secret boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, key),
  constraint organization_settings_key_format check (key ~ '^[a-z0-9_.-]{2,100}$')
);

create index organization_settings_updated_by_idx
  on public.organization_settings (updated_by)
  where updated_by is not null;

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger organization_members_set_updated_at
before update on public.organization_members
for each row execute function public.set_updated_at();

create trigger source_connectors_set_updated_at
before update on public.source_connectors
for each row execute function public.set_updated_at();

create trigger delivery_accounts_set_updated_at
before update on public.delivery_accounts
for each row execute function public.set_updated_at();

create trigger connector_secrets_set_updated_at
before update on private.connector_secrets
for each row execute function public.set_updated_at();

create trigger delivery_account_secrets_set_updated_at
before update on private.delivery_account_secrets
for each row execute function public.set_updated_at();

create trigger categories_set_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

create trigger rules_set_updated_at
before update on public.rules
for each row execute function public.set_updated_at();

create trigger messages_set_updated_at
before update on public.messages
for each row execute function public.set_updated_at();

create trigger scrape_jobs_set_updated_at
before update on public.scrape_jobs
for each row execute function public.set_updated_at();

create trigger automations_set_updated_at
before update on public.automations
for each row execute function public.set_updated_at();

create trigger action_jobs_set_updated_at
before update on public.action_jobs
for each row execute function public.set_updated_at();

create trigger templates_set_updated_at
before update on public.templates
for each row execute function public.set_updated_at();

create trigger outbound_messages_set_updated_at
before update on public.outbound_messages
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.create_organization(
  organization_name text,
  organization_slug text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_organization_id uuid;
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if length(trim(organization_name)) = 0 then
    raise exception 'Organization name is required';
  end if;

  insert into public.organizations (name, slug)
  values (trim(organization_name), lower(trim(organization_slug)))
  returning id into new_organization_id;

  insert into public.organization_members (
    organization_id,
    user_id,
    role,
    status,
    joined_at
  )
  values (
    new_organization_id,
    current_user_id,
    'owner',
    'active',
    now()
  );

  return new_organization_id;
end;
$$;

revoke all on function public.create_organization(text, text) from public;
grant execute on function public.create_organization(text, text) to authenticated;

create or replace function public.claim_pending_messages(
  target_organization_id uuid,
  worker_name text,
  batch_size integer default 25
)
returns setof public.messages
language plpgsql
security definer
set search_path = ''
as $$
begin
  if worker_name is null or length(trim(worker_name)) = 0 then
    raise exception 'Worker name is required';
  end if;

  return query
  update public.messages message
  set
    status = 'processing',
    claimed_by = worker_name,
    claimed_at = now(),
    updated_at = now()
  where message.id in (
    select queued.id
    from public.messages queued
    where queued.organization_id = target_organization_id
      and queued.status = 'new'
    order by queued.created_at, queued.id
    limit least(greatest(batch_size, 1), 100)
    for update skip locked
  )
  returning message.*;
end;
$$;

revoke all on function public.claim_pending_messages(uuid, text, integer) from public;
grant execute on function public.claim_pending_messages(uuid, text, integer) to service_role;

create or replace function public.claim_scrape_jobs(
  worker_name text,
  batch_size integer default 10
)
returns setof public.scrape_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.scrape_jobs job
  set
    status = 'processing',
    claimed_by = worker_name,
    claimed_at = now(),
    attempt_count = job.attempt_count + 1,
    updated_at = now()
  where job.id in (
    select queued.id
    from public.scrape_jobs queued
    where queued.status = 'pending'
      and queued.scheduled_at <= now()
      and queued.attempt_count < queued.max_attempts
    order by queued.priority desc, queued.scheduled_at, queued.id
    limit least(greatest(batch_size, 1), 50)
    for update skip locked
  )
  returning job.*;
end;
$$;

revoke all on function public.claim_scrape_jobs(text, integer) from public;
grant execute on function public.claim_scrape_jobs(text, integer) to service_role;

create or replace function public.claim_action_jobs(
  worker_name text,
  batch_size integer default 25
)
returns setof public.action_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if worker_name is null or length(trim(worker_name)) = 0 then
    raise exception 'Worker name is required';
  end if;

  return query
  update public.action_jobs job
  set
    status = 'processing',
    claimed_by = worker_name,
    claimed_at = now(),
    attempt_count = job.attempt_count + 1,
    updated_at = now()
  where job.id in (
    select queued.id
    from public.action_jobs queued
    where queued.status = 'pending'
      and queued.scheduled_at <= now()
      and queued.attempt_count < queued.max_attempts
    order by queued.priority desc, queued.scheduled_at, queued.id
    limit least(greatest(batch_size, 1), 100)
    for update skip locked
  )
  returning job.*;
end;
$$;

create or replace function public.increment_rule_hits(
  target_rule_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.rules
  set
    hit_count = hit_count + 1,
    last_hit_at = now(),
    updated_at = now()
  where id = target_rule_id;
end;
$$;

create or replace function public.claim_outbound_recipients(
  worker_name text,
  batch_size integer default 25
)
returns setof public.outbound_recipients
language plpgsql
security definer
set search_path = ''
as $$
begin
  if worker_name is null or length(trim(worker_name)) = 0 then
    raise exception 'Worker name is required';
  end if;

  return query
  update public.outbound_recipients recipient
  set
    status = 'processing',
    attempt_count = recipient.attempt_count + 1
  where recipient.id in (
    select queued.id
    from public.outbound_recipients queued
    join public.outbound_messages outbound
      on outbound.id = queued.outbound_message_id
    where queued.status = 'pending'
      and outbound.status in ('scheduled', 'pending', 'processing')
      and coalesce(outbound.scheduled_at, now()) <= now()
    order by outbound.scheduled_at nulls first, queued.created_at, queued.id
    limit least(greatest(batch_size, 1), 100)
    for update of queued skip locked
  )
  returning recipient.*;
end;
$$;

create or replace function public.recompute_outbound_counts(
  target_outbound_message_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  total_count integer;
  delivered_total integer;
  failed_total integer;
  pending_total integer;
begin
  select
    count(*)::integer,
    count(*) filter (
      where status in ('sent', 'delivered', 'opened', 'clicked')
    )::integer,
    count(*) filter (
      where status in ('failed', 'bounced')
    )::integer,
    count(*) filter (
      where status in ('pending', 'processing')
    )::integer
  into total_count, delivered_total, failed_total, pending_total
  from public.outbound_recipients
  where outbound_message_id = target_outbound_message_id;

  update public.outbound_messages
  set
    status = case
      when pending_total > 0 then 'processing'
      when failed_total = 0 then 'sent'
      when delivered_total = 0 then 'failed'
      else 'partial'
    end,
    recipient_count = total_count,
    delivered_count = delivered_total,
    failed_count = failed_total,
    started_at = coalesce(started_at, now()),
    completed_at = case when pending_total = 0 then now() else null end,
    updated_at = now()
  where id = target_outbound_message_id;
end;
$$;

create or replace function public.increment_delivery_sent(
  target_delivery_account_id uuid,
  increment_by integer default 1
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.delivery_accounts
  set
    sent_today = case
      when last_reset_at < date_trunc('day', now())
        then greatest(increment_by, 0)
      else sent_today + greatest(increment_by, 0)
    end,
    last_reset_at = case
      when last_reset_at < date_trunc('day', now()) then now()
      else last_reset_at
    end,
    updated_at = now()
  where id = target_delivery_account_id;
end;
$$;

revoke all on function public.claim_action_jobs(text, integer) from public;
revoke all on function public.increment_rule_hits(uuid) from public;
revoke all on function public.claim_outbound_recipients(text, integer) from public;
revoke all on function public.recompute_outbound_counts(uuid) from public;
revoke all on function public.increment_delivery_sent(uuid, integer) from public;
grant execute on function public.claim_action_jobs(text, integer) to service_role;
grant execute on function public.increment_rule_hits(uuid) to service_role;
grant execute on function public.claim_outbound_recipients(text, integer) to service_role;
grant execute on function public.recompute_outbound_counts(uuid) to service_role;
grant execute on function public.increment_delivery_sent(uuid, integer) to service_role;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;

create policy organizations_select_member
on public.organizations for select to authenticated
using ((select public.is_org_member(id)));

create policy organizations_update_admin
on public.organizations for update to authenticated
using ((select public.has_org_role(id, array['owner', 'admin']::text[])))
with check ((select public.has_org_role(id, array['owner', 'admin']::text[])));

create policy profiles_select_shared_organization
on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or (select public.shares_organization(id))
);

create policy profiles_update_self
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy organization_members_select_member
on public.organization_members for select to authenticated
using ((select public.is_org_member(organization_id)));

create policy organization_members_insert_admin
on public.organization_members for insert to authenticated
with check (
  (select public.has_org_role(organization_id, array['owner', 'admin']::text[]))
);

create policy organization_members_update_admin
on public.organization_members for update to authenticated
using (
  (select public.has_org_role(organization_id, array['owner', 'admin']::text[]))
)
with check (
  (select public.has_org_role(organization_id, array['owner', 'admin']::text[]))
);

create policy organization_members_delete_owner
on public.organization_members for delete to authenticated
using ((select public.has_org_role(organization_id, array['owner']::text[])));

do $$
declare
  table_name text;
  scoped_tables text[] := array[
    'source_connectors',
    'delivery_accounts',
    'categories',
    'rules',
    'rule_versions',
    'messages',
    'message_attachments',
    'message_rule_matches',
    'scrape_jobs',
    'automations',
    'automation_runs',
    'action_jobs',
    'templates',
    'outbound_messages',
    'outbound_recipients',
    'connector_sync_runs',
    'organization_settings'
  ];
begin
  foreach table_name in array scoped_tables loop
    execute format('alter table public.%I enable row level security', table_name);

    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.is_org_member(organization_id)))',
      table_name || '_select_member',
      table_name
    );

    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select public.has_org_role(organization_id, array[''owner'', ''admin'', ''operator'']::text[])))',
      table_name || '_insert_operator',
      table_name
    );

    execute format(
      'create policy %I on public.%I for update to authenticated using ((select public.has_org_role(organization_id, array[''owner'', ''admin'', ''operator'']::text[]))) with check ((select public.has_org_role(organization_id, array[''owner'', ''admin'', ''operator'']::text[])))',
      table_name || '_update_operator',
      table_name
    );

    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select public.has_org_role(organization_id, array[''owner'', ''admin'']::text[])))',
      table_name || '_delete_admin',
      table_name
    );
  end loop;
end;
$$;

alter table public.audit_events enable row level security;

create policy audit_events_select_member
on public.audit_events for select to authenticated
using ((select public.is_org_member(organization_id)));

-- Secrets live in the private schema and are never exposed through PostgREST
-- to browser roles. The public tables contain only maskable metadata.
revoke all on public.source_connectors from anon;
revoke all on public.delivery_accounts from anon;
revoke all on public.messages from anon;
revoke all on public.outbound_messages from anon;
revoke all on public.outbound_recipients from anon;
revoke all on public.audit_events from anon;

grant select, insert, update, delete on public.organizations to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.organization_members to authenticated;
grant select, insert, update, delete on public.source_connectors to authenticated;
grant select, insert, update, delete on public.delivery_accounts to authenticated;
grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.rules to authenticated;
grant select, insert, update, delete on public.rule_versions to authenticated;
grant select, insert, update, delete on public.messages to authenticated;
grant select, insert, update, delete on public.message_attachments to authenticated;
grant select, insert, update, delete on public.message_rule_matches to authenticated;
grant select, insert, update, delete on public.scrape_jobs to authenticated;
grant select, insert, update, delete on public.automations to authenticated;
grant select, insert, update, delete on public.automation_runs to authenticated;
grant select, insert, update, delete on public.action_jobs to authenticated;
grant select, insert, update, delete on public.templates to authenticated;
grant select, insert, update, delete on public.outbound_messages to authenticated;
grant select, insert, update, delete on public.outbound_recipients to authenticated;
grant select, insert, update, delete on public.connector_sync_runs to authenticated;
grant select on public.audit_events to authenticated;
grant select, insert, update, delete on public.organization_settings to authenticated;
