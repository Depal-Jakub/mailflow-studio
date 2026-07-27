-- MailFlow Studio: atomic creation of outbound campaigns and recipients.

create or replace function public.create_outbound_with_recipients(
  target_organization_id uuid,
  target_delivery_account_id uuid,
  target_template_id uuid,
  target_source_message_id uuid,
  outbound_subject text,
  outbound_text_body text,
  outbound_html_body text,
  outbound_audience_definition jsonb,
  outbound_status text,
  outbound_scheduled_at timestamptz,
  target_created_by uuid,
  recipient_payload jsonb
)
returns public.outbound_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_outbound public.outbound_messages%rowtype;
  unique_recipient_count integer;
begin
  if length(trim(coalesce(outbound_subject, ''))) = 0 then
    raise exception using
      errcode = '22023',
      message = 'Outbound subject is required';
  end if;
  if outbound_status not in ('draft', 'scheduled', 'pending') then
    raise exception using
      errcode = '22023',
      message = 'Unsupported outbound status';
  end if;
  if jsonb_typeof(recipient_payload) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'Recipients must be a JSON array';
  end if;
  if jsonb_array_length(recipient_payload) > 50000 then
    raise exception using
      errcode = '22023',
      message = 'An outbound message supports at most 50000 recipients';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(recipient_payload) recipient
    where jsonb_typeof(recipient) <> 'object'
      or lower(trim(coalesce(recipient ->> 'email', '')))
        !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Every recipient must contain a valid email address';
  end if;

  select count(distinct lower(trim(recipient ->> 'email')))::integer
  into unique_recipient_count
  from jsonb_array_elements(recipient_payload) recipient;

  if outbound_status <> 'draft' and unique_recipient_count = 0 then
    raise exception using
      errcode = '22023',
      message = 'Queued or scheduled delivery requires recipients';
  end if;
  if outbound_status <> 'draft' and target_delivery_account_id is null then
    raise exception using
      errcode = '22023',
      message = 'Queued or scheduled delivery requires an account';
  end if;
  if outbound_status = 'scheduled' and (
    outbound_scheduled_at is null or outbound_scheduled_at <= now()
  ) then
    raise exception using
      errcode = '22023',
      message = 'Scheduled delivery requires a future timestamp';
  end if;

  if target_delivery_account_id is not null and not exists (
    select 1
    from public.delivery_accounts account
    where account.id = target_delivery_account_id
      and account.organization_id = target_organization_id
      and (
        outbound_status = 'draft'
        or account.status = 'active'
      )
  ) then
    raise exception using
      errcode = '23503',
      message = 'Delivery account is unavailable in this organization';
  end if;
  if target_template_id is not null and not exists (
    select 1
    from public.templates template
    where template.id = target_template_id
      and template.organization_id = target_organization_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'Template is unavailable in this organization';
  end if;
  if target_source_message_id is not null and not exists (
    select 1
    from public.messages message
    where message.id = target_source_message_id
      and message.organization_id = target_organization_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'Source message is unavailable in this organization';
  end if;

  insert into public.outbound_messages (
    organization_id,
    delivery_account_id,
    template_id,
    source_message_id,
    subject,
    text_body,
    html_body,
    audience_definition,
    status,
    scheduled_at,
    recipient_count,
    created_by
  )
  values (
    target_organization_id,
    target_delivery_account_id,
    target_template_id,
    target_source_message_id,
    trim(outbound_subject),
    outbound_text_body,
    outbound_html_body,
    coalesce(outbound_audience_definition, '{}'::jsonb),
    outbound_status,
    case
      when outbound_status = 'scheduled' then outbound_scheduled_at
      else null
    end,
    unique_recipient_count,
    target_created_by
  )
  returning * into created_outbound;

  insert into public.outbound_recipients (
    organization_id,
    outbound_message_id,
    email,
    name,
    variables,
    status
  )
  select
    target_organization_id,
    created_outbound.id,
    recipient.email,
    recipient.name,
    recipient.variables,
    'pending'
  from (
    select distinct on (lower(trim(item ->> 'email')))
      lower(trim(item ->> 'email')) as email,
      nullif(trim(item ->> 'name'), '') as name,
      case
        when jsonb_typeof(item -> 'variables') = 'object'
          then item -> 'variables'
        else '{}'::jsonb
      end as variables,
      ordinal
    from jsonb_array_elements(recipient_payload)
      with ordinality as entry(item, ordinal)
    order by lower(trim(item ->> 'email')), ordinal
  ) recipient;

  return created_outbound;
end;
$$;

revoke all on function public.create_outbound_with_recipients(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  text,
  timestamptz,
  uuid,
  jsonb
) from public;
grant execute on function public.create_outbound_with_recipients(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb,
  text,
  timestamptz,
  uuid,
  jsonb
) to service_role;
