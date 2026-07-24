begin;

-- =============================================================
-- Web Push (PWA Phase C.2): per-profile push subscription storage.
-- Date: 2026-07-13
--
-- Adds the columns the client subscribe flow writes and the edge sender reads.
-- Push reaches authenticated staff/teachers only — applicants have no auth
-- accounts, so this lives on `profiles` (keyed to auth.users), never on any
-- applicant table.
--
-- RLS: intentionally NO new policies. `profiles` is already governed by
--   profiles_self_or_admin_select  (SELECT: user_id = auth.uid() OR is_admin())
--   profiles_self_or_admin_update  (UPDATE: user_id = auth.uid() OR is_admin())
-- (see 202605061400_rls_hardening.sql). Those give exactly the required
-- behaviour: a user may read/write ONLY their own row's push columns; no
-- cross-profile access; admins (trusted) may read. The self-role/activation
-- protection triggers do not touch these columns, so a self-subscribe update
-- is permitted. Adding push-specific policies would be redundant and risk
-- widening access, so we rely on the existing ones by design.
-- =============================================================

alter table public.profiles
  add column if not exists push_subscription  jsonb,
  add column if not exists push_subscribed_at  timestamptz,
  add column if not exists push_enabled         boolean not null default false;

comment on column public.profiles.push_subscription is
  'Web Push subscription (PushSubscription.toJSON(): endpoint + keys{p256dh,auth}). Self-written by the client subscribe flow; read by the push-sender edge function. NULL when not subscribed.';
comment on column public.profiles.push_subscribed_at is
  'Timestamp of the most recent successful push subscription.';
comment on column public.profiles.push_enabled is
  'True when the profile has an active push subscription the sender may target.';

-- Sender lookups target specific user_ids (PK), but this partial index keeps
-- "all currently-subscribed profiles" scans cheap and small.
create index if not exists idx_profiles_push_enabled
  on public.profiles (user_id)
  where push_enabled = true and push_subscription is not null;

commit;
