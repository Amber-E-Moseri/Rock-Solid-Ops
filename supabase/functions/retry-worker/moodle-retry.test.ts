// C3B retry-worker tests — manual Moodle retry semantics
//
// T13  manual retry clears next_retry_at (immediate eligibility after manual trigger)
// T14  manual retry preserves retry_count
// T15  manual retry produces RETRYING state for legitimately retryable rows
// T16  terminal-cap retry is truthful: retry-worker accepts it, moodle-sync
//      re-terminalizes immediately without a Moodle API call

import { assert, assertEquals } from "jsr:@std/assert@1";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const moodleSyncSrc = await Deno.readTextFile(
  new URL("../moodle-sync/index.ts", import.meta.url),
);

// Locate the applyRetry block for moodle_enrollment_sync
function moodleApplyRetryBlock(): string {
  const start = src.indexOf('if (source === "moodle_enrollment_sync")');
  if (start === -1) throw new Error("applyRetry moodle_enrollment_sync block not found");
  const returnPos = src.indexOf("return;", start);
  return src.slice(start, returnPos + 7);
}

function updatePatchBlock(block: string): string {
  const updateStart = block.indexOf(".update({");
  const updateEnd = block.indexOf("})", updateStart);
  return block.slice(updateStart, updateEnd + 2);
}

// T13 ─────────────────────────────────────────────────────────────────────────

Deno.test("T13: manual retry clears next_retry_at so row is immediately eligible", () => {
  const block = moodleApplyRetryBlock();
  assert(
    block.includes("next_retry_at: null"),
    "applyRetry for moodle_enrollment_sync must set next_retry_at: null",
  );
});

// T14 ─────────────────────────────────────────────────────────────────────────

Deno.test("T14: manual retry does not modify retry_count (preserves failure history)", () => {
  const patch = updatePatchBlock(moodleApplyRetryBlock());
  assertEquals(
    patch.includes("retry_count"),
    false,
    "applyRetry patch must not include retry_count — existing count is preserved",
  );
});

// T15 ─────────────────────────────────────────────────────────────────────────

Deno.test("T15: manual retry produces RETRYING state", () => {
  const block = moodleApplyRetryBlock();
  assert(block.includes('"RETRYING"'), "applyRetry must set sync_status to RETRYING");
  assert(block.includes("status: \"RETRYING\""), "applyRetry must set both status and sync_status to RETRYING");
});

// T16 ─────────────────────────────────────────────────────────────────────────

Deno.test("T16: terminal-cap retry is truthful — retry-worker accepts but moodle-sync re-terminalizes", () => {
  // retry-worker's isRetryableMoodleError gate does not check retry_count.
  // MAX_RETRIES_EXCEEDED falls through to classifyError (UNKNOWN/retryable=true),
  // so retry-worker allows a cap-exceeded row to be set RETRYING.
  // moodle-sync's pre-check (retry_count >= maxRetries) then terminates it
  // immediately without making a Moodle API call — correct, truthful behavior.

  // Verify retry-worker does not check retry_count before calling applyRetry
  const retryBlock = src.slice(src.indexOf('if (action === "retry")'));
  const beforeApplyRetry = retryBlock.slice(0, retryBlock.indexOf("await applyRetry"));
  assertEquals(
    beforeApplyRetry.includes("retry_count"),
    false,
    "retry-worker must not check retry_count — moodle-sync handles the cap",
  );

  // Verify moodle-sync's pre-check terminates at cap before any Moodle call
  const capCheck = moodleSyncSrc.indexOf("retryCount >= maxRetries");
  assert(capCheck !== -1, "moodle-sync must have retry_count >= maxRetries pre-check");

  // Verify the cap check triggers PERMANENTLY_FAILED
  const capBlock = moodleSyncSrc.slice(capCheck, moodleSyncSrc.indexOf("continue;", capCheck));
  assert(
    capBlock.includes("PERMANENTLY_FAILED"),
    "moodle-sync cap pre-check must mark PERMANENTLY_FAILED before any Moodle call",
  );

  // Verify the cap pre-check fires BEFORE the PROCESSING patch (no wasted Moodle call)
  const processingPatch = moodleSyncSrc.indexOf("sync_status: \"PROCESSING\"");
  assert(capCheck < processingPatch, "cap pre-check must occur before the PROCESSING patch");
});
