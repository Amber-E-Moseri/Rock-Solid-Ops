begin;

-- =============================================================
-- Web Push (PWA Phase C.2): mark which attention flags have already been
-- pushed, so the 5-minute sweep is idempotent (no cursor drift, no re-nudging).
-- Date: 2026-07-13
--
-- attention_flags has no edge-function INSERT hook, so push for "attention flag
-- raised" runs as a periodic sweep (attention-flag-push-sweep, retry-worker
-- cron pattern). The sweep selects unresolved flags with push_notified_at IS
-- NULL, sends ONE batched nudge to admins, then stamps push_notified_at — so a
-- flag is nudged at most once and a skipped run just picks it up next time.
-- Additive + idempotent.
-- =============================================================

alter table public.attention_flags
  add column if not exists push_notified_at timestamptz;

comment on column public.attention_flags.push_notified_at is
  'When the attention-flag push sweep included this flag in a nudge. NULL = not yet pushed. Used only for the complementary push channel; the in-app attention queue is unaffected.';

-- Sweep hot path: unresolved + not-yet-pushed, oldest first.
create index if not exists idx_attention_flags_unpushed
  on public.attention_flags (created_at)
  where resolved = false and push_notified_at is null;

commit;
