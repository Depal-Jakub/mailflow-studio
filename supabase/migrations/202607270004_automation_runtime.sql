-- MailFlow Studio: executable automations, retryable delays, tasks and notifications.

alter table public.automation_runs
  add column if not exists resume_at timestamptz not null default now();

create index if not exists automation_runs_ready_idx
  on public.automation_runs (resume_at, created_at, id)
  where status = 'pending';

create unique index if not exists automation_runs_message_once_idx
  on public.automation_runs (automation_id, message_id)
  where message_id is not null;

create table public.workflow_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  automation_id uuid references public.automations(id) on delete set null,
  action_job_id uuid references public.action_jobs(id) on delete set null,
  assignee_id uuid references public.profiles(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'open',
  priority integer not null default 50,
  due_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_tasks_title_not_blank check (length(trim(title)) > 0),
  constraint workflow_tasks_status_check
    check (status in ('open', 'in_progress', 'complete', 'cancelled')),
  constraint workflow_tasks_priority_check check (priority between 0 and 1000)
);

create index workflow_tasks_organization_status_idx
  on public.workflow_tasks (organization_id, status, due_at, created_at desc);
create index workflow_tasks_assignee_idx
  on public.workflow_tasks (assignee_id, status, due_at)
  where assignee_id is not null;

create trigger workflow_tasks_set_updated_at
before update on public.workflow_tasks
for each row execute function public.set_updated_at();

create table public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  automation_id uuid references public.automations(id) on delete set null,
  action_job_id uuid references public.action_jobs(id) on delete set null,
  title text not null,
  body text,
  link text,
  severity text not null default 'info',
  read_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint user_notifications_title_not_blank check (length(trim(title)) > 0),
  constraint user_notifications_severity_check
    check (severity in ('info', 'success', 'warning', 'error'))
);

create index user_notifications_user_unread_idx
  on public.user_notifications (user_id, created_at desc)
  where read_at is null;
create index user_notifications_organization_created_idx
  on public.user_notifications (organization_id, created_at desc);

alter table public.workflow_tasks enable row level security;
alter table public.user_notifications enable row level security;

create policy workflow_tasks_select_member
on public.workflow_tasks for select to authenticated
using ((select public.is_org_member(organization_id)));

create policy workflow_tasks_write_operator
on public.workflow_tasks for all to authenticated
using ((
  select public.has_org_role(
    organization_id,
    array['owner', 'admin', 'operator']::text[]
  )
))
with check ((
  select public.has_org_role(
    organization_id,
    array['owner', 'admin', 'operator']::text[]
  )
));

create policy user_notifications_select_own
on public.user_notifications for select to authenticated
using (
  user_id = (select auth.uid())
  and (select public.is_org_member(organization_id))
);

create policy user_notifications_update_own
on public.user_notifications for update to authenticated
using (
  user_id = (select auth.uid())
  and (select public.is_org_member(organization_id))
)
with check (
  user_id = (select auth.uid())
  and (select public.is_org_member(organization_id))
);

revoke all on public.workflow_tasks from anon;
revoke all on public.user_notifications from anon;
grant select, insert, update, delete on public.workflow_tasks to authenticated;
grant select, update on public.user_notifications to authenticated;

create or replace function public.enqueue_ready_automations(
  candidate_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  scheduled_count bigint := 0;
  message_count bigint := 0;
begin
  with due as (
    select automation.id
    from public.automations automation
    where automation.active
      and automation.trigger_type = 'schedule'
      and automation.next_run_at is not null
      and automation.next_run_at <= now()
    order by automation.next_run_at, automation.id
    for update skip locked
    limit greatest(least(candidate_limit, 1000), 1)
  ),
  inserted as (
    insert into public.automation_runs (
      organization_id,
      automation_id,
      status,
      input,
      resume_at
    )
    select
      automation.organization_id,
      automation.id,
      'pending',
      jsonb_build_object(
        'trigger', 'schedule',
        'scheduled_for', automation.next_run_at
      ),
      now()
    from public.automations automation
    join due on due.id = automation.id
    returning automation_id
  )
  update public.automations automation
  set next_run_at =
    now() + make_interval(
      mins => case
        when coalesce(automation.trigger_config->>'interval_minutes', '')
          ~ '^[0-9]{1,6}$'
        then greatest(
          least((automation.trigger_config->>'interval_minutes')::integer, 525600),
          1
        )
        else 60
      end
    )
  from inserted
  where automation.id = inserted.automation_id;
  get diagnostics scheduled_count = row_count;

  with candidates as (
    select
      automation.id as automation_id,
      automation.organization_id,
      message.id as message_id,
      automation.trigger_type
    from public.automations automation
    join public.messages message
      on message.organization_id = automation.organization_id
    where automation.active
      and automation.trigger_type in ('message_ingested', 'message_classified')
      and (
        automation.trigger_type = 'message_ingested'
        or (
          automation.trigger_type = 'message_classified'
          and message.status in ('classified', 'review', 'automated', 'archived')
        )
      )
      and not exists (
        select 1
        from public.automation_runs run
        where run.automation_id = automation.id
          and run.message_id = message.id
      )
    order by message.created_at, automation.id
    limit greatest(least(candidate_limit, 1000), 1)
  )
  insert into public.automation_runs (
    organization_id,
    automation_id,
    message_id,
    status,
    input,
    resume_at
  )
  select
    candidate.organization_id,
    candidate.automation_id,
    candidate.message_id,
    'pending',
    jsonb_build_object('trigger', candidate.trigger_type),
    now()
  from candidates candidate
  on conflict (automation_id, message_id)
    where message_id is not null
  do nothing;
  get diagnostics message_count = row_count;

  return jsonb_build_object(
    'scheduled', scheduled_count,
    'message_triggered', message_count
  );
end;
$$;

create or replace function public.claim_automation_runs(
  worker_name text,
  batch_size integer default 25
)
returns setof public.automation_runs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select run.id
    from public.automation_runs run
    where run.status = 'pending'
      and run.resume_at <= now()
    order by run.resume_at, run.created_at, run.id
    for update skip locked
    limit greatest(least(batch_size, 100), 1)
  )
  update public.automation_runs run
  set
    status = 'processing',
    claimed_by = worker_name,
    claimed_at = now(),
    started_at = coalesce(run.started_at, now()),
    attempt_count = run.attempt_count + 1
  from candidates
  where run.id = candidates.id
  returning run.*;
end;
$$;

create or replace function public.finish_automation_run(
  target_run_id uuid,
  succeeded boolean,
  run_output jsonb default '{}'::jsonb,
  finished_step integer default 0,
  failure_message text default null
)
returns public.automation_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  finished_run public.automation_runs%rowtype;
begin
  update public.automation_runs run
  set
    status = case when succeeded then 'complete' else 'failed' end,
    output = coalesce(run_output, '{}'::jsonb),
    current_step = greatest(finished_step, 0),
    completed_at = now(),
    claimed_by = null,
    claimed_at = null,
    error_message = case when succeeded then null else failure_message end
  where run.id = target_run_id
    and run.status = 'processing'
  returning run.* into finished_run;

  if not found then
    raise exception 'Automation run is not in processing state';
  end if;

  update public.automations automation
  set
    run_count = automation.run_count + 1,
    success_count = automation.success_count + case when succeeded then 1 else 0 end,
    failure_count = automation.failure_count + case when succeeded then 0 else 1 end,
    last_run_at = now()
  where automation.id = finished_run.automation_id;

  return finished_run;
end;
$$;

revoke all on function public.enqueue_ready_automations(integer) from public;
revoke all on function public.claim_automation_runs(text, integer) from public;
revoke all on function public.finish_automation_run(uuid, boolean, jsonb, integer, text) from public;
grant execute on function public.enqueue_ready_automations(integer) to service_role;
grant execute on function public.claim_automation_runs(text, integer) to service_role;
grant execute on function public.finish_automation_run(uuid, boolean, jsonb, integer, text) to service_role;
