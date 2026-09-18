-- Canonicalize audit logging on public.audit_logs with compatibility for legacy public.audit_log.
-- Safe to run multiple times.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NULL AND to_regclass('public.audit_log') IS NOT NULL THEN
    ALTER TABLE public.audit_log RENAME TO audit_logs;
  END IF;
END $$;

-- Schema reconciliation: Ensure renamed audit_log matches the fresh-create schema
DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS actor_email text NULL;
    ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS actor_id text NULL;
    ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS status text NULL;
    ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NULL THEN
    CREATE TABLE public.audit_logs (
      id bigserial PRIMARY KEY,
      logged_at timestamptz NOT NULL DEFAULT now(),
      actor_email text NULL,
      actor_id text NULL,
      action text NOT NULL,
      entity_type text NULL,
      entity_id text NULL,
      status text NULL,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='audit_logs' AND column_name='notes'
  ) THEN
    UPDATE public.audit_logs
    SET details = COALESCE(details, '{}'::jsonb) || jsonb_build_object('legacy_notes', notes)
    WHERE notes IS NOT NULL
      AND (details IS NULL OR NOT (details ? 'legacy_notes'));
  END IF;
END $$;

-- Ensure compatibility for any remaining legacy reads/writes against public.audit_log.
DO $$
BEGIN
  IF to_regclass('public.audit_log') IS NOT NULL THEN
    DROP VIEW IF EXISTS public.audit_log;
  END IF;
EXCEPTION
  WHEN wrong_object_type THEN
    -- Existing object is not a view; drop in next block.
    NULL;
END $$;

DO $$
BEGIN
  IF to_regclass('public.audit_log') IS NOT NULL THEN
    DROP TABLE public.audit_log;
  END IF;
END $$;

CREATE VIEW public.audit_log AS
SELECT
  id,
  action,
  entity_type,
  entity_id,
  status AS notes,
  actor_email AS changed_by,
  details AS after_data,
  logged_at AS changed_at,
  actor_id,
  status,
  details,
  created_at
FROM public.audit_logs;

CREATE OR REPLACE FUNCTION public.audit_log_insert_redirect()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.audit_logs (
    logged_at,
    actor_email,
    actor_id,
    action,
    entity_type,
    entity_id,
    status,
    details,
    created_at
  )
  VALUES (
    COALESCE(NEW.changed_at, NEW.logged_at, now()),
    NEW.changed_by,
    NEW.actor_id,
    COALESCE(NEW.action, 'LEGACY_AUDIT_EVENT'),
    NEW.entity_type,
    NEW.entity_id,
    COALESCE(NEW.status, NEW.notes),
    COALESCE(NEW.after_data, NEW.details, '{}'::jsonb),
    COALESCE(NEW.created_at, now())
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS audit_log_insert_redirect_trigger ON public.audit_log;
CREATE TRIGGER audit_log_insert_redirect_trigger
INSTEAD OF INSERT ON public.audit_log
FOR EACH ROW
EXECUTE FUNCTION public.audit_log_insert_redirect();

COMMIT;
