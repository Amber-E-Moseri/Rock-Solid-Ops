import { onlyAssignedSyncJobs, warningRejection } from "./index.ts";

Deno.test("WAITLISTED -> Moodle exclusion: only ASSIGNED jobs are kept for sync", () => {
  const rows = [
    { id: "1", registration_status: "ASSIGNED", sync_status: "PENDING" },
    { id: "2", registration_status: "WAITLISTED", sync_status: "PENDING" },
    { id: "3", registration_status: "REVIEW", sync_status: "RETRYING" },
    { id: "4", registration_status: "ASSIGNED", sync_status: "FAILED" },
  ];

  const filtered = onlyAssignedSyncJobs(rows as any);
  if (filtered.length !== 2) throw new Error(`expected 2 assigned rows, got ${filtered.length}`);
  if (filtered.some((r: any) => String(r.registration_status).toUpperCase() !== "ASSIGNED")) {
    throw new Error("non-ASSIGNED row leaked into Moodle sync batch");
  }
});

Deno.test("warningRejection: a Moodle password-policy warning is detected as a rejection", () => {
  // Real-world shape Moodle returns for a rejected core_user_update_users password:
  // HTTP 200, no top-level `exception`, just a `warnings` array.
  const data = {
    warnings: [
      { item: "user", itemid: 219, warningcode: "passwordpolicynocharacters", message: "Password does not meet policy requirements" },
    ],
  };
  const rejection = warningRejection(data);
  if (!rejection) throw new Error("expected a warning rejection to be detected");
  if (rejection.code !== "passwordpolicynocharacters") throw new Error(`unexpected code: ${rejection.code}`);
});

Deno.test("warningRejection: a clean success response (no warnings) is not treated as a rejection", () => {
  const data = { id: "219", username: "taquangminh081_gmail.com" };
  if (warningRejection(data) !== null) throw new Error("expected no rejection for a warnings-free response");
});

Deno.test("warningRejection: an empty warnings array is not treated as a rejection", () => {
  const data = { warnings: [] };
  if (warningRejection(data) !== null) throw new Error("expected no rejection for an empty warnings array");
});
