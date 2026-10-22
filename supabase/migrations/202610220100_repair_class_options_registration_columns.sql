-- Repair: restore class_options columns recorded as applied by 202605190900
-- but absent from the production schema.
--
-- Production recorded 202605190900_class_options_online_multicampus as applied, with the
-- same statement text as this repository, yet public.class_options has neither
-- is_online nor confirmed_start_date. The registration form's class-options query
-- selects both columns, so every request fails with PostgreSQL 42703.
--
-- This migration is the same additive DDL as 202605190900, written idempotently.
-- It does not change existing values except to fill the new defaults:
--   is_online            -> false for every existing row (same meaning as the form's
--                           "r.is_online === true" check: in-person by default)
--   confirmed_start_date -> NULL for every existing row (same as the designed
--                           state before a teacher's first attendance submission)
-- It does not touch RLS policies, functions, triggers, indexes or other columns.
--
-- Safe to re-run: IF NOT EXISTS on both columns.

ALTER TABLE public.class_options
  ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirmed_start_date DATE NULL;
