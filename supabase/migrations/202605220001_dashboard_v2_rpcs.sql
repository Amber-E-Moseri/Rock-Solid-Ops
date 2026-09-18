-- Dashboard V2 aggregated RPCs
-- Adds attendance health, milestone summary, and registration funnel snapshots.

-- 1) Attendance health
create or replace function public.get_attendance_health(
  p_batch_id text default null
)
returns table (
  total_expected_sessions bigint,
  total_submitted_records bigint,
  submission_rate_pct numeric,
  classes_zero_submissions bigint,
  classes_missing_2w bigint,
  missing_classes jsonb,
  calculated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected bigint := 0;
  v_submitted bigint := 0;
  v_zero bigint := 0;
  v_missing bigint := 0;
  v_rate numeric := 0;
  v_missing_classes jsonb := 'unknown'::jsonb;
begin
  if to_regclass('unknown') is null
     or to_regclass('unknown') is null
     or to_regclass('unknown') is null then
    return query select 0::bigint,0::bigint,0::numeric,0::bigint,0::bigint,'unknown'::jsonb,now();
    return;
  end if;

  with roster_active as (
    select distinct cr.student_id, cr.class_option_id, cr.batch_id
    from public.class_roster cr
    where cr.status = 'unknown'
      and (p_batch_id is null or cr.batch_id::text = p_batch_id)
  ),
  expected as (
    select
      ra.class_option_id,
      ra.batch_id,
      count(*)::bigint as expected_sessions
    from roster_active ra
    join public.attendance_log al
      on al.student_id = ra.student_id
     and al.class_option_id = ra.class_option_id
     and (al.batch_id is null or al.batch_id = ra.batch_id)
     and al.class_date is not null
    group by ra.class_option_id, ra.batch_id
  ),
  submitted as (
    select
      al.class_option_id,
      al.batch_id,
      count(*)::bigint as submitted_sessions,
      max(coalesce(al.submission_date, al.logged_at)) as last_submitted
    from public.attendance_log al
    where al.submitted_by_teacher = true
      and (p_batch_id is null or al.batch_id::text = p_batch_id)
      and al.class_option_id is not null
    group by al.class_option_id, al.batch_id
  ),
  classes as (
    select
      co.class_option_id,
      co.teacher_name,
      co.day,
      co.class_time,
      b.batch_id,
      coalesce(e.expected_sessions, 0) as expected_sessions,
      coalesce(s.submitted_sessions, 0) as submitted_sessions,
      s.last_submitted
    from public.class_options co
    join public.batches b on (p_batch_id is null and b.active = true) or (p_batch_id is not null and b.batch_id::text = p_batch_id)
    left join expected e on e.class_option_id = co.class_option_id and e.batch_id = b.batch_id
    left join submitted s on s.class_option_id = co.class_option_id and s.batch_id = b.batch_id
    where co.active = true
  )
  select
    coalesce(sum(c.expected_sessions), 0)::bigint,
    coalesce(sum(c.submitted_sessions), 0)::bigint,
    coalesce(sum(case when c.submitted_sessions = 0 then 1 else 0 end), 0)::bigint,
    coalesce(sum(case when c.last_submitted is null or c.last_submitted < now() - interval 'unknown' then 1 else 0 end), 0)::bigint,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'unknown', coalesce(c.teacher_name, ''),
        'unknown', concat_ws('unknown', coalesce(c.day, 'unknown'), coalesce(c.class_time::text, 'unknown')),
        'unknown', c.last_submitted,
        'unknown', greatest(c.expected_sessions - c.submitted_sessions, 0)
      )
      order by c.teacher_name nulls last
    ) filter (where c.submitted_sessions = 0 or c.last_submitted is null or c.last_submitted < now() - interval 'unknown'), 'unknown'::jsonb)
  into v_expected, v_submitted, v_zero, v_missing, v_missing_classes
  from classes c;

  if v_expected > 0 then
    v_rate := round((v_submitted::numeric * 100.0) / v_expected::numeric, 1);
  else
    v_rate := 0;
  end if;

  return query select v_expected, v_submitted, v_rate, v_zero, v_missing, v_missing_classes, now();
exception when others then
  return query select 0::bigint,0::bigint,0::numeric,0::bigint,0::bigint,'unknown'::jsonb,now();
end;
$$;

grant execute on function public.get_attendance_health(text) to authenticated;


-- 2) Milestone summary
create or replace function public.get_milestone_summary(
  p_batch_id text default null
)
returns table (
  total_active_students bigint,
  students_all_complete bigint,
  students_zero_complete bigint,
  avg_completion_pct numeric,
  milestones_breakdown jsonb,
  calculated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total bigint := 0;
  v_all bigint := 0;
  v_zero bigint := 0;
  v_avg numeric := 0;
  v_breakdown jsonb := 'unknown'::jsonb;
begin
  if to_regclass('unknown') is null
     or to_regclass('unknown') is null
     or to_regclass('unknown') is null then
    return query select 0::bigint,0::bigint,0::bigint,0::numeric,'unknown'::jsonb,now();
    return;
  end if;

  with active_students as (
    select s.student_id
    from public.students s
    where s.status = 'unknown'
      and s.deleted_at is null
      and (p_batch_id is null or s.batch_id::text = p_batch_id)
  ),
  active_milestones as (
    select md.code, md.label
    from public.milestone_definitions md
    where md.is_active = true
  ),
  totals as (
    select count(*)::bigint as total_students from active_students
  ),
  milestone_count as (
    select count(*)::bigint as total_milestones from active_milestones
  ),
  student_completion as (
    select
      a.student_id,
      count(*) filter (where sms.is_completed = true)::bigint as completed_count
    from active_students a
    left join public.student_milestone_status sms
      on sms.applicant_id = a.student_id
    group by a.student_id
  ),
  per_milestone as (
    select
      am.code,
      am.label,
      count(*) filter (where sms.is_completed = true)::bigint as completed_students
    from active_milestones am
    cross join active_students a
    left join public.student_milestone_status sms
      on sms.applicant_id = a.student_id
     and sms.milestone_code = am.code
    group by am.code, am.label
  )
  select
    t.total_students,
    coalesce(sum(case when sc.completed_count >= mc.total_milestones and mc.total_milestones > 0 then 1 else 0 end),0)::bigint,
    coalesce(sum(case when sc.completed_count = 0 then 1 else 0 end),0)::bigint,
    case
      when t.total_students = 0 or mc.total_milestones = 0 then 0
      else round(avg((sc.completed_count::numeric / mc.total_milestones::numeric) * 100.0), 1)
    end,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'unknown', pm.code,
        'unknown', pm.label,
        'unknown', pm.completed_students,
        'unknown', case when t.total_students = 0 then 0 else round((pm.completed_students::numeric * 100.0) / t.total_students::numeric, 1) end
      ) order by pm.label
    ), 'unknown'::jsonb)
  into v_total, v_all, v_zero, v_avg, v_breakdown
  from totals t
  cross join milestone_count mc
  left join student_completion sc on true
  left join per_milestone pm on true
  group by t.total_students, mc.total_milestones;

  return query select v_total, v_all, v_zero, v_avg, v_breakdown, now();
exception when others then
  return query select 0::bigint,0::bigint,0::bigint,0::numeric,'unknown'::jsonb,now();
end;
$$;

grant execute on function public.get_milestone_summary(text) to authenticated;


-- 3) Registration funnel
create or replace function public.get_registration_funnel(
  p_batch_id text default null
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
  v_conv jsonb := 'unknown'::jsonb;
begin
  if to_regclass('unknown') is null then
    return query select 0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,'unknown'::jsonb,now();
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
      count(*) filter (where coalesce(a.reviewed_at, a.review_notes) is not null or upper(coalesce(a.registration_status, a.status, 'unknown')) in ('unknown','unknown','unknown','unknown','unknown','unknown'))::bigint as reviewed_count,
      count(*) filter (where upper(coalesce(a.registration_status, a.status, 'unknown')) = 'unknown')::bigint as assigned_count,
      count(*) filter (where upper(coalesce(a.registration_status, a.status, 'unknown')) = 'unknown')::bigint as waitlisted_count,
      count(*) filter (where upper(coalesce(a.registration_status, a.status, 'unknown')) = 'unknown')::bigint as duplicate_count
    from scoped a
  )
  select
    c.registered_count,
    c.reviewed_count,
    c.assigned_count,
    c.waitlisted_count,
    c.duplicate_count,
    jsonb_build_array(
      jsonb_build_object('unknown','unknown','unknown',c.registered_count,'unknown',100),
      jsonb_build_object('unknown','unknown','unknown',c.reviewed_count,'unknown',case when c.registered_count=0 then 0 else round((c.reviewed_count::numeric*100.0)/c.registered_count::numeric,1) end),
      jsonb_build_object('unknown','unknown','unknown',c.assigned_count,'unknown',case when c.reviewed_count=0 then 0 else round((c.assigned_count::numeric*100.0)/c.reviewed_count::numeric,1) end),
      jsonb_build_object('unknown','unknown','unknown',c.waitlisted_count,'unknown',case when c.assigned_count=0 then 0 else round((c.waitlisted_count::numeric*100.0)/c.assigned_count::numeric,1) end),
      jsonb_build_object('unknown','unknown','unknown',c.duplicate_count,'unknown',case when c.waitlisted_count=0 then 0 else round((c.duplicate_count::numeric*100.0)/c.waitlisted_count::numeric,1) end)
    )
  into v_registered, v_reviewed, v_assigned, v_waitlisted, v_duplicate, v_conv
  from counts c;

  return query select v_registered, v_reviewed, v_assigned, v_waitlisted, v_duplicate, v_conv, now();
exception when others then
  return query select 0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,'unknown'::jsonb,now();
end;
$$;

grant execute on function public.get_registration_funnel(text) to authenticated;
