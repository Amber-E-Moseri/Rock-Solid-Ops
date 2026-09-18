-- Part 1: Atomic slot reservation RPC ──────────────────────────────────────
-- Replaces the plain applicants INSERT for the ASSIGNED path in
-- registration-processor.  Acquires SELECT ... FOR UPDATE on the class_slots
-- row so the capacity check and the INSERT share the same PostgreSQL
-- transaction.  A second concurrent request for the same slot must wait for
-- the first to commit before reading current_enrolment, which by then
-- already reflects the trigger-incremented value.
--
-- Returns:
--   {ok: true,  applicant_id: "<uuid>"}   slot available, row inserted
--   {ok: false, reason: "CLASS_FULL"}     slot full after lock acquisition
--   {ok: false, reason: "NO_SLOT"}        no slot record; caller falls through
--
-- Counter authority: the sync_class_slot_enrolment() trigger (202609190001)
-- fires on the INSERT and increments current_enrolment.  This function makes
-- no direct write to class_slots.

CREATE OR REPLACE FUNCTION public.insert_applicant_reserve_slot(
  p_applicant JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class_option_id  TEXT;
  v_batch_id         TEXT;
  v_slot             RECORD;
  v_applicant_id     UUID;
BEGIN
  v_class_option_id := NULLIF(TRIM(p_applicant->>'class_option_id'), '');
  v_batch_id        := NULLIF(TRIM(p_applicant->>'batch_id'), '');

  IF v_class_option_id IS NOT NULL AND v_batch_id IS NOT NULL THEN
    -- Serializing lock: any concurrent transaction holding FOR UPDATE on this
    -- row must commit before we read current_enrolment.
    SELECT current_enrolment, max_capacity
      INTO v_slot
      FROM public.class_slots
     WHERE class_option_id = v_class_option_id
       AND batch_id        = v_batch_id
       AND status          = 'Active'
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'NO_SLOT');
    END IF;

    -- max_capacity = 0 or NULL means unlimited.
    IF v_slot.max_capacity IS NOT NULL
       AND v_slot.max_capacity > 0
       AND v_slot.current_enrolment >= v_slot.max_capacity
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'CLASS_FULL');
    END IF;
  END IF;

  INSERT INTO public.applicants (
    id,
    first_name, last_name, full_name,
    email, phone,
    fellowship_code, group_id, subgroup_id,
    class_option_id, batch_id,
    availability,
    status, registration_status, availability_status,
    assigned_at, waitlisted_at, reviewed_at, review_notes,
    retry_assignment, assignment_attempts,
    source, raw_payload,
    duplicate_count, needs_admin_review, admin_note
  ) VALUES (
    COALESCE((p_applicant->>'id')::UUID, gen_random_uuid()),
    COALESCE(p_applicant->>'first_name', ''),
    COALESCE(p_applicant->>'last_name', ''),
    p_applicant->>'full_name',
    p_applicant->>'email',
    p_applicant->>'phone',
    NULLIF(p_applicant->>'fellowship_code', ''),
    NULLIF(p_applicant->>'group_id', ''),
    NULLIF(p_applicant->>'subgroup_id', ''),
    v_class_option_id,
    v_batch_id,
    p_applicant->>'availability',
    COALESCE(p_applicant->>'status', 'Pending'),
    p_applicant->>'registration_status',
    p_applicant->>'availability_status',
    NULLIF(p_applicant->>'assigned_at',    '')::TIMESTAMPTZ,
    NULLIF(p_applicant->>'waitlisted_at',  '')::TIMESTAMPTZ,
    NULLIF(p_applicant->>'reviewed_at',    '')::TIMESTAMPTZ,
    p_applicant->>'review_notes',
    COALESCE((p_applicant->>'retry_assignment')::BOOLEAN,   false),
    COALESCE((p_applicant->>'assignment_attempts')::INTEGER, 1),
    p_applicant->>'source',
    CASE WHEN p_applicant ? 'raw_payload' THEN p_applicant->'raw_payload' ELSE NULL END,
    COALESCE((p_applicant->>'duplicate_count')::INTEGER,     1),
    COALESCE((p_applicant->>'needs_admin_review')::BOOLEAN, false),
    p_applicant->>'admin_note'
  )
  RETURNING id INTO v_applicant_id;

  RETURN jsonb_build_object('ok', true, 'applicant_id', v_applicant_id::TEXT);
END;
$$;

COMMENT ON FUNCTION public.insert_applicant_reserve_slot(JSONB) IS
  'Atomically checks class capacity (SELECT ... FOR UPDATE on class_slots) '
  'and inserts the applicant in the same transaction. '
  'Trigger sync_class_slot_enrolment() increments the counter. '
  'Returns {ok:true,applicant_id} on success; '
  '{ok:false,reason:"CLASS_FULL"} when full after lock; '
  '{ok:false,reason:"NO_SLOT"} when no slot record exists.';

GRANT EXECUTE ON FUNCTION public.insert_applicant_reserve_slot(JSONB) TO service_role;


-- Part 2: Remove stale explicit counter write from class_selection_finalize ──
-- This function was written before the enrolment trigger existed (202605 < 202606).
-- After the trigger was added, the explicit UPDATE class_slots became a
-- second write — double-incrementing current_enrolment on every token-based
-- class selection.  The trigger now owns the counter for this path too.

CREATE OR REPLACE FUNCTION public.class_selection_finalize(
  p_token text,
  p_class_option_id text
)
RETURNS TABLE (
  ok boolean,
  error text,
  applicant_id uuid,
  teacher_name text,
  class_day text,
  class_time text,
  batch_id text,
  fellowship_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tok public.class_selection_tokens%rowtype;
  v_app public.applicants%rowtype;
  v_co  public.class_options%rowtype;
  v_slot public.class_slots%rowtype;
BEGIN
  SELECT * INTO v_tok
  FROM public.class_selection_tokens
  WHERE token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'INVALID_TOKEN', null::uuid, null::text, null::text, null::text, null::text, null::text;
    RETURN;
  END IF;

  IF v_tok.used_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'TOKEN_USED', v_tok.applicant_id, null::text, null::text, null::text, v_tok.batch_id, v_tok.fellowship_code;
    RETURN;
  END IF;

  IF v_tok.expires_at < now() THEN
    RETURN QUERY SELECT false, 'TOKEN_EXPIRED', v_tok.applicant_id, null::text, null::text, null::text, v_tok.batch_id, v_tok.fellowship_code;
    RETURN;
  END IF;

  SELECT * INTO v_app
  FROM public.applicants
  WHERE id = v_tok.applicant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'APPLICANT_NOT_FOUND', v_tok.applicant_id, null::text, null::text, null::text, v_tok.batch_id, v_tok.fellowship_code;
    RETURN;
  END IF;

  SELECT * INTO v_co
  FROM public.class_options
  WHERE class_option_id = p_class_option_id
    AND active = true
    AND enrollment_open = true
    AND deleted_at IS NULL
    AND (fellowship_codes @> array[v_tok.fellowship_code]::text[] OR fellowship_codes @> array['REGIONAL']::text[])
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'CLASS_NOT_ALLOWED', v_tok.applicant_id, null::text, null::text, null::text, v_tok.batch_id, v_tok.fellowship_code;
    RETURN;
  END IF;

  SELECT * INTO v_slot
  FROM public.class_slots
  WHERE class_option_id = p_class_option_id
    AND batch_id = v_tok.batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'SLOT_NOT_FOUND', v_tok.applicant_id, null::text, null::text, null::text, v_tok.batch_id, v_tok.fellowship_code;
    RETURN;
  END IF;

  IF v_slot.max_capacity IS NOT NULL AND v_slot.current_enrolment >= v_slot.max_capacity THEN
    RETURN QUERY SELECT false, 'CLASS_FULL', v_tok.applicant_id, v_co.teacher_name, v_co.day, v_co.class_time, v_tok.batch_id, v_tok.fellowship_code;
    RETURN;
  END IF;

  -- The trigger sync_class_slot_enrolment() fires on this UPDATE and increments
  -- current_enrolment.  The explicit UPDATE class_slots that previously followed
  -- this statement has been removed — it caused a double-increment.
  UPDATE public.applicants
  SET class_option_id     = p_class_option_id,
      registration_status = 'ASSIGNED',
      assigned_at         = now()
  WHERE id = v_tok.applicant_id;

  INSERT INTO public.moodle_enrollment_sync (
    applicant_id, email, full_name, batch_id, class_option_id,
    sync_status, registration_status, created_at, updated_at
  ) VALUES (
    v_app.id, v_app.email, v_app.full_name, v_tok.batch_id, p_class_option_id,
    'PENDING', 'ASSIGNED', now(), now()
  )
  ON CONFLICT (email, batch_id) DO UPDATE SET
    applicant_id        = EXCLUDED.applicant_id,
    class_option_id     = EXCLUDED.class_option_id,
    sync_status         = 'PENDING',
    registration_status = 'ASSIGNED',
    updated_at          = now();

  UPDATE public.class_selection_tokens
  SET used_at              = now(),
      used_class_option_id = p_class_option_id
  WHERE id = v_tok.id;

  RETURN QUERY SELECT true, null::text, v_app.id, v_co.teacher_name, v_co.day, v_co.class_time, v_tok.batch_id, v_tok.fellowship_code;
EXCEPTION
  WHEN OTHERS THEN
    RETURN QUERY SELECT false, LEFT(SQLERRM, 250), v_tok.applicant_id, null::text, null::text, null::text, v_tok.batch_id, v_tok.fellowship_code;
END;
$$;
