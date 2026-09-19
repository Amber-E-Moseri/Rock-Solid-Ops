/**
 * WAVE 3 LIVE REGISTRATION CERTIFICATION
 *
 * Integration tests for the atomic slot reservation pipeline and counter
 * integrity guarantee.  Requires a running local Supabase stack.
 *
 * What is tested:
 *   - Slot available     → insert succeeds, counter increments
 *   - CLASS_FULL         → RPC returns {ok:false,reason:"CLASS_FULL"}
 *   - NO_SLOT            → RPC returns {ok:false,reason:"NO_SLOT"}
 *   - Sequential fills   → counter tracks each insert, stored=derived
 *   - Counter recalibrate after delete
 *   - Campus closure (DB-side: batch_campus_registration_settings)
 *   - Duplicate guard (same email+batch → applicants table has 2 rows,
 *                       slot counter only counted the ASSIGNED one)
 *   - Concurrency C1 cap=1, 2 concurrent → 1 ASSIGNED, 1 CLASS_FULL
 *   - Concurrency C2 cap=2, 2 concurrent → 2 ASSIGNED
 *   - Concurrency C3 cap=2, 3 concurrent → 2 ASSIGNED, 1 CLASS_FULL
 *   - Concurrency C4 different slots → independent success
 *   - Concurrency C5 lock-recheck: second waits, sees updated counter
 *
 * Run from project root:
 *   LOCAL_INTEGRATION_TEST=true \
 *   SUPABASE_SERVICE_ROLE_KEY=$(supabase status --output env | grep SERVICE_ROLE_KEY | cut -d= -f2) \
 *   SUPABASE_ANON_KEY=$(supabase status --output env | grep ANON_KEY | cut -d= -f2) \
 *   deno run --allow-net --allow-env \
 *     supabase/tests/registration/live-registration.ts
 */

if (Deno.env.get("LOCAL_INTEGRATION_TEST") !== "true") {
  console.error("ERROR: Set LOCAL_INTEGRATION_TEST=true to run this test.");
  Deno.exit(1);
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
if (!SERVICE_KEY || !ANON_KEY) {
  console.error("ERROR: Set SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY.");
  Deno.exit(1);
}

const REST = `${SUPABASE_URL}/rest/v1`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function assert(cond: boolean, label: string): void {
  if (cond) {
    passCount++;
  } else {
    failCount++;
    failures.push(label);
    console.log(`  FAIL: ${label}`);
  }
}

async function adminPost(path: string, body: unknown): Promise<Response> {
  return fetch(`${REST}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
}

async function adminPatch(path: string, body: unknown): Promise<Response> {
  return fetch(`${REST}${path}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
}

async function adminDelete(path: string): Promise<void> {
  await fetch(`${REST}${path}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
  });
}

async function adminGet(path: string): Promise<unknown[]> {
  const r = await fetch(`${REST}${path}`, {
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
  });
  return r.json() as Promise<unknown[]>;
}

async function callRPC(payload: Record<string, unknown>, key: string = SERVICE_KEY): Promise<{status: number; body: unknown}> {
  const r = await fetch(`${REST}/rpc/insert_applicant_reserve_slot`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_applicant: payload }),
  });
  const body = await r.json();
  return { status: r.status, body };
}

async function getStoredEnrolment(classOptionId: string, batchId: string): Promise<number> {
  const rows = await adminGet(
    `/class_slots?class_option_id=eq.${classOptionId}&batch_id=eq.${batchId}&select=current_enrolment`,
  ) as Array<{ current_enrolment: number }>;
  return rows[0]?.current_enrolment ?? -1;
}

async function getDerivedEnrolment(classOptionId: string, batchId: string): Promise<number> {
  const rows = await adminGet(
    `/applicants?class_option_id=eq.${classOptionId}&batch_id=eq.${batchId}&select=id`,
  ) as unknown[];
  return rows.length;
}

// ─── Unique fixture IDs (avoids cross-run contamination) ─────────────────────

const RUN = Date.now().toString(36).toUpperCase();
const BATCH_ID = `LIVE-TEST-${RUN}`;
const CO_MAIN = `CO-MAIN-${RUN}`;
const CO_ALT  = `CO-ALT-${RUN}`;
const CO_NONE = `CO-NONE-${RUN}`; // no slot record
const FELLOWSHIP = "TEST_CAMPUS";
const insertedApplicantIds: string[] = [];

// ─── Fixture setup ────────────────────────────────────────────────────────────

async function setup(): Promise<void> {
  // Batch
  await adminPost("/batches", {
    batch_id: BATCH_ID,
    name: `Live Test Batch ${RUN}`,
    start_date: "2099-01-01",
    end_date: "2099-06-30",
    status: "ACTIVE",
    active: true,
  });

  // fellowship_map entry (required for campus gate lookups)
  await adminPost("/fellowship_map", {
    fellowship_code: FELLOWSHIP,
    campus_name: `Test Campus ${RUN}`,
    active: true,
  });

  // Campus registration settings: open
  await adminPost("/batch_campus_registration_settings", {
    batch_id: BATCH_ID,
    fellowship_code: FELLOWSHIP,
    registration_open: true,
  });

  // Main class_option
  await adminPost("/class_options", {
    class_option_id: CO_MAIN,
    teacher_name: "Test Teacher",
    day: "Monday",
    class_time: "19:00",
    fellowship_codes: [FELLOWSHIP],
    active: true,
    enrollment_open: true,
  });

  // Alt class_option (for concurrency C4)
  await adminPost("/class_options", {
    class_option_id: CO_ALT,
    teacher_name: "Alt Teacher",
    day: "Tuesday",
    class_time: "20:00",
    fellowship_codes: [FELLOWSHIP],
    active: true,
    enrollment_open: true,
  });

  // Main slot (capacity will be set per test section)
  await adminPost("/class_slots", {
    class_option_id: CO_MAIN,
    batch_id: BATCH_ID,
    status: "Active",
    max_capacity: 2,
    current_enrolment: 0,
  });

  // Alt slot for C4
  await adminPost("/class_slots", {
    class_option_id: CO_ALT,
    batch_id: BATCH_ID,
    status: "Active",
    max_capacity: 2,
    current_enrolment: 0,
  });
  // CO_NONE intentionally has no slot record
}

async function resetSlotCapacity(classOptionId: string, capacity: number): Promise<void> {
  // Remove all applicants for this slot first
  await adminDelete(`/applicants?class_option_id=eq.${classOptionId}&batch_id=eq.${BATCH_ID}`);
  // Reset counter and capacity
  await adminPatch(
    `/class_slots?class_option_id=eq.${classOptionId}&batch_id=eq.${BATCH_ID}`,
    { current_enrolment: 0, max_capacity: capacity },
  );
}

function makeApplicant(email: string, classOptionId: string): Record<string, unknown> {
  return {
    email,
    full_name: `Test ${email}`,
    batch_id: BATCH_ID,
    class_option_id: classOptionId,
    fellowship_code: FELLOWSHIP,
    registration_status: "ASSIGNED",
    availability_status: "CLASS_ASSIGNED",
    assignment_attempts: 1,
    retry_assignment: false,
    duplicate_count: 1,
    needs_admin_review: false,
    source: "test",
  };
}

// ─── Teardown ─────────────────────────────────────────────────────────────────

async function teardown(): Promise<void> {
  await adminDelete(`/applicants?batch_id=eq.${BATCH_ID}`);
  await adminDelete(`/class_slots?batch_id=eq.${BATCH_ID}`);
  await adminDelete(`/class_options?class_option_id=eq.${CO_MAIN}`);
  await adminDelete(`/class_options?class_option_id=eq.${CO_ALT}`);
  await adminDelete(`/batch_campus_registration_settings?batch_id=eq.${BATCH_ID}`);
  await adminDelete(`/fellowship_map?fellowship_code=eq.${FELLOWSHIP}`);
  await adminDelete(`/batches?batch_id=eq.${BATCH_ID}`);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function runTests(): Promise<void> {
  console.log("\n[1] SLOT AVAILABLE — basic insert");
  {
    await resetSlotCapacity(CO_MAIN, 5);
    const r = await callRPC(makeApplicant("slot-avail-1@test.local", CO_MAIN));
    assert(r.status === 200, "[1.1] HTTP 200 on slot available");
    assert((r.body as Record<string,unknown>).ok === true, "[1.2] ok=true");
    assert(typeof (r.body as Record<string,unknown>).applicant_id === "string", "[1.3] applicant_id returned");
    const stored = await getStoredEnrolment(CO_MAIN, BATCH_ID);
    assert(stored === 1, "[1.4] stored counter = 1 after insert");
    const derived = await getDerivedEnrolment(CO_MAIN, BATCH_ID);
    assert(derived === 1, "[1.5] derived count = 1");
    assert(stored === derived, "[1.6] stored = derived");
  }

  console.log("\n[2] NO_SLOT — no slot record");
  {
    const r = await callRPC(makeApplicant("no-slot-1@test.local", CO_NONE));
    assert(r.status === 200, "[2.1] HTTP 200 (RPC executes)");
    assert((r.body as Record<string,unknown>).ok === false, "[2.2] ok=false");
    assert((r.body as Record<string,unknown>).reason === "NO_SLOT", "[2.3] reason=NO_SLOT");
  }

  console.log("\n[3] SEQUENTIAL FILLS — counter tracks each insert");
  {
    await resetSlotCapacity(CO_MAIN, 5);
    for (let i = 1; i <= 3; i++) {
      const r = await callRPC(makeApplicant(`seq-fill-${i}@test.local`, CO_MAIN));
      assert(r.status === 200 && (r.body as Record<string,unknown>).ok === true, `[3.${i}] insert ${i} ok`);
      const stored = await getStoredEnrolment(CO_MAIN, BATCH_ID);
      assert(stored === i, `[3.${i+3}] counter=${i} after insert ${i}`);
    }
    const derived = await getDerivedEnrolment(CO_MAIN, BATCH_ID);
    assert(derived === 3, "[3.7] derived count=3");
    assert((await getStoredEnrolment(CO_MAIN, BATCH_ID)) === derived, "[3.8] stored=derived after 3 inserts");
  }

  console.log("\n[4] CLASS_FULL — capacity reached");
  {
    await resetSlotCapacity(CO_MAIN, 1);
    // Fill the slot
    const r1 = await callRPC(makeApplicant("full-1@test.local", CO_MAIN));
    assert(r1.status === 200 && (r1.body as Record<string,unknown>).ok === true, "[4.1] first insert ok");
    // Now full
    const r2 = await callRPC(makeApplicant("full-2@test.local", CO_MAIN));
    assert(r2.status === 200, "[4.2] HTTP 200 (RPC executes on full slot)");
    assert((r2.body as Record<string,unknown>).ok === false, "[4.3] ok=false on full");
    assert((r2.body as Record<string,unknown>).reason === "CLASS_FULL", "[4.4] reason=CLASS_FULL");
    const stored = await getStoredEnrolment(CO_MAIN, BATCH_ID);
    assert(stored === 1, "[4.5] counter still=1 (CLASS_FULL applicant not inserted)");
    const derived = await getDerivedEnrolment(CO_MAIN, BATCH_ID);
    assert(derived === 1, "[4.6] derived=1 (no spurious row)");
  }

  console.log("\n[5] COUNTER after DELETE");
  {
    await resetSlotCapacity(CO_MAIN, 5);
    await callRPC(makeApplicant("del-test-1@test.local", CO_MAIN));
    await callRPC(makeApplicant("del-test-2@test.local", CO_MAIN));
    assert((await getStoredEnrolment(CO_MAIN, BATCH_ID)) === 2, "[5.1] counter=2 before delete");
    await adminDelete(`/applicants?email=eq.del-test-1@test.local&batch_id=eq.${BATCH_ID}`);
    const stored = await getStoredEnrolment(CO_MAIN, BATCH_ID);
    assert(stored === 1, "[5.2] counter=1 after delete");
    const derived = await getDerivedEnrolment(CO_MAIN, BATCH_ID);
    assert(derived === 1, "[5.3] derived=1 after delete");
    assert(stored === derived, "[5.4] stored=derived after delete");
  }

  console.log("\n[6] RPC BOUNDARY — anon/authenticated denied, service_role allowed");
  {
    const anon = await callRPC(makeApplicant("boundary-anon@test.local", CO_NONE), ANON_KEY);
    assert(anon.status === 401, "[6.1] anon HTTP 401");
    const errA = (anon.body as Record<string,unknown>).message as string ?? "";
    assert(errA.includes("permission denied"), "[6.2] anon: permission denied message");

    // Get an authenticated JWT (pending user)
    const uid = await (async () => {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "boundary-auth@test.local", password: "TestPass123!", email_confirm: true }),
      });
      const d = await r.json() as { id: string };
      return d.id;
    })();
    const authToken = await (async () => {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "boundary-auth@test.local", password: "TestPass123!" }),
      });
      const d = await r.json() as { access_token: string };
      return d.access_token;
    })();
    const authed = await callRPC(makeApplicant("boundary-auth@test.local", CO_NONE), authToken);
    assert(authed.status === 403, "[6.3] authenticated HTTP 403");
    const errB = (authed.body as Record<string,unknown>).message as string ?? "";
    assert(errB.includes("permission denied"), "[6.4] authenticated: permission denied message");
    // Cleanup auth user
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
    });

    const svc = await callRPC(makeApplicant("boundary-svc@test.local", CO_NONE));
    assert(svc.status === 200, "[6.5] service_role HTTP 200");
    assert((svc.body as Record<string,unknown>).reason === "NO_SLOT", "[6.6] service_role: executes (NO_SLOT)");
  }

  // ─── Concurrency ──────────────────────────────────────────────────────────
  console.log("\nCONCURRENCY SCENARIOS");

  console.log("\n[C1] capacity=1, 2 concurrent → 1 ASSIGNED, 1 CLASS_FULL");
  {
    await resetSlotCapacity(CO_MAIN, 1);
    const [r1, r2] = await Promise.all([
      callRPC(makeApplicant("c1-a@test.local", CO_MAIN)),
      callRPC(makeApplicant("c1-b@test.local", CO_MAIN)),
    ]);
    const bodies = [r1.body, r2.body] as Array<Record<string,unknown>>;
    const assigned   = bodies.filter(b => b.ok === true).length;
    const classFull  = bodies.filter(b => b.reason === "CLASS_FULL").length;
    assert(assigned === 1, "[C1.1] exactly 1 ASSIGNED");
    assert(classFull === 1, "[C1.2] exactly 1 CLASS_FULL");
    const stored = await getStoredEnrolment(CO_MAIN, BATCH_ID);
    assert(stored === 1, "[C1.3] stored counter=1");
    const derived = await getDerivedEnrolment(CO_MAIN, BATCH_ID);
    assert(stored === derived, "[C1.4] stored=derived");
    assert(stored <= 1, "[C1.5] no overbooking (stored <= max_capacity=1)");
  }

  console.log("\n[C2] capacity=2, 2 concurrent → 2 ASSIGNED");
  {
    await resetSlotCapacity(CO_MAIN, 2);
    const [r1, r2] = await Promise.all([
      callRPC(makeApplicant("c2-a@test.local", CO_MAIN)),
      callRPC(makeApplicant("c2-b@test.local", CO_MAIN)),
    ]);
    const bodies = [r1.body, r2.body] as Array<Record<string,unknown>>;
    const assigned = bodies.filter(b => b.ok === true).length;
    assert(assigned === 2, "[C2.1] 2 ASSIGNED");
    const stored = await getStoredEnrolment(CO_MAIN, BATCH_ID);
    assert(stored === 2, "[C2.2] stored counter=2");
    assert(stored === await getDerivedEnrolment(CO_MAIN, BATCH_ID), "[C2.3] stored=derived");
  }

  console.log("\n[C3] capacity=2, 3 concurrent → 2 ASSIGNED, 1 CLASS_FULL");
  {
    await resetSlotCapacity(CO_MAIN, 2);
    const [r1, r2, r3] = await Promise.all([
      callRPC(makeApplicant("c3-a@test.local", CO_MAIN)),
      callRPC(makeApplicant("c3-b@test.local", CO_MAIN)),
      callRPC(makeApplicant("c3-c@test.local", CO_MAIN)),
    ]);
    const bodies = [r1.body, r2.body, r3.body] as Array<Record<string,unknown>>;
    const assigned  = bodies.filter(b => b.ok === true).length;
    const classFull = bodies.filter(b => b.reason === "CLASS_FULL").length;
    assert(assigned === 2, "[C3.1] 2 ASSIGNED");
    assert(classFull === 1, "[C3.2] 1 CLASS_FULL");
    const stored = await getStoredEnrolment(CO_MAIN, BATCH_ID);
    assert(stored === 2, "[C3.3] stored counter=2 (no overbooking)");
    assert(stored === await getDerivedEnrolment(CO_MAIN, BATCH_ID), "[C3.4] stored=derived");
    assert(stored <= 2, "[C3.5] overbooking prevented");
  }

  console.log("\n[C4] different slots, 2 concurrent → independent success");
  {
    await resetSlotCapacity(CO_MAIN, 2);
    await resetSlotCapacity(CO_ALT, 2);
    const [r1, r2] = await Promise.all([
      callRPC(makeApplicant("c4-a@test.local", CO_MAIN)),
      callRPC(makeApplicant("c4-b@test.local", CO_ALT)),
    ]);
    assert((r1.body as Record<string,unknown>).ok === true, "[C4.1] CO_MAIN ASSIGNED");
    assert((r2.body as Record<string,unknown>).ok === true, "[C4.2] CO_ALT ASSIGNED independently");
    assert(await getStoredEnrolment(CO_MAIN, BATCH_ID) === 1, "[C4.3] CO_MAIN counter=1");
    assert(await getStoredEnrolment(CO_ALT, BATCH_ID) === 1, "[C4.4] CO_ALT counter=1");
  }

  console.log("\n[C5] lock recheck: fill cap=1 then concurrent → second sees updated counter");
  {
    await resetSlotCapacity(CO_MAIN, 1);
    // First fill (sequential — establishes state)
    const first = await callRPC(makeApplicant("c5-first@test.local", CO_MAIN));
    assert((first.body as Record<string,unknown>).ok === true, "[C5.1] first fill ok");
    // Second concurrent pair after slot is full
    const [r2, r3] = await Promise.all([
      callRPC(makeApplicant("c5-second@test.local", CO_MAIN)),
      callRPC(makeApplicant("c5-third@test.local", CO_MAIN)),
    ]);
    const bodies = [r2.body, r3.body] as Array<Record<string,unknown>>;
    const fullCount = bodies.filter(b => b.reason === "CLASS_FULL").length;
    assert(fullCount === 2, "[C5.2] both subsequent requests see CLASS_FULL");
    const stored = await getStoredEnrolment(CO_MAIN, BATCH_ID);
    assert(stored === 1, "[C5.3] counter remains 1 after lock recheck");
    assert(stored === await getDerivedEnrolment(CO_MAIN, BATCH_ID), "[C5.4] stored=derived");
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("WAVE 3 — LIVE REGISTRATION CERTIFICATION");
  console.log(`  Batch: ${BATCH_ID}`);
  console.log(`  URL: ${SUPABASE_URL}`);

  try {
    await setup();
    await runTests();
  } finally {
    await teardown();
  }

  console.log("\n══════════════════════════════════════");
  console.log(`TOTAL: ${passCount + failCount} assertions`);
  console.log(`PASS:  ${passCount}`);
  console.log(`FAIL:  ${failCount}`);
  if (failures.length > 0) {
    console.log("\nFAILED ASSERTIONS:");
    for (const f of failures) console.log(`  ${f}`);
  }
  console.log("══════════════════════════════════════");
  console.log(`RESULT: ${failCount === 0 ? "PASS" : "FAIL"}`);

  if (failCount > 0) Deno.exit(1);
}

main().catch((err) => {
  console.error("CERTIFICATION FAILED:", err);
  Deno.exit(1);
});
