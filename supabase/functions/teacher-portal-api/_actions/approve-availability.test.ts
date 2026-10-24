import { approveAvailabilityAction, AVAILABILITY_APPROVAL_HOLD_MESSAGE } from "./approve-availability.ts";
import { ApiError } from "../_lib/errors.ts";

// Every database touch is recorded. A held action must touch none of them.
function recordingDb() {
  const touched: string[] = [];
  const db = {
    from(table: string) {
      touched.push(`from:${table}`);
      throw new Error("from() must not be reached while held");
    },
    rpc(name: string) {
      touched.push(`rpc:${name}`);
      throw new Error("rpc() must not be reached while held");
    },
  };
  return { db, touched };
}

Deno.test("approveAvailability refuses while uncertified, with ACTION_HELD and 423", async () => {
  const { db, touched } = recordingDb();
  const ctx = {
    db,
    auth: { user: { id: "u1" }, teacher: { email: "admin@example.com" } },
    params: { availabilityId: "00000000-0000-0000-0000-000000000001" },
  } as any;

  let caught: unknown = null;
  try {
    await approveAvailabilityAction(ctx);
  } catch (err) {
    caught = err;
  }

  if (!(caught instanceof ApiError)) throw new Error("expected ApiError");
  if (caught.code !== "ACTION_HELD") throw new Error(`expected ACTION_HELD, got ${caught.code}`);
  if (caught.status !== 423) throw new Error(`expected 423, got ${caught.status}`);
  if (caught.message !== AVAILABILITY_APPROVAL_HOLD_MESSAGE) throw new Error("unexpected hold message");
  if (touched.length !== 0) throw new Error(`held action touched the database: ${touched.join(", ")}`);
});

Deno.test("approveAvailability refuses even without an availabilityId, before any validation", async () => {
  const { db, touched } = recordingDb();
  const ctx = { db, auth: { user: { id: "u1" }, teacher: { email: "a@b.c" } }, params: {} } as any;
  let code = "";
  try {
    await approveAvailabilityAction(ctx);
  } catch (err) {
    code = (err as ApiError).code;
  }
  if (code !== "ACTION_HELD") throw new Error(`expected ACTION_HELD, got ${code}`);
  if (touched.length !== 0) throw new Error("held action touched the database");
});
