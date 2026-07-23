// Deno tests for the push fan-out helper (PWA Phase C.2).
// Run: deno test --allow-env supabase/functions/_shared/push-notify.test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import { bytesToB64url } from "./webpush.ts";
import { notifyProfilesPush } from "./push-notify.ts";

// Minimal profiles-table mock: records .in()/.eq()/.not() filters and captures
// the update payload used for expired-subscription cleanup.
function mockDb(rows: Array<{ user_id: string; push_subscription: unknown }>) {
  const updates: any[] = [];
  const db = {
    __updates: updates,
    from(_table: string) {
      const q: any = {
        _filterIds: null as string[] | null,
        select() { return q; },
        in(col: string, ids: string[]) { if (col === "user_id") q._filterIds = ids; return q; },
        eq() { return q; },
        not() { return q; },
        then(resolve: (v: any) => void) {
          const data = q._filterIds ? rows.filter((r) => q._filterIds!.includes(r.user_id)) : rows;
          resolve({ data, error: null });
        },
        update(payload: any) {
          return { in: (_c: string, ids: string[]) => { updates.push({ payload, ids }); return Promise.resolve({ error: null }); } };
        },
      };
      return q;
    },
  };
  return db;
}

async function fakeSub() {
  // A structurally valid subscription so real encryption runs before the mocked fetch.
  // p256dh must be a real point on the P-256 curve (ECDH import validates this) —
  // random bytes with just the 0x04 uncompressed-point prefix are not, so derive it
  // from an actual generated keypair rather than faking the bytes directly.
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const rawPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { endpoint: "https://push.example.com/x", keys: { p256dh: bytesToB64url(rawPublic), auth: bytesToB64url(crypto.getRandomValues(new Uint8Array(16))) } };
}

function withVapid() {
  Deno.env.set("VAPID_PUBLIC_KEY", "BOVlCDUmr1OpRqO8-NjWRm5c38_6XTXunZmhGHr4PNODrLC7qk_6zcDMZ7ywAgV7O-wDpuuyQE-nX67KxFgqmJg");
  Deno.env.set("VAPID_PRIVATE_KEY", "OEL0ht9AcYecpe8FtAoVwO52L0PYNXlUflaQ88C-1kc");
  Deno.env.set("VAPID_SUBJECT", "mailto:ops@example.com");
}

Deno.test("skips (no-op, not error) when VAPID is unconfigured", async () => {
  ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"].forEach((k) => Deno.env.delete(k));
  const db = mockDb([{ user_id: "u1", push_subscription: await fakeSub() }]);
  const res = await notifyProfilesPush(db, ["u1"], { title: "T", body: "B" });
  assert(res.skipped);
  assertEquals(res.attempted, 0);
});

Deno.test("no recipients → nothing attempted", async () => {
  withVapid();
  const db = mockDb([]);
  const res = await notifyProfilesPush(db, [], { title: "T", body: "B" });
  assertEquals(res.attempted, 0);
  assertEquals(res.sent, 0);
});

Deno.test("sends to subscribed profiles and counts 201 as sent", async () => {
  withVapid();
  const orig = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(null, { status: 201 }));
  try {
    const db = mockDb([
      { user_id: "u1", push_subscription: await fakeSub() },
      { user_id: "u2", push_subscription: await fakeSub() },
    ]);
    const res = await notifyProfilesPush(db, ["u1", "u2"], { title: "Reg", body: "ASSIGNED", type: "registration_status" });
    assertEquals(res.attempted, 2);
    assertEquals(res.sent, 2);
    assertEquals(res.expired, 0);
    assertEquals(db.__updates.length, 0); // no cleanup when nothing expired
  } finally {
    globalThis.fetch = orig;
  }
});

Deno.test("410 Gone marks subscription expired and clears it", async () => {
  withVapid();
  const orig = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response("gone", { status: 410 }));
  try {
    const db = mockDb([{ user_id: "u1", push_subscription: await fakeSub() }]);
    const res = await notifyProfilesPush(db, ["u1"], { title: "T", body: "B" });
    assertEquals(res.expired, 1);
    assertEquals(res.sent, 0);
    assertEquals(db.__updates.length, 1);
    assertEquals(db.__updates[0].ids, ["u1"]);
    assertEquals(db.__updates[0].payload.push_enabled, false);
    assertEquals(db.__updates[0].payload.push_subscription, null);
  } finally {
    globalThis.fetch = orig;
  }
});

Deno.test("dedupes recipient ids", async () => {
  withVapid();
  const orig = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls += 1; return Promise.resolve(new Response(null, { status: 201 })); };
  try {
    const db = mockDb([{ user_id: "u1", push_subscription: await fakeSub() }]);
    const res = await notifyProfilesPush(db, ["u1", "u1", "u1"], { title: "T", body: "B" });
    assertEquals(res.attempted, 1);
    assertEquals(calls, 1);
  } finally {
    globalThis.fetch = orig;
  }
});
