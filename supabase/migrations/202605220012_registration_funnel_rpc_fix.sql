-- Hotfix: ensure registration funnel RPC exists with the exact signature expected by dashboard.

-- Drop first to handle signature changes (parameter defaults)
DROP FUNCTION IF EXISTS public.get_registration_funnel(text);

create or replace function public.get_registration_funnel(
  p_batch_id text
)
returns table (
  registered_count bigint,
  reviewed_count bigint,
  assigned_count bigint,
  waitlisted_count bigint,
  duplicate_count bigint,
  conversion_json jsonb,
  calculated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_registered bigint := 0;
  v_reviewed bigint := 0;
  v_assigned bigint := 0;
  v_waitlisted bigint := 0;
  v_duplicate bigint := 0;
  v_conv jsonb := '[]'::jsonb;
begin
  if to_regclass('public.applicants') is null then
    return query select 0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,'[]'::jsonb,now();
    return;
  end if;

  with scoped as (
    select a.*
    from public.applicants a
    where (p_batch_id is null or a.batch_id::text = p_batch_id)
  ),
  counts as (
    select
      count(*)::bigint as registered_count,
      count(*) filter (where coalesce(a.reviewed_at, a.review_notes) is not null or upper(coalesce(a.registration_status, a.status, '')) in ('REVIEW','ASSIGNED','WAITLISTED','DUPLICATE','COMPLETED','INACTIVE'))::bigint as reviewed_count,
      count(*) filter (where upper(coalesce(a.registration_status, a.status, '')) = 'ASSIGNED')::bigint as assigned_count,
      count(*) filter (where upper(coalesce(a.registration_status, a.status, '')) = 'WAITLISTED')::bigint as waitlisted_count,
      count(*) filter (where upper(coalesce(a.registration_status, a.status, '')) = 'DUPLICATE')::bigint as duplicate_count
    from scoped a
  )
  select
    c.registered_count,
    c.reviewed_count,
    c.assigned_count,
    c.waitlisted_count,
    c.duplicate_count,
    jsonb_build_array(
      jsonb_build_object('stage','Registered','count',c.registered_count,'pct_from_previous',100),
      jsonb_build_object('stage','Reviewed','count',c.reviewed_count,'pct_from_previous',case when c.registered_count=0 then 0 else round((c.reviewed_count::numeric*100.0)/c.registered_count::numeric,1) end),
      jsonb_build_object('stage','Assigned','count',c.assigned_count,'pct_from_previous',case when c.reviewed_count=0 then 0 else round((c.assigned_count::numeric*100.0)/c.reviewed_count::numeric,1) end),
      jsonb_build_object('stage','Waitlisted','count',c.waitlisted_count,'pct_from_previous',case when c.assigned_count=0 then 0 else round((c.waitlisted_count::numeric*100.0)/c.assigned_count::numeric,1) end),
      jsonb_build_object('stage','Duplicate','count',c.duplicate_count,'pct_from_previous',case when c.waitlisted_count=0 then 0 else round((c.duplicate_count::numeric*100.0)/c.waitlisted_count::numeric,1) end)
    )
  into v_registered, v_reviewed, v_assigned, v_waitlisted, v_duplicate, v_conv
  from counts c;

  return query select v_registered, v_reviewed, v_assigned, v_waitlisted, v_duplicate, v_conv, now();
exception when others then
  return query select 0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,'[]'::jsonb,now();
end;
$$;

grant execute on function public.get_registration_funnel(text) to authenticated;
