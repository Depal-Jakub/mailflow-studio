-- MailFlow Studio: custom roles, invitations and operational connector metadata.

create table public.organization_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  color text not null default '#64748b',
  built_in boolean not null default false,
  permissions text[] not null default '{}'::text[],
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_roles_key_format
    check (key ~ '^[a-z0-9][a-z0-9_.-]{1,62}$'),
  constraint organization_roles_name_not_blank check (length(trim(name)) > 0),
  constraint organization_roles_color_check check (color ~ '^#[0-9a-fA-F]{6}$'),
  unique (organization_id, key)
);

create index organization_roles_organization_idx
  on public.organization_roles (organization_id, built_in desc, name);

alter table public.organization_members
  add column role_id uuid references public.organization_roles(id) on delete restrict;

alter table public.organization_members
  drop constraint organization_members_role_check;

create index organization_members_role_id_idx
  on public.organization_members (role_id)
  where role_id is not null;

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role_id uuid not null references public.organization_roles(id) on delete restrict,
  status text not null default 'pending',
  token_hash text not null unique,
  invited_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint organization_invitations_email_check check (position('@' in email) > 1),
  constraint organization_invitations_status_check
    check (status in ('pending', 'accepted', 'expired', 'revoked'))
);

create unique index organization_invitations_pending_email_idx
  on public.organization_invitations (organization_id, lower(email))
  where status = 'pending';

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_connector_id uuid not null references public.source_connectors(id) on delete cascade,
  external_id text,
  request_id text,
  signature_valid boolean not null default false,
  status text not null default 'accepted',
  response_code integer not null default 202,
  dedupe_hash text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  constraint webhook_deliveries_status_check
    check (status in ('accepted', 'duplicate', 'rejected', 'failed'))
);

create index webhook_deliveries_source_received_idx
  on public.webhook_deliveries (source_connector_id, received_at desc);
create unique index webhook_deliveries_dedupe_idx
  on public.webhook_deliveries (organization_id, source_connector_id, dedupe_hash)
  where dedupe_hash is not null;

alter table public.templates
  add column description text,
  add column template_type text not null default 'notification';

create table public.template_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id uuid not null references public.templates(id) on delete cascade,
  version integer not null,
  subject_template text,
  text_template text,
  html_template text,
  variables jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (template_id, version)
);

create index template_versions_template_idx
  on public.template_versions (template_id, version desc);

create or replace function public.default_role_permissions(role_key text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case role_key
    when 'owner' then array[
      'dashboard.view','messages.view','messages.classify','messages.assign','messages.export',
      'sources.view','sources.manage','sources.test','categories.view','categories.manage',
      'rules.view','rules.manage','rules.publish','automations.view','automations.manage',
      'send.view','send.compose','send.approve','send.schedule','templates.view','templates.manage',
      'accounts.view','accounts.manage','users.view','users.invite','users.manage','roles.manage',
      'reports.view','reports.export','audit.view','settings.view','settings.manage',
      'organization.manage','organization.billing'
    ]::text[]
    when 'admin' then array[
      'dashboard.view','messages.view','messages.classify','messages.assign','messages.export',
      'sources.view','sources.manage','sources.test','categories.view','categories.manage',
      'rules.view','rules.manage','rules.publish','automations.view','automations.manage',
      'send.view','send.compose','send.approve','send.schedule','templates.view','templates.manage',
      'accounts.view','accounts.manage','users.view','users.invite','users.manage','roles.manage',
      'reports.view','reports.export','audit.view','settings.view','settings.manage'
    ]::text[]
    when 'operator' then array[
      'dashboard.view','messages.view','messages.classify','messages.assign','messages.export',
      'sources.view','sources.test','categories.view','categories.manage','rules.view','rules.manage',
      'automations.view','automations.manage','send.view','send.compose','send.schedule',
      'templates.view','templates.manage','accounts.view','users.view','reports.view','audit.view'
    ]::text[]
    when 'reviewer' then array[
      'dashboard.view','messages.view','messages.classify','messages.assign',
      'sources.view','categories.view','rules.view','automations.view',
      'send.view','templates.view','accounts.view','reports.view'
    ]::text[]
    else array[
      'dashboard.view','messages.view','sources.view','categories.view','rules.view',
      'automations.view','send.view','templates.view','accounts.view','reports.view'
    ]::text[]
  end;
$$;

create or replace function public.seed_organization_roles(target_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_key text;
begin
  foreach role_key in array array['owner','admin','operator','reviewer','viewer'] loop
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
      public.default_role_permissions(role_key)
    )
    on conflict (organization_id, key) do nothing;
  end loop;
end;
$$;

create or replace function public.seed_roles_after_organization_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_organization_roles(new.id);
  return new;
end;
$$;

create trigger organizations_seed_roles
after insert on public.organizations
for each row execute function public.seed_roles_after_organization_insert();

do $$
declare
  organization_record record;
begin
  for organization_record in select id from public.organizations loop
    perform public.seed_organization_roles(organization_record.id);
  end loop;
end;
$$;

update public.organization_members membership
set role_id = role_definition.id
from public.organization_roles role_definition
where role_definition.organization_id = membership.organization_id
  and role_definition.key = membership.role
  and membership.role_id is null;

alter table public.organization_members
  alter column role_id set not null;

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
  owner_role_id uuid;
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

  select id into owner_role_id
  from public.organization_roles
  where organization_id = new_organization_id
    and key = 'owner';

  if owner_role_id is null then
    raise exception 'Owner role was not created for organization';
  end if;

  insert into public.organization_members (
    organization_id,
    user_id,
    role,
    role_id,
    status,
    joined_at
  )
  values (
    new_organization_id,
    current_user_id,
    'owner',
    owner_role_id,
    'active',
    now()
  );

  return new_organization_id;
end;
$$;

create or replace function public.has_org_permission(
  target_organization_id uuid,
  requested_permission text
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
    join public.organization_roles role_definition
      on role_definition.id = membership.role_id
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and requested_permission = any(role_definition.permissions)
  );
$$;

revoke all on function public.default_role_permissions(text) from public;
revoke all on function public.seed_organization_roles(uuid) from public;
revoke all on function public.has_org_permission(uuid, text) from public;
grant execute on function public.has_org_permission(uuid, text) to authenticated;
grant execute on function public.seed_organization_roles(uuid) to service_role;

create trigger organization_roles_set_updated_at
before update on public.organization_roles
for each row execute function public.set_updated_at();

alter table public.organization_roles enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.webhook_deliveries enable row level security;
alter table public.template_versions enable row level security;

create policy organization_roles_select_member
on public.organization_roles for select to authenticated
using ((select public.is_org_member(organization_id)));

create policy organization_roles_manage_admin
on public.organization_roles for all to authenticated
using ((select public.has_org_role(organization_id, array['owner','admin']::text[])))
with check ((select public.has_org_role(organization_id, array['owner','admin']::text[])));

create policy organization_invitations_select_admin
on public.organization_invitations for select to authenticated
using ((select public.has_org_role(organization_id, array['owner','admin']::text[])));

create policy organization_invitations_manage_admin
on public.organization_invitations for all to authenticated
using ((select public.has_org_role(organization_id, array['owner','admin']::text[])))
with check ((select public.has_org_role(organization_id, array['owner','admin']::text[])));

create policy webhook_deliveries_select_member
on public.webhook_deliveries for select to authenticated
using ((select public.is_org_member(organization_id)));

create policy template_versions_select_member
on public.template_versions for select to authenticated
using ((select public.is_org_member(organization_id)));

create policy template_versions_manage_operator
on public.template_versions for all to authenticated
using ((select public.has_org_role(organization_id, array['owner','admin','operator']::text[])))
with check ((select public.has_org_role(organization_id, array['owner','admin','operator']::text[])));

grant select, insert, update, delete on public.organization_roles to authenticated;
grant select, insert, update, delete on public.organization_invitations to authenticated;
grant select on public.webhook_deliveries to authenticated;
grant select, insert, update, delete on public.template_versions to authenticated;

revoke all on public.webhook_deliveries from anon;
