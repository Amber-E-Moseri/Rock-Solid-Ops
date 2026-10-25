-- GENERATED from production catalog (foundation-school, read-only SELECT), 2026-10-24.
-- Reproduced: column names, types, defaults, primary keys and unique/check constraints on the
-- attendance-related tables; attendance_log foreign keys to tables present here; helper functions,
-- attendance trigger functions and the updated_at trigger function (verbatim); attendance triggers
-- (verbatim); RLS enablement; policies on attendance, predicate and trigger-touched tables (verbatim).
-- NOT reproduced: foreign keys to tables not in this fixture (students->fellowship_map, teachers->fellowship_map,
-- students->class_options), evaluate_graduation_eligibility() (not present),
-- production grant defaults beyond the shim.
-- Test-only. Never run against a live database.

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(), email text, full_name text, role text,
  subgroups text[], group_ids text[], active boolean default true, auth_user_id uuid,
  created_at timestamptz default now(), updated_at timestamptz default now(), name text, status text);

create table if not exists public.profiles (
  user_id uuid not null,
  email text,
  full_name text,
  role text not null,
  is_active boolean default true not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  push_subscription jsonb,
  push_subscribed_at timestamptz,
  push_enabled boolean default false not null,
  primary key (user_id)
);

create table if not exists public.teachers (
  teacher_id text not null,
  full_name text not null,
  email text,
  phone text,
  group_id text,
  subgroup_id text,
  active boolean default true not null,
  notes text,
  deleted_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  teacher_timezone text default 'America/Toronto'::text,
  status text default 'PENDING'::text not null,
  suspended_reason text,
  suspended_by text,
  suspended_at timestamptz,
  activated_at timestamptz,
  activated_by text,
  rejected_at timestamptz,
  rejected_by text,
  rejected_reason text,
  deactivated_at timestamptz,
  deactivated_by text,
  deactivated_reason text,
  teacher_user_id uuid,
  fellowship_code text,
  primary key (teacher_id)
);

create table if not exists public.students (
  student_id text not null,
  full_name text not null,
  email text not null,
  phone text,
  group_id text not null,
  subgroup_id text not null,
  fellowship_code text,
  batch_id text,
  class_option_id text,
  teacher_id text,
  teacher_name text,
  status text default 'Active'::text not null,
  eligible_for_fs boolean default false not null,
  date_added_elvanto date,
  needs_attention_flag boolean default false not null,
  needs_attention_reason text,
  reason_not_started text,
  owner text,
  deleted_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  primary key (student_id)
);

create table if not exists public.batches (
  batch_id text default ('BATCH-'::text || upper(substr((gen_random_uuid())::text, 1, 8))) not null,
  name text,
  start_sunday date,
  start_date date,
  end_date date,
  registration_open boolean default false not null,
  active boolean default true not null,
  created_by text,
  updated_by text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  batch_code text,
  batch_name text not null,
  status text default 'DRAFT'::text,
  notes text,
  archived_at timestamptz,
  id uuid default gen_random_uuid(),
  archived boolean default false not null,
  primary key (batch_id)
);

create table if not exists public.class_options (
  class_option_id text default ('CO-'::text || upper("substring"((gen_random_uuid())::text, 1, 8))) not null,
  class_id text not null,
  teacher_id text,
  teacher_name text,
  fellowship_codes text[] default '{}'::text[] not null,
  group_id text not null,
  subgroup_id text not null,
  day text,
  class_time time,
  active boolean default false not null,
  enrollment_open boolean default false not null,
  max_capacity integer,
  label_suffix text,
  deleted_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  enrollment_closes_at timestamptz,
  is_online boolean default false not null,
  confirmed_start_date date,
  primary key (class_option_id)
);

create table if not exists public.attendance_records (
  id uuid default gen_random_uuid() not null,
  applicant_id text not null,
  class_option_id text,
  batch_id text,
  session_date date not null,
  class_session text,
  status text default 'present'::text not null,
  marked_by uuid,
  teacher_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (id)
);

create table if not exists public.attendance_log (
  attendance_id uuid default gen_random_uuid() not null,
  student_id text not null,
  group_id text not null,
  subgroup_id text not null,
  batch_id text,
  class_option_id text,
  teacher_name text,
  class_number text,
  class_date date,
  present boolean default false not null,
  made_up boolean default false not null,
  makeup_date date,
  submitted_by_teacher boolean default false not null,
  submission_date timestamptz,
  missing_submission_flag boolean default false not null,
  class1_no_show_flag boolean default false not null,
  consecutive_miss_count integer default 0 not null,
  repeat_absentee_flag boolean default false not null,
  response_id text,
  logged_at timestamptz default now() not null,
  primary key (attendance_id)
);

create table if not exists public.makeup_queue (
  id uuid default gen_random_uuid() not null,
  student_id text not null,
  subgroup_id text,
  batch_id text not null,
  class_number text not null,
  makeup_type text default 'Standard'::text not null,
  deadline date,
  makeup_completed boolean default false not null,
  completed_date date,
  notes text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  primary key (id)
);

create table if not exists public.applicants (
  id uuid default gen_random_uuid() not null,
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  fellowship_code text,
  group_id text,
  class_option_id text,
  born_again text,
  speaks_in_tongues text,
  water_baptized text,
  status text default 'Pending'::text not null,
  submitted_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  batch_id text,
  source text default 'registration_form'::text,
  raw_payload jsonb,
  full_name text,
  duplicate_count int4 default 1,
  needs_admin_review bool default false,
  admin_note text,
  availability text,
  registration_status text,
  availability_status text,
  assigned_at timestamptz,
  waitlisted_at timestamptz,
  reviewed_at timestamptz,
  review_notes text,
  retry_assignment bool default false not null,
  assignment_attempts int4 default 0 not null,
  clickup_task_id text,
  subgroup_id text,
  duplicate_group_id uuid,
  is_primary_duplicate bool default false,
  duplicate_status text default 'UNIQUE'::text,
  duplicate_resolution_note text,
  primary key (id)
);

alter table public.attendance_records add constraint attendance_records_uq unique (applicant_id, class_option_id, session_date, class_session);
alter table public.attendance_log add constraint uq_attendance_no_dup unique nulls not distinct (student_id, class_option_id, class_number, class_date);
alter table public.attendance_log add constraint chk_attendance_present_makeup check (not (present and made_up));
alter table public.attendance_log add constraint attendance_log_batch_id_fkey foreign key (batch_id) references public.batches(batch_id) on delete restrict;
alter table public.attendance_log add constraint attendance_log_class_option_id_fkey foreign key (class_option_id) references public.class_options(class_option_id) on delete restrict;
alter table public.attendance_log add constraint attendance_log_student_id_fkey foreign key (student_id) references public.students(student_id) on delete restrict;
alter table public.class_options add constraint class_options_teacher_id_fkey foreign key (teacher_id) references public.teachers(teacher_id) on delete set null;
alter table public.profiles add constraint profiles_role_check check (role in ('superadmin','admin','subgroup_admin','pastor','principal','teacher','pending','regional_secretary'));
alter table public.profiles add constraint profiles_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

-- Helper functions (verbatim).
CREATE OR REPLACE FUNCTION public.current_profile_role()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_role text;
begin
  if to_regclass('public.profiles') is not null then
    select p.role
      into v_role
    from public.profiles p
    where p.user_id = auth.uid()
      and coalesce(p.is_active, true) = true
    limit 1;
  end if;

  if v_role is null and to_regclass('public.admin_users') is not null then
    select a.role
      into v_role
    from public.admin_users a
    where a.auth_user_id = auth.uid()
    limit 1;
  end if;

  return v_role;
end;
$function$;

CREATE OR REPLACE FUNCTION public.current_teacher_id()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_teacher_id text;
begin
  if to_regclass('public.teachers') is null then
    return null;
  end if;

  select t.teacher_id
    into v_teacher_id
  from public.teachers t
  join auth.users u
    on lower(coalesce(u.email, '')) = lower(coalesce(t.email, ''))
  where u.id = auth.uid()
    and coalesce(t.active, true) = true
    and t.deleted_at is null
  limit 1;

  return v_teacher_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_role()
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT role FROM admin_users
  WHERE auth_user_id = auth.uid()
  AND active = true
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_subgroups()
 RETURNS text[]
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT subgroups FROM admin_users
  WHERE auth_user_id = auth.uid()
  AND active = true
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.is_admin_like()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    public.current_profile_role() IN (
      'admin', 'superadmin', 'regional_secretary',
      'subgroup_admin', 'pastor', 'principal'
    ),
    false
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT coalesce(
    public.current_profile_role() IN (
      'superadmin', 'admin', 'subgroup_admin', 
      'pastor', 'principal', 'regional_secretary'
    ),
    false
  )
$function$;

-- Trigger functions (verbatim) and updated_at helper.
CREATE OR REPLACE FUNCTION public.check_at_risk_on_attendance()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_misses INTEGER;
BEGIN
  v_misses := public.count_consecutive_misses(
    NEW.student_id, NEW.class_option_id
  );
  IF v_misses >= 3 THEN
    UPDATE public.students
    SET needs_attention_flag = true,
        status = 'At Risk',
        needs_attention_reason = '3 or more consecutive missed sessions',
        updated_at = NOW()
    WHERE student_id = NEW.student_id
      AND (status = 'Active' OR status IS NULL);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.count_consecutive_misses(p_student_id text, p_class_option_id text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_streak INTEGER := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT present FROM attendance_log
    WHERE student_id = p_student_id
      AND class_option_id = p_class_option_id
    ORDER BY class_date DESC
    LIMIT 10
  LOOP
    IF r.present = false OR r.present IS NULL THEN
      v_streak := v_streak + 1;
    ELSE
      EXIT;
    END IF;
  END LOOP;
  RETURN v_streak;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_graduation_reeval()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_applicant_id UUID;
BEGIN
  SELECT a.id INTO v_applicant_id
  FROM public.students s
  JOIN public.applicants a ON a.email = s.email
  WHERE s.student_id = NEW.student_id
    AND (NEW.batch_id IS NULL OR a.batch_id = NEW.batch_id)
  LIMIT 1;

  IF v_applicant_id IS NOT NULL THEN
    PERFORM public.evaluate_graduation_eligibility(v_applicant_id, NEW.batch_id);
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_makeup_queue_auto_create()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (NEW.present IS NULL OR NEW.present = false)
     AND (NEW.made_up IS NULL OR NEW.made_up = false)
     AND NEW.class_number IS NOT NULL
     AND NEW.batch_id     IS NOT NULL
     AND NEW.student_id   IS NOT NULL
  THEN
    INSERT INTO public.makeup_queue (
      student_id, subgroup_id, batch_id, class_number,
      makeup_type, deadline, makeup_completed
    )
    SELECT
      NEW.student_id,
      NEW.subgroup_id,
      NEW.batch_id,
      NEW.class_number,
      'Standard',
      CASE WHEN NEW.class_date IS NOT NULL
           THEN (NEW.class_date + INTERVAL '21 days')::DATE
           ELSE NULL
      END,
      false
    WHERE NOT EXISTS (
      SELECT 1 FROM public.makeup_queue mq
      WHERE mq.student_id   = NEW.student_id
        AND mq.batch_id     = NEW.batch_id
        AND mq.class_number = NEW.class_number
        AND mq.makeup_completed = false
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- Triggers (verbatim pg_get_triggerdef).
CREATE TRIGGER trg_at_risk_attendance AFTER INSERT OR UPDATE ON public.attendance_log FOR EACH ROW EXECUTE FUNCTION check_at_risk_on_attendance();
CREATE TRIGGER trg_attendance_graduation_reeval AFTER INSERT OR UPDATE OF present, made_up ON public.attendance_log FOR EACH ROW EXECUTE FUNCTION trigger_graduation_reeval();
CREATE TRIGGER trg_attendance_makeup_create AFTER INSERT OR UPDATE OF present, made_up ON public.attendance_log FOR EACH ROW EXECUTE FUNCTION trigger_makeup_queue_auto_create();
CREATE TRIGGER trg_batches_updated_at BEFORE UPDATE ON public.batches FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER trg_class_options_updated_at BEFORE UPDATE ON public.class_options FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER trg_makeup_queue_updated_at BEFORE UPDATE ON public.makeup_queue FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER trg_students_updated_at BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- RLS enablement (production: relrowsecurity = true; relforcerowsecurity = false).
alter table public.profiles enable row level security;
alter table public.teachers enable row level security;
alter table public.students enable row level security;
alter table public.class_options enable row level security;
alter table public.attendance_records enable row level security;
alter table public.attendance_log enable row level security;
alter table public.admin_users enable row level security;
alter table public.makeup_queue enable row level security;
alter table public.applicants enable row level security;
alter table public.batches enable row level security;

-- Policies (pg_policies, verbatim).
create policy "attendance_admin_all" on public.attendance_log as permissive for all to authenticated using (is_admin_like()) with check (is_admin_like());
create policy "attendance_log_read" on public.attendance_log as permissive for select to authenticated using (((get_admin_role() = 'superadmin'::text) OR (subgroup_id = ANY (get_admin_subgroups()))));
create policy "attendance_log_teacher_insert_assigned" on public.attendance_log as permissive for insert to authenticated with check ((is_admin() OR (EXISTS ( SELECT 1
   FROM (class_options co
     JOIN teachers t ON ((t.teacher_id = co.teacher_id)))
  WHERE ((co.class_option_id = attendance_log.class_option_id) AND ((t.teacher_user_id = auth.uid()) OR ((t.teacher_user_id IS NULL) AND (lower(TRIM(BOTH FROM COALESCE(t.email, ''::text))) = lower(TRIM(BOTH FROM COALESCE((auth.jwt() ->> 'email'::text), ''::text)))))))))));
create policy "attendance_log_teacher_select_assigned" on public.attendance_log as permissive for select to authenticated using ((is_admin() OR (EXISTS ( SELECT 1
   FROM (class_options co
     JOIN teachers t ON ((t.teacher_id = co.teacher_id)))
  WHERE ((co.class_option_id = attendance_log.class_option_id) AND ((t.teacher_user_id = auth.uid()) OR ((t.teacher_user_id IS NULL) AND (lower(TRIM(BOTH FROM COALESCE(t.email, ''::text))) = lower(TRIM(BOTH FROM COALESCE((auth.jwt() ->> 'email'::text), ''::text)))))))))));
create policy "attendance_log_teacher_update_assigned" on public.attendance_log as permissive for update to authenticated using ((is_admin() OR (EXISTS ( SELECT 1
   FROM (class_options co
     JOIN teachers t ON ((t.teacher_id = co.teacher_id)))
  WHERE ((co.class_option_id = attendance_log.class_option_id) AND ((t.teacher_user_id = auth.uid()) OR ((t.teacher_user_id IS NULL) AND (lower(TRIM(BOTH FROM COALESCE(t.email, ''::text))) = lower(TRIM(BOTH FROM COALESCE((auth.jwt() ->> 'email'::text), ''::text))))))))))) with check ((is_admin() OR (EXISTS ( SELECT 1
   FROM (class_options co
     JOIN teachers t ON ((t.teacher_id = co.teacher_id)))
  WHERE ((co.class_option_id = attendance_log.class_option_id) AND ((t.teacher_user_id = auth.uid()) OR ((t.teacher_user_id IS NULL) AND (lower(TRIM(BOTH FROM COALESCE(t.email, ''::text))) = lower(TRIM(BOTH FROM COALESCE((auth.jwt() ->> 'email'::text), ''::text)))))))))));
create policy "attendance_log_update" on public.attendance_log as permissive for update to authenticated using (((get_admin_role() = 'superadmin'::text) OR (subgroup_id = ANY (get_admin_subgroups()))));
create policy "attendance_log_write" on public.attendance_log as permissive for insert to authenticated with check (((get_admin_role() = 'superadmin'::text) OR (subgroup_id = ANY (get_admin_subgroups()))));
create policy "attendance_teacher_rw_assigned" on public.attendance_log as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM (class_options co
     JOIN teachers t ON ((t.teacher_id = co.teacher_id)))
  WHERE ((lower(TRIM(BOTH FROM t.email)) = lower(TRIM(BOTH FROM (auth.jwt() ->> 'email'::text)))) AND (co.class_option_id = attendance_log.class_option_id))))) with check ((EXISTS ( SELECT 1
   FROM (class_options co
     JOIN teachers t ON ((t.teacher_id = co.teacher_id)))
  WHERE ((lower(TRIM(BOTH FROM t.email)) = lower(TRIM(BOTH FROM (auth.jwt() ->> 'email'::text)))) AND (co.class_option_id = attendance_log.class_option_id)))));
create policy "auth_read" on public.attendance_records as permissive for select to public using ((auth.role() = 'authenticated'::text));
create policy "auth_write" on public.attendance_records as permissive for all to public using ((auth.role() = 'authenticated'::text));
create policy "admin_users_admin_write" on public.admin_users as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy "admin_users_self" on public.admin_users as permissive for select to authenticated using ((auth_user_id = auth.uid()));
create policy "admin_users_self_or_admin_select" on public.admin_users as permissive for select to authenticated using (((auth_user_id = auth.uid()) OR is_admin()));
create policy "admin_users_superadmin" on public.admin_users as permissive for all to authenticated using ((get_admin_role() = 'superadmin'::text));
create policy "class_options_admin_all" on public.class_options as permissive for all to authenticated using (is_admin_like()) with check (is_admin_like());
create policy "class_options_anon_select" on public.class_options as permissive for select to anon using (((COALESCE(active, false) = true) AND (COALESCE(enrollment_open, false) = true) AND (deleted_at IS NULL)));
create policy "class_options_teacher_select_assigned" on public.class_options as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM teachers t
  WHERE ((lower(TRIM(BOTH FROM t.email)) = lower(TRIM(BOTH FROM (auth.jwt() ->> 'email'::text)))) AND (t.teacher_id = class_options.teacher_id)))));
create policy "class_options_teacher_select_assigned_hardened" on public.class_options as permissive for select to authenticated using ((is_admin() OR (EXISTS ( SELECT 1
   FROM teachers t
  WHERE ((t.teacher_id = class_options.teacher_id) AND ((t.teacher_user_id = auth.uid()) OR ((t.teacher_user_id IS NULL) AND (lower(TRIM(BOTH FROM COALESCE(t.email, ''::text))) = lower(TRIM(BOTH FROM COALESCE((auth.jwt() ->> 'email'::text), ''::text)))))))))));
create policy "profiles_publishable_select" on public.profiles as permissive for select to authenticated using ((auth.uid() = user_id));
create policy "profiles_self_or_admin_select" on public.profiles as permissive for select to authenticated using (((user_id = auth.uid()) OR is_admin()));
create policy "profiles_self_or_admin_update" on public.profiles as permissive for update to authenticated using (((user_id = auth.uid()) OR is_admin())) with check (((user_id = auth.uid()) OR is_admin()));
create policy "profiles_self_select" on public.profiles as permissive for select to authenticated using (((user_id = auth.uid()) OR is_admin_like()));
create policy "profiles_self_update" on public.profiles as permissive for update to authenticated using (((user_id = auth.uid()) OR is_admin_like())) with check (((user_id = auth.uid()) OR is_admin_like()));
create policy "students_read" on public.students as permissive for select to authenticated using (((get_admin_role() = 'superadmin'::text) OR (subgroup_id = ANY (get_admin_subgroups()))));
create policy "students_teacher_select_assigned" on public.students as permissive for select to authenticated using ((is_admin() OR (EXISTS ( SELECT 1
   FROM (class_options co
     JOIN teachers t ON ((t.teacher_id = co.teacher_id)))
  WHERE ((co.class_option_id = students.class_option_id) AND ((t.teacher_user_id = auth.uid()) OR ((t.teacher_user_id IS NULL) AND (lower(TRIM(BOTH FROM COALESCE(t.email, ''::text))) = lower(TRIM(BOTH FROM COALESCE((auth.jwt() ->> 'email'::text), ''::text)))))))))));
create policy "students_update" on public.students as permissive for update to authenticated using (((get_admin_role() = 'superadmin'::text) OR (subgroup_id = ANY (get_admin_subgroups()))));
create policy "students_write" on public.students as permissive for insert to authenticated with check (((get_admin_role() = 'superadmin'::text) OR (subgroup_id = ANY (get_admin_subgroups()))));
create policy "allow public teacher self registration" on public.teachers as permissive for insert to anon, authenticated with check (((status = 'PENDING'::text) AND (active = false)));
create policy "teachers_admin_all" on public.teachers as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy "teachers_anon_select" on public.teachers as permissive for select to anon using (((COALESCE(active, true) = true) AND (deleted_at IS NULL)));
create policy "teachers_authenticated_select_limited" on public.teachers as permissive for select to authenticated using ((is_admin() OR ((COALESCE(active, true) = true) AND (deleted_at IS NULL))));
create policy "teachers_delete" on public.teachers as permissive for delete to authenticated using ((get_admin_role() = 'superadmin'::text));
create policy "teachers_insert" on public.teachers as permissive for insert to authenticated with check ((get_admin_role() = 'superadmin'::text));
create policy "teachers_update" on public.teachers as permissive for update to authenticated using (((get_admin_role() = 'superadmin'::text) OR ((get_admin_role() = 'pastor'::text) AND (subgroup_id = ANY (get_admin_subgroups())))));
create policy "applicants_admin_all" on public.applicants as permissive for all to authenticated using (is_admin_like()) with check (is_admin_like());
create policy "applicants_admin_all_hardened" on public.applicants as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy "applicants_anon_insert" on public.applicants as permissive for insert to anon with check (((COALESCE(TRIM(BOTH FROM email), ''::text) <> ''::text) AND (COALESCE(TRIM(BOTH FROM full_name), ''::text) <> ''::text)));
create policy "applicants_teacher_select_assigned" on public.applicants as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM (class_options co
     JOIN teachers t ON ((t.teacher_id = co.teacher_id)))
  WHERE ((lower(TRIM(BOTH FROM t.email)) = lower(TRIM(BOTH FROM (auth.jwt() ->> 'email'::text)))) AND (co.class_option_id = applicants.class_option_id)))));
create policy "makeup_admin_all" on public.makeup_queue as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy "makeup_queue_admin_all" on public.makeup_queue as permissive for all to authenticated using (is_admin()) with check (is_admin());
create policy "makeup_regional_secretary_select" on public.makeup_queue as permissive for select to authenticated using ((current_profile_role() = 'regional_secretary'::text));
create policy "makeup_teacher_select" on public.makeup_queue as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM ((students s
     JOIN class_options co ON ((co.class_option_id = s.class_option_id)))
     JOIN teachers t ON ((t.teacher_id = co.teacher_id)))
  WHERE ((s.student_id = makeup_queue.student_id) AND (t.teacher_user_id = auth.uid())))));
