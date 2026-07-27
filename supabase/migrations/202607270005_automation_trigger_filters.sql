-- MailFlow Studio: trigger filters for message-driven automations.
-- Filters are optional. Existing automations without trigger_config continue
-- to run for every message matching their trigger type.

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
      and (
        nullif(automation.trigger_config->>'category_id', '') is null
        or message.category_id::text = automation.trigger_config->>'category_id'
      )
      and (
        nullif(automation.trigger_config->>'source_connector_id', '') is null
        or message.source_connector_id::text =
          automation.trigger_config->>'source_connector_id'
      )
      and (
        nullif(automation.trigger_config->>'minimum_score', '') is null
        or (
          automation.trigger_config->>'minimum_score' ~ '^-?[0-9]{1,3}$'
          and message.score >=
            greatest(
              least((automation.trigger_config->>'minimum_score')::integer, 100),
              -100
            )
        )
      )
      and (
        nullif(automation.trigger_config->>'subject_contains', '') is null
        or position(
          lower(automation.trigger_config->>'subject_contains')
          in lower(coalesce(message.subject, ''))
        ) > 0
      )
      and (
        coalesce(
          jsonb_typeof(automation.trigger_config->'required_tags'),
          'null'
        ) <> 'array'
        or not exists (
          select 1
          from jsonb_array_elements_text(
            automation.trigger_config->'required_tags'
          ) required_tag
          where not (message.tags @> array[required_tag]::text[])
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

revoke all on function public.enqueue_ready_automations(integer) from public;
grant execute on function public.enqueue_ready_automations(integer) to service_role;
