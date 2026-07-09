DROP FUNCTION IF EXISTS public.detect_registration_duplicates(TEXT, TEXT, REAL);

CREATE OR REPLACE FUNCTION public.detect_registration_duplicates(
  batch_id_param TEXT,
  subgroup_id_param TEXT DEFAULT NULL,
  similarity_threshold REAL DEFAULT 0.85
)
RETURNS TABLE (
  duplicate_group_id UUID,
  applicant_ids UUID[],
  detection_method TEXT,
  detection_score REAL
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

  INSERT INTO public.duplicate_registration_groups
    (batch_id, subgroup_id, fellowship_code, duplicate_count, detection_method, detection_score)
  SELECT
    batch_id_param,
    MIN(a.subgroup_id),
    MIN(a.fellowship_code),
    COUNT(*)::INTEGER,
    'email_match',
    1.0
  FROM public.applicants a
  WHERE a.batch_id = batch_id_param
    AND (subgroup_id_param IS NULL OR a.subgroup_id = subgroup_id_param)
    AND a.duplicate_status != 'RESOLVED'
    AND a.email IS NOT NULL
    AND a.email != ''
  GROUP BY LOWER(a.email)
  HAVING COUNT(*) > 1
    AND NOT EXISTS (
      SELECT 1
      FROM public.duplicate_registration_groups dg_check
      JOIN public.applicants a_check ON a_check.duplicate_group_id = dg_check.id
      WHERE a_check.batch_id = batch_id_param
        AND LOWER(a_check.email) = LOWER(a.email)
    );

  UPDATE public.applicants tgt
  SET
    duplicate_group_id = grp.id,
    duplicate_status   = 'CONFIRMED'
  FROM public.duplicate_registration_groups grp
  WHERE grp.batch_id        = batch_id_param
    AND tgt.batch_id        = batch_id_param
    AND tgt.duplicate_status != 'RESOLVED'
    AND tgt.duplicate_group_id IS NULL
    AND LOWER(tgt.email) IN (
      SELECT LOWER(a2.email)
      FROM public.applicants a2
      WHERE a2.duplicate_group_id = grp.id
    );

  RETURN QUERY
  SELECT
    dg.id,
    ARRAY_AGG(a.id) FILTER (WHERE a.id IS NOT NULL),
    'email_match'::TEXT,
    1.0::REAL
  FROM public.duplicate_registration_groups dg
  LEFT JOIN public.applicants a ON a.duplicate_group_id = dg.id
  WHERE dg.batch_id = batch_id_param
    AND dg.detection_method = 'email_match'
  GROUP BY dg.id;

END;
$$;

GRANT EXECUTE ON FUNCTION public.detect_registration_duplicates(TEXT, TEXT, REAL) TO authenticated;