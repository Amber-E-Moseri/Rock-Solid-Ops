import { assert } from "jsr:@std/assert@1";

// Ordering contract for index.ts. The caller check must run before the body is read or any
// database access, and the class-state gate must run before any notification side effect.
const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("the caller check is applied in the request handler", () => {
  assert(source.includes("authorizeWaitlistCaller({"));
});

Deno.test("the caller check runs before the request body is read", () => {
  const gate = source.indexOf("authorizeWaitlistCaller({");
  const body = source.indexOf("await req.json()");
  assert(gate > 0 && body > 0 && gate < body, "authorization must precede body parsing");
});

Deno.test("an unauthorized caller gets a status response and no further work", () => {
  const gate = source.indexOf("authorizeWaitlistCaller({");
  const refusal = source.indexOf("if (!decision.ok)", gate);
  const body = source.indexOf("await req.json()");
  assert(refusal > gate && refusal < body);
  assert(source.slice(refusal, body).includes("return jsonResponse("));
});

Deno.test("the refusal body carries the same statusCode as the HTTP status", () => {
  assert(source.includes("return jsonResponse({ ok: false, error: decision.code, statusCode: decision.status }, decision.status);"));
});

Deno.test("the class-state gate runs before any notification for a slot", () => {
  const gate = source.indexOf("if (!isClassOpenForSelection(classInfo))");
  const notify = source.indexOf("await notifyClassNowAvailable(slot, classInfo, results);");
  assert(gate > 0 && notify > 0 && gate < notify, "class state must be checked before notifying");
  assert(source.slice(gate, notify).includes("continue;"), "a closed class must skip the slot");
});

Deno.test("the slot status gate runs before the class lookup", () => {
  const slotGate = source.indexOf("if (!isSlotActive(slot)) continue;");
  const lookup = source.indexOf("await getClassInfo(slot.class_option_id)");
  assert(slotGate > 0 && lookup > 0 && slotGate < lookup);
});

Deno.test("skipped closed classes are reported in the run result", () => {
  assert(source.includes("skipped_class_closed: 0,"));
  assert(source.includes("results.skipped_class_closed += 1;"));
});

Deno.test("both slot queries select status, so the slot gate can read it", () => {
  const selects = source.match(/\.select\("class_slot_id,[^"]*"\)/g) ?? [];
  assert(selects.length === 2, `expected 2 slot queries, found ${selects.length}`);
  for (const select of selects) {
    assert(select.split(",").includes("status"), `slot query omits status: ${select}`);
  }
});

Deno.test("the slot row type declares status", () => {
  assert(/interface Slot \{[^}]*\bstatus: string;/.test(source));
});

Deno.test("class lookup selects the state fields the gate needs", () => {
  assert(source.includes('.select("teacher_name,day,class_time,fellowship_codes,active,enrollment_open,deleted_at")'));
});
