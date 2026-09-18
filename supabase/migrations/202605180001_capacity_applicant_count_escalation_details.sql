-- ── 1. get_capacity_summary — add applicant_count ─────────────────────────────
-- Drop first to handle signature changes (return type)
DROP FUNCTION IF EXISTS public.get_capacity_summary(text, text[]);

CREATE OR REPLACE FUNCTION public.get_capacity_summary(
  p_batch_id  text    DEFAULT NULL,
  p_subgroups text[]  DEFAULT NULL
)
RETURNS TABLE (
  class_option_id text,
  day             text,
  class_time      text,
  fellowship      text,
  batch_id        text,
  max_capacity    integer,
  enrolled_count  bigint,
  applicant_count bigint,
  pct             numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'class_slots'
  ) THEN RETURN; END IF;

  RETURN QUERY
    SELECT
      co.class_option_id::text,
      co.day::text,
      co.class_time::text,
      COALESCE((co.fellowship_codes)[1], co.subgroup_id::text, 'Unknown')::text,
      cs.batch_id::text,
      COALESCE(cs.max_capacity, co.max_capacity, 0)::integer,
      COUNT(DISTINCT cr.id)::bigint,
      COALESCE(ac.cnt, 0)::bigint,
      CASE WHEN COALESCE(cs.max_capacity, co.max_capacity, 0) > 0
           THEN ROUND(COUNT(DISTINCT cr.id) * 100.0
                  / NULLIF(COALESCE(cs.max_capacity, co.max_capacity, 0), 0), 1)
           ELSE 0::numeric
      END
    FROM class_slots cs
    JOIN class_options co ON co.class_option_id = cs.class_option_id
    LEFT JOIN class_roster cr
           ON cr.class_option_id = co.class_option_id
          AND cr.batch_id        = cs.batch_id
          AND cr.status          = 'Active'
    LEFT JOIN (
      SELECT a.class_option_id, a.batch_id, COUNT(*) AS cnt
      FROM applicants a
      WHERE a.class_option_id IS NOT NULL AND a.batch_id IS NOT NULL
      GROUP BY a.class_option_id, a.batch_id
    ) ac ON ac.class_option_id = co.class_option_id::text
         AND ac.batch_id       = cs.batch_id
    WHERE cs.status != 'Cancelled'
      AND (p_batch_id IS NULL OR cs.batch_id = p_batch_id)
      AND (p_subgroups IS NULL OR cardinality(p_subgroups) = 0
           OR co.subgroup_id::text = ANY(p_subgroups))
    GROUP BY co.class_option_id, co.day, co.class_time,
             co.fellowship_codes, co.subgroup_id,
             cs.batch_id, cs.max_capacity, co.max_capacity,
             ac.cnt
    ORDER BY co.day, co.class_time;
EXCEPTION WHEN OTHERS THEN RETURN;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_capacity_summary(text, text[]) TO authenticated;


-- ── 2. get_escalation_details — per-task view with person + class detail ───────
-- Drop first to handle signature changes (return type)
DROP FUNCTION IF EXISTS public.get_escalation_details(text[], int);

CREATE OR REPLACE FUNCTION public.get_escalation_details(
  p_subgroups text[] DEFAULT NULL,
  p_limit     int    DEFAULT 100
)
RETURNS TABLE (
  id              uuid,
  source_type     text,
  task_status     text,
  clickup_task_id text,
  error_message   text,
  person_name     text,
  person_email    text,
  class_info      text,
  source_ref      text,
  created_at      timestamptz,
  updated_at      timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'clickup_task_links'
  ) THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    ctl.id,
    ctl.source_type::text,
    ctl.status::text,
    ctl.clickup_task_id::text,
    ctl.error_message::text,
    -- person_name
    CASE
      WHEN ctl.source_type = 'escalation:applicants'
        THEN COALESCE(a.first_name || ' ' || a.last_name, ctl.source_id)
      WHEN ctl.source_type = 'missed_class'
        THEN split_part(ctl.source_id, ':', 1)
      ELSE ctl.source_id
    END::text,
    -- person_email
    CASE
      WHEN ctl.source_type = 'escalation:applicants' THEN a.email
      ELSE NULL
    END::text,
    -- class_info
    CASE
      WHEN ctl.source_type = 'escalation:applicants'
        THEN COALESCE(
          co_a.day || ' ' || co_a.class_time
            || COALESCE(' — ' || (co_a.fellowship_codes)[1], ''),
          'Unknown class'
        )
      WHEN ctl.source_type = 'missed_class'
        THEN COALESCE(
          co_m.day || ' ' || co_m.class_time
            || ' (class ' || split_part(ctl.source_id, ':', 3)
            || ', ' || split_part(ctl.source_id, ':', 4) || ')',
          split_part(ctl.source_id, ':', 2)
        )
      ELSE NULL
    END::text,
    ctl.source_id::text,
    ctl.created_at,
    ctl.updated_at
  FROM clickup_task_links ctl
  LEFT JOIN applicants a
         ON ctl.source_type = 'escalation:applicants'
        AND a.id::text = ctl.source_id
  LEFT JOIN class_options co_a
         ON ctl.source_type = 'escalation:applicants'
        AND co_a.class_option_id = a.class_option_id
  LEFT JOIN class_options co_m
         ON ctl.source_type = 'missed_class'
        AND co_m.class_option_id = split_part(ctl.source_id, ':', 2)
  ORDER BY ctl.created_at DESC
  LIMIT p_limit;
EXCEPTION WHEN OTHERS THEN RETURN;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_escalation_details(text[], int) TO authenticated;
