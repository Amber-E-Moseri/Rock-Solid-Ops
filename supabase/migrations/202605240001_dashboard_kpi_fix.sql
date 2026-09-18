-- Drop first to handle signature changes
DROP FUNCTION IF EXISTS public.get_active_certified_teachers_count();

CREATE OR REPLACE FUNCTION public.get_active_certified_teachers_count()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::bigint
  FROM public.teachers
  WHERE status = 'ACTIVE'
    AND active = true
    AND deleted_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_certified_teachers_count() TO authenticated;

-- Drop first to handle signature changes
DROP FUNCTION IF EXISTS public.get_currently_teaching_count(text);

CREATE OR REPLACE FUNCTION public.get_currently_teaching_count(p_batch_id text)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT co.teacher_id)::bigint
  FROM public.class_options co
  JOIN public.class_slots cs
    ON cs.class_option_id = co.class_option_id
  WHERE co.active = true
    AND cs.batch_id::text = p_batch_id
    AND cs.status = 'Active';
$$;

GRANT EXECUTE ON FUNCTION public.get_currently_teaching_count(text) TO authenticated;

-- Drop first to handle signature changes
DROP FUNCTION IF EXISTS public.get_registration_funnel(text);

CREATE OR REPLACE FUNCTION public.get_registration_funnel(
  p_batch_id text DEFAULT NULL
)
RETURNS TABLE (
  registered_count bigint,
  reviewed_count bigint,
  assigned_count bigint,
  waitlisted_count bigint,
  duplicate_count bigint,
  conversion_json jsonb,
  calculated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_registered bigint := 0;
  v_reviewed bigint := 0;
  v_assigned bigint := 0;
  v_waitlisted bigint := 0;
  v_duplicate bigint := 0;
BEGIN
  IF to_regclass('public.applicants') IS NULL THEN
    RETURN QUERY SELECT 0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,'[]'::jsonb,now();
    RETURN;
  END IF;

  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE upper(coalesce(a.registration_status, 'PENDING')) NOT IN ('PENDING'))::bigint,
    COUNT(*) FILTER (WHERE upper(coalesce(a.registration_status, '')) = 'ASSIGNED')::bigint,
    COUNT(*) FILTER (WHERE upper(coalesce(a.registration_status, '')) = 'WAITLISTED')::bigint,
    COUNT(*) FILTER (WHERE upper(coalesce(a.registration_status, '')) = 'DUPLICATE')::bigint
  INTO v_registered, v_reviewed, v_assigned, v_waitlisted, v_duplicate
  FROM public.applicants a
  WHERE (p_batch_id IS NULL OR a.batch_id::text = p_batch_id);

  RETURN QUERY
  SELECT
    v_registered,
    v_reviewed,
    v_assigned,
    v_waitlisted,
    v_duplicate,
    jsonb_build_array(
      jsonb_build_object('stage','Registered','count',v_registered,'pct_from_previous',100),
      jsonb_build_object('stage','Reviewed','count',v_reviewed,'pct_from_previous',CASE WHEN v_registered=0 THEN 0 ELSE round((v_reviewed::numeric*100.0)/v_registered::numeric,1) END),
      jsonb_build_object('stage','Assigned','count',v_assigned,'pct_from_previous',CASE WHEN v_reviewed=0 THEN 0 ELSE round((v_assigned::numeric*100.0)/v_reviewed::numeric,1) END),
      jsonb_build_object('stage','Waitlisted','count',v_waitlisted,'pct_from_previous',CASE WHEN v_assigned=0 THEN 0 ELSE round((v_waitlisted::numeric*100.0)/v_assigned::numeric,1) END),
      jsonb_build_object('stage','Duplicate','count',v_duplicate,'pct_from_previous',CASE WHEN v_waitlisted=0 THEN 0 ELSE round((v_duplicate::numeric*100.0)/v_waitlisted::numeric,1) END)
    ),
    now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_registration_funnel(text) TO authenticated;
