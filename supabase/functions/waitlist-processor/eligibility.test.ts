import { assertEquals } from "jsr:@std/assert@1";
import { isClassOpenForSelection, isSlotActive } from "./eligibility.ts";

Deno.test("an active, registration-open, undeleted class is open for selection", () => {
  assertEquals(isClassOpenForSelection({ active: true, enrollment_open: true, deleted_at: null }), true);
});

Deno.test("a registration-closed class is not open for selection", () => {
  assertEquals(isClassOpenForSelection({ active: true, enrollment_open: false, deleted_at: null }), false);
});

Deno.test("an inactive class is not open for selection", () => {
  assertEquals(isClassOpenForSelection({ active: false, enrollment_open: true, deleted_at: null }), false);
});

Deno.test("a soft-deleted class is not open for selection, even if otherwise open", () => {
  assertEquals(isClassOpenForSelection({ active: true, enrollment_open: true, deleted_at: "2026-10-26T12:00:00Z" }), false);
});

Deno.test("a class with missing state fields is not open for selection", () => {
  assertEquals(isClassOpenForSelection({}), false);
  assertEquals(isClassOpenForSelection({ active: true, enrollment_open: null }), false);
  assertEquals(isClassOpenForSelection({ active: "true" as unknown as boolean, enrollment_open: true }), false);
});

Deno.test("a missing class row is not open for selection", () => {
  assertEquals(isClassOpenForSelection(null), false);
  assertEquals(isClassOpenForSelection(undefined), false);
});

// Rows shaped exactly as the processor's slot select returns them (see index.ts).
const slotRow = {
  class_slot_id: "slot-1",
  class_option_id: "CO-CEA-FRI-0900-RSOTEST",
  batch_id: "2025A",
  status: "Active",
  max_capacity: 1,
  current_enrolment: 0,
};

Deno.test("an Active slot row passes the slot gate and a Cancelled one does not", () => {
  assertEquals(isSlotActive(slotRow), true);
  assertEquals(isSlotActive({ ...slotRow, status: "Cancelled" }), false);
});

Deno.test("a slot row without status fails closed", () => {
  assertEquals(isSlotActive({ ...slotRow, status: undefined }), false);
});

Deno.test("only an Active slot is processed", () => {
  assertEquals(isSlotActive({ status: "Active" }), true);
  assertEquals(isSlotActive({ status: "Cancelled" }), false);
  assertEquals(isSlotActive({ status: "Closed" }), false);
  assertEquals(isSlotActive({ status: "active" }), false);
  assertEquals(isSlotActive({ status: null }), false);
  assertEquals(isSlotActive(null), false);
});
