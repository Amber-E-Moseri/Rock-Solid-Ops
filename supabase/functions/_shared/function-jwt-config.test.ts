import { assert, assertEquals } from "jsr:@std/assert@1";

// Gateway JWT contract, as approved for the reconciled candidate (owner decision, 2026-10-26):
//   - retry-worker keeps verify_jwt = true at the gateway. Its in-code authorizeRetryRequest() gate still applies.
//   - retry-worker has no per-function config.toml that could override the top-level setting.
//   - moodle-sync is self-authenticating: verify_jwt = false, with authorizeMoodleSyncCaller() in code.
// Changing any of these needs a new owner decision. See docs/BRANCH_HOLDS.md.
const FUNCTIONS_ROOT = new URL("../", import.meta.url);

function topLevelVerifyJwt(toml: string, name: string): string | null {
  const header = `[functions.${name}]`;
  const start = toml.indexOf(header);
  if (start < 0) return null;
  const rest = toml.slice(start + header.length);
  const next = rest.search(/^\[/m);
  const block = next < 0 ? rest : rest.slice(0, next);
  const match = block.match(/^verify_jwt\s*=\s*(true|false)\s*$/m);
  return match ? match[1] : null;
}

Deno.test("retry-worker top-level config keeps the gateway JWT check (approved contract)", async () => {
  const toml = await Deno.readTextFile(new URL("../../config.toml", import.meta.url));
  assertEquals(topLevelVerifyJwt(toml, "retry-worker"), "true");
});

Deno.test("retry-worker has no per-function config that could override the gateway setting", async () => {
  let exists = true;
  try {
    await Deno.stat(new URL("retry-worker/config.toml", FUNCTIONS_ROOT));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) exists = false;
    else throw err;
  }
  assertEquals(exists, false);
});

Deno.test("moodle-sync per-function config disables the gateway JWT check (self-authenticating)", async () => {
  const perFunction = await Deno.readTextFile(new URL("moodle-sync/config.toml", FUNCTIONS_ROOT));
  assert(/^verify_jwt\s*=\s*false\s*$/m.test(perFunction));
});

Deno.test("retry-worker keeps its in-code authorization gate", async () => {
  const source = await Deno.readTextFile(new URL("retry-worker/index.ts", FUNCTIONS_ROOT));
  assert(source.includes("authorizeRetryRequest("));
});

Deno.test("moodle-sync keeps its in-code authorization gate", async () => {
  const source = await Deno.readTextFile(new URL("moodle-sync/index.ts", FUNCTIONS_ROOT));
  assert(source.includes("authorizeMoodleSyncCaller("));
});
