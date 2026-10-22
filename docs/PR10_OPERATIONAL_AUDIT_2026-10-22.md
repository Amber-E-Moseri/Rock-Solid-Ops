# PR #10 operational audit — production cron, pg_net and Edge Function evidence

Status: **draft evidence record. Not a release approval.** PR #10 (`reconcile/main-onto-origin-2026-10-22`, head `e4bac97`) remains draft, unmerged and **NO-GO**.

Project: `foundation-school` (`xelpsttqhrcqmttmjory`). All production access was read-only. No production writes, cron changes, deployments, retries or secret changes were made.

## 1. Evidence sources and their limits

| Source | Window | What it can show | What it cannot show |
|---|---|---|---|
| `cron.job` (SELECT) | current | job names, schedules, active flag, function slug, auth header class | secret values (not read) |
| `cron.job_run_details` (SELECT) | 24 h to 2026-10-22 05:45 UTC | each cron execution and its pg_cron status | whether the HTTP call got a response |
| `net._http_response` (SELECT) | 2026-10-21 23:50 to 2026-10-22 05:45 UTC (about six hours, the retained window) | status code, `timed_out`, error presence, time | which job or function sent the request; no request ID or URL column |
| Edge Function invocation export (dashboard, redacted) | 2026-10-22 12:55:01 to 13:50:02 UTC (about 55 minutes, one page) | function, timestamp, status, execution time | downstream business outcome; request ID cannot be matched to pg_net |

## 2. pg_net HTTP responses, 23:50 to 05:45 UTC

- 319 responses retained.
- 118 returned 200 (37%).
- 201 have `status_code` NULL with `timed_out = true` and an error recorded (63%).
- Zero 401, 403, 429, or 5xx. Zero other 4xx or 3xx.
- Cron-invoked HTTP runs in the same window: 315. The four-row difference is unexplained at job level.
- No response history before 23:50 UTC, although `cron.job_run_details` covers 24 h.

Timeouts are a **transport outcome** recorded by pg_net. A timeout does not show whether the function ran, failed, or was rejected.

## 3. Edge Function invocation export, 12:55 to 13:50 UTC on 2026-10-22

**Timestamp units.** The export gives microseconds since the Unix epoch (for example `1792677002936000`). Dividing by 1,000,000 and converting to UTC gives `2026-10-22 13:50:02.936 UTC`. The export covers 53 rows from 12:55:01 to 13:50:02 UTC.

**Per-function summary (53 rows, all HTTP 200, all POST):**

| Function (deployed version) | Rows | Status | Execution ms: min / median / max | Mean ms |
|---|---|---|---|---|
| email-sender (v65) | 12 | 200 ×12 | 1,052 / 1,398.5 / 2,325 | 1,458 |
| moodle-sync (v84) | 12 | 200 ×12 | 930 / 1,291.5 / 2,191 | 1,359 |
| attention-flag-push-sweep (v13) | 12 | 200 ×12 | 732 / 1,034 / 1,776 | 1,125 |
| notification-batch-processor (v20) | 12 | 200 ×12 | 694 / 1,028.5 / 2,455 | 1,185 |
| waitlist-processor (v27) | 4 | 200 ×4 | 2,615 / — / 4,481 | 3,563 |
| retry-worker (v48) | 1 | 200 ×1 | 2,002 | 2,002 |

Medians for four-row groups use the mean of the two central values. Mean and median are computed from the 53 rows as exported.

**Coverage and cadence check against production `cron.job`:**

- The five-minute jobs (email-sender, moodle-sync, attention-flag-push-sweep, notification-batch-processor) each produced one invocation in each of the twelve five-minute slots from 12:55 to 13:50. That matches the schedule exactly.
- waitlist-processor (`*/15`) produced invocations at 13:00:05, 13:15:04, 13:30:04 and 13:45:03. That matches.
- retry-worker (`0 * * * *`) produced one invocation at 13:00:02. That matches.
- Total expected in this window: 4 × 12 + 4 + 1 = 53. Observed: 53. **No missing invocations within this slice.**

**Schedule drift observed (not PR #10 issues, but relevant to review):**

- email-sender runs every five minutes. The repository `config.toml` says every 15 minutes.
- notification-batch-processor runs every five minutes. The repository `config.toml` says daily at 09:00.
- attention-flag-push-sweep runs every five minutes. No repository schedule is defined.

## 4. Observed failures

- **HTTP failures in this slice:** none. All 53 invocations returned 200.
- **Authentication failures in this slice:** none (no 401 or 403).
- **Rate limiting or server errors in this slice:** none (no 429 or 5xx).
- **Earlier window (23:50 to 05:45 UTC):** 201 pg_net timeouts, no 401 or 403 visible in pg_net. Function-side outcomes for those requests are **not** covered by any export received so far.

## 5. Successful HTTP response versus downstream work

A 200 from an Edge Function shows the request was accepted and the function returned a successful response. It does **not** show that:

- emails were sent (email-sender),
- Moodle enrolments were synchronised (moodle-sync),
- notification batches were delivered (notification-batch-processor),
- waitlist promotions were applied (waitlist-processor).

Downstream evidence would come from database state (for example `email_queue` status transitions, `moodle_enrollment_sync` timestamps, `audit_logs` entries). No such read has been authorised, so **email and Moodle business outcomes are unverified.**

## 6. Correlation limitations

- `net._http_response` has no request ID, URL or job column. It cannot be tied to a function or cron job.
- `cron.job_run_details` has no request ID. Its `return_message` is only a row count.
- The Edge Function export has an `execution_id` and an `id`, but neither can be matched to a pg_net record.
- Within a five-minute slot, four jobs fire at the same time, so pg_net outcomes can only be attributed to a slot, never to a job.
- The export does not overlap with the timeout window, so **no individual timeout can be linked to a function invocation.**

## 7. Hypotheses (not verified)

1. **pg_net timeout threshold shorter than typical execution.** Median execution is about 1–1.5 s, with waitlist-processor at 3–4.5 s. If the client-side timeout is short, responses that complete late would be recorded as timeouts even though the function ran. Unverified; the timeout parameter is in the cron command text, which has not been read.
2. **Cold-start or queueing latency.** Execution time may exclude platform queueing. Unverified.
3. **Slow waitlist-processor.** This function is the slowest and runs every 15 minutes. It may be the most exposed to timeouts. Unverified.

## 8. Duplicate-execution and retry risk (design review, not observed)

- pg_net does not retry requests on timeout. A timed-out request is not automatically resent.
- A timed-out request may still have executed on the function side. The next scheduled run could then process the same work again.
- Mitigations in the repository, not confirmed in production:
  - `email-sender`: a `Processing` claim state (from the email-queue claim protocol).
  - `notification-batch-processor`: `claim_notification_batch()` with `claimed_at`, deployed 2026-09-24 (C1).
  - `moodle-sync`: `PROCESSING` state and the failure-state contract.
- Overlap risk is low for the observed durations (all under 2.5 s, against a five-minute interval).

## 9. Missing evidence to investigate the 201 timeouts

1. Full Edge Function invocation logs for **2026-10-21 23:50 to 2026-10-22 05:45 UTC**, all pages, with status, execution time and sanitised error category.
2. Function-side error or console events in the same window, to see whether timed-out requests executed and failed.
3. The pg_net timeout value used by each cron job (read from the command text, redacted). Not read so far.
4. Downstream evidence for email and Moodle: `email_queue` and `moodle_enrollment_sync` state changes in the same window.
5. Deployed function source for the 12 functions named in section 3, to confirm which auth path each runs.

## 10. PR #10 release blockers (updated)

| # | Blocker | Status |
|---|---|---|
| B1 | pg_net timeouts (201 of 319) unexplained; function-side outcome unknown | **Open** |
| B2 | Cron credential acceptance by deployed functions not proven (200s seen, but no per-function proof) | **Open** |
| B3 | admin-api `invoke-moodle-sync` action missing from deployed admin-api (static dependency) | **Open** (separate blocker) |
| B4 | `FAILED`/`RETRYING` Moodle retry selection behaviour change | **Open** (owner decision) |
| B5 | `verify_jwt` changes for retry-worker and four other functions | **Open** (not verified against deployed config) |
| B6 | Three production-applied migrations absent from `origin/main` | Open (history-parity) |
| B7 | Migration replay and security regression not run locally (Docker unavailable); GitHub checks pass | Open (CI passes) |
| B8 | C6 and Nexus external checks | Out of scope for PR #10 |
| B9 | Missing production schedules: `attendance-reminder-daily` and `missed-class-detector` | Pre-existing, not PR #10 |

## 11. Recommendation

- **PR #10: NO-GO for merge.** It remains draft.
- **Cron authentication (B2):** observed production cron requests use `x-cron-secret`, and this slice shows 200 responses from scheduled functions. This is strong but incomplete evidence. A release should not rely on it alone.
- **Next operational action:** obtain the full log export for 23:50 to 05:45 UTC (item 9.1) and, with approval, the pg_net timeout parameter (item 9.3). No production change should be made until the timeout cause is known.
