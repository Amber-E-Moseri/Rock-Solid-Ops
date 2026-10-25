import { assert, assertEquals } from "jsr:@std/assert@1";

// The two self-authenticating functions must not depend on the gateway JWT check. Each must also
// keep its in-code authorization call, so disabling the gateway check never removes the guard.
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

Deno.test("retry-worker top-level config disables the gateway JWT check", async () => {
  const toml = await Deno.readTextFile(new URL("../../config.toml", import.meta.url));
  assertEquals(topLevelVerifyJwt(toml, "retry-worker"), "false");
});

Deno.test("retry-worker top-level config agrees with its per-function config", async () => {
  const perFunction = await Deno.readTextFile(new URL("retry-worker/config.toml", FUNCTIONS_ROOT));
  assert(/^verify_jwt\s*=\s*false\s*$/m.test(perFunction));
});

Deno.test("moodle-sync per-function config disables the gateway JWT check", async () => {
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
