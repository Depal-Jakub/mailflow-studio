-- MailFlow Studio: server-side report aggregates.
-- Aggregation in PostgreSQL avoids the PostgREST row-return limit and keeps
-- dashboard totals correct even for organizations with millions of messages.

create or replace function public.get_organization_report(
  target_organization_id uuid,
  range_days integer default 14
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
  parameters as (
    select
      greatest(least(range_days, 365), 1) as days,
      now() - make_interval(days => greatest(least(range_days, 365), 1)) as since
  ),
  message_summary as (
    select
      count(*)::bigint as total,
      count(*) filter (where message.status = 'new')::bigint as new,
      count(*) filter (
        where message.status in ('classified', 'review', 'automated', 'archived')
      )::bigint as classified,
      count(*) filter (where message.status = 'review')::bigint as review,
      count(*) filter (where message.status = 'automated')::bigint as automated,
      count(*) filter (where message.status = 'failed')::bigint as failed,
      count(*) filter (where message.direction = 'incoming')::bigint as incoming,
      count(*) filter (where message.direction = 'outgoing')::bigint as outgoing
    from public.messages message
    cross join parameters
    where message.organization_id = target_organization_id
      and message.received_at >= parameters.since
  ),
  outbound_summary as (
    select
      count(*)::bigint as campaigns,
      coalesce(sum(outbound.recipient_count), 0)::bigint as recipients,
      coalesce(sum(outbound.delivered_count), 0)::bigint as delivered,
      coalesce(sum(outbound.failed_count), 0)::bigint as failed
    from public.outbound_messages outbound
    cross join parameters
    where outbound.organization_id = target_organization_id
      and outbound.created_at >= parameters.since
  ),
  automation_summary as (
    select
      count(*)::bigint as runs,
      count(*) filter (where run.status = 'complete')::bigint as completed,
      count(*) filter (where run.status = 'failed')::bigint as failed,
      count(*) filter (
        where run.status in ('pending', 'processing')
      )::bigint as queued
    from public.automation_runs run
    cross join parameters
    where run.organization_id = target_organization_id
      and run.created_at >= parameters.since
  ),
  daily_counts as (
    select
      date_trunc('day', message.received_at)::date as day,
      count(*) filter (where message.direction = 'incoming')::bigint as incoming,
      count(*) filter (where message.status <> 'new')::bigint as processed,
      count(*) filter (where message.status = 'automated')::bigint as automated,
      count(*) filter (where message.status = 'review')::bigint as review,
      count(*) filter (where message.status = 'failed')::bigint as failed
    from public.messages message
    cross join parameters
    where message.organization_id = target_organization_id
      and message.received_at >= parameters.since
    group by date_trunc('day', message.received_at)::date
  ),
  daily_series as (
    select jsonb_agg(
      jsonb_build_object(
        'day', series.day::text,
        'incoming', coalesce(counts.incoming, 0),
        'processed', coalesce(counts.processed, 0),
        'automated', coalesce(counts.automated, 0),
        'review', coalesce(counts.review, 0),
        'failed', coalesce(counts.failed, 0)
      )
      order by series.day
    ) as value
    from parameters
    cross join lateral generate_series(
      date_trunc('day', parameters.since)::date,
      current_date,
      interval '1 day'
    ) series(day)
    left join daily_counts counts on counts.day = series.day::date
  ),
  category_rows as (
    select
      category.id,
      category.name,
      category.color,
      count(message.id)::bigint as count
    from public.categories category
    cross join parameters
    left join public.messages message
      on message.category_id = category.id
      and message.organization_id = target_organization_id
      and message.received_at >= parameters.since
    where category.organization_id = target_organization_id
    group by category.id, category.name, category.color
  ),
  category_counts as (
    select jsonb_agg(
      jsonb_build_object(
        'id', category.id,
        'name', category.name,
        'color', category.color,
        'count', category.count
      )
      order by category.count desc, category.name
    ) as value
    from category_rows category
  ),
  source_counts as (
    select jsonb_agg(
      jsonb_build_object(
        'id', source.id,
        'name', source.name,
        'type', source.type,
        'processed', source_stats.processed,
        'review', source_stats.review,
        'errors', source_stats.errors
      )
      order by source_stats.processed desc, source.name
    ) as value
    from public.source_connectors source
    cross join parameters
    cross join lateral (
      select
        count(message.id)::bigint as processed,
        count(message.id) filter (where message.status = 'review')::bigint as review,
        count(message.id) filter (where message.status = 'failed')::bigint as errors
      from public.messages message
      where message.organization_id = target_organization_id
        and message.source_connector_id = source.id
        and message.received_at >= parameters.since
    ) source_stats
    where source.organization_id = target_organization_id
  ),
  rule_counts as (
    select jsonb_agg(
      jsonb_build_object(
        'id', rule.id,
        'name', rule.name,
        'matches', coalesce(match_stats.matches, 0),
        'evaluations', coalesce(match_stats.evaluations, 0),
        'score_delta', coalesce(match_stats.score_delta, 0)
      )
      order by coalesce(match_stats.matches, 0) desc, rule.name
    ) as value
    from public.rules rule
    cross join parameters
    left join lateral (
      select
        count(match.id)::bigint as evaluations,
        count(match.id) filter (where match.matched)::bigint as matches,
        coalesce(sum(match.score_delta), 0)::bigint as score_delta
      from public.message_rule_matches match
      where match.organization_id = target_organization_id
        and match.rule_id = rule.id
        and match.evaluated_at >= parameters.since
    ) match_stats on true
    where rule.organization_id = target_organization_id
  )
  select jsonb_build_object(
    'range',
    jsonb_build_object(
      'days', parameters.days,
      'since', parameters.since
    ),
    'messages',
    to_jsonb(message_summary),
    'outbound',
    to_jsonb(outbound_summary),
    'automations',
    to_jsonb(automation_summary) ||
      jsonb_build_object(
        'success_rate',
        case
          when automation_summary.runs = 0 then 0
          else round(
            automation_summary.completed::numeric /
            automation_summary.runs::numeric * 100,
            2
          )
        end
      ),
    'daily',
    coalesce(daily_series.value, '[]'::jsonb),
    'categories',
    coalesce(category_counts.value, '[]'::jsonb),
    'sources',
    coalesce(source_counts.value, '[]'::jsonb),
    'rules',
    coalesce(rule_counts.value, '[]'::jsonb)
  )
  from parameters
  cross join message_summary
  cross join outbound_summary
  cross join automation_summary
  cross join daily_series
  cross join category_counts
  cross join source_counts
  cross join rule_counts;
$$;

revoke all on function public.get_organization_report(uuid, integer) from public;
grant execute on function public.get_organization_report(uuid, integer)
  to service_role;
