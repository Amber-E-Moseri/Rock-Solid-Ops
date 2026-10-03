// Static deployment inventory (DI01–DI07). No network or CLI needed.
//
// Certified gap: scripts/deploy-functions.sh did not deploy `clickup-sync` or `missed-class-detector`.
//  - clickup-sync is now a 410 tombstone. Not deploying it can leave the OLD LIVE WRITER running in production.
//  - missed-class-detector is the C6 producer.
// Also: root config.toml had clickup-sync verify_jwt = true (platform 401 would intercept the 410) and had no
// entry at all for notification-dispatcher (CLI default verify_jwt = true).
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";

const FUNCTIONS = new URL("./", import.meta.url);
const read = (rel: string) => Deno.readTextFile(new URL(rel, FUNCTIONS));
const deployScript = () => read("../../scripts/deploy-functions.sh");

function listVar(script: string, name: string): string[] {
  const m = script.match(new RegExp(`^${name}="([^"]*)"`, "m"));
  assert(m, `${name} must be declared in deploy-functions.sh`);
  return m![1].split(/\s+/).filter(Boolean);
}

/** `[functions.<name>]` tables of the root supabase/config.toml -> { verify_jwt?, enabled? } */
async function rootConfig(): Promise<Record<string, { verify_jwt?: boolean; enabled?: boolean }>> {
  const toml = await read("../config.toml");
  const out: Record<string, { verify_jwt?: boolean; enabled?: boolean }> = {};
  for (const m of toml.matchAll(/^\[functions\.([a-z0-9_-]+)\]\n((?:(?!\[)[^\n]*\n?)*)/gm)) {
    const body = m[2];
    const v = body.match(/^\s*verify_jwt\s*=\s*(true|false)/m);
    const e = body.match(/^\s*enabled\s*=\s*(true|false)/m);
    out[m[1]] = { verify_jwt: v ? v[1] === "true" : undefined, enabled: e ? e[1] === "true" : undefined };
  }
  return out;
}

const TOMBSTONES = ["clickup-sync", "notification-dispatcher"];
const C6 = ["missed-class-detector", "retry-worker"];

Deno.test("DI01: the C6 producer and reconciler are in the active deploy list", async () => {
  const active = listVar(await deployScript(), "ACTIVE_FUNCTIONS");
  for (const fn of C6) assert(active.includes(fn), `${fn} must be deployed`);
});

Deno.test("DI02: both retired tombstones are deployed (so they REPLACE any live copy)", async () => {
  const retired = listVar(await deployScript(), "RETIRED_TOMBSTONES");
  assertEquals(retired.sort(), [...TOMBSTONES].sort());
});

Deno.test("DI03: every function in the deploy lists exists, and the loop actually deploys both lists", async () => {
  const script = await deployScript();
  const all = [...listVar(script, "ACTIVE_FUNCTIONS"), ...listVar(script, "RETIRED_TOMBSTONES")];
  assertEquals(new Set(all).size, all.length, "no duplicates");
  for (const fn of all) {
    const st = await Deno.stat(new URL(`./${fn}/index.ts`, FUNCTIONS)).catch(() => null);
    assert(st?.isFile, `functions/${fn}/index.ts must exist`);
  }
  assert(/for fn in \$ACTIVE_FUNCTIONS \$RETIRED_TOMBSTONES/.test(script), "the loop covers active AND retired");
  assert(/^set -euo pipefail/m.test(script), "a failed deploy must abort the script, not be skipped silently");
});

Deno.test("DI04: tombstones are verify_jwt=false in the ROOT config the CLI reads, so callers get 410 not a platform 401", async () => {
  const cfg = await rootConfig();
  for (const fn of TOMBSTONES) {
    assert(cfg[fn], `[functions.${fn}] must exist in supabase/config.toml (absent = CLI default verify_jwt=true)`);
    assertEquals(cfg[fn].verify_jwt, false, `${fn} verify_jwt`);
    assertEquals(cfg[fn].enabled, true);
  }
});

Deno.test("DI05: root and per-function config agree for the tombstones and the C6 functions", async () => {
  const cfg = await rootConfig();
  for (const fn of [...TOMBSTONES, ...C6]) {
    const per = await read(`./${fn}/config.toml`).catch(() => "");
    const m = per.match(/^\s*verify_jwt\s*=\s*(true|false)/m);
    if (m) assertEquals(cfg[fn]?.verify_jwt, m[1] === "true", `${fn}: root vs per-function verify_jwt`);
  }
});

Deno.test("DI06: C6 scheduled functions authenticate with x-cron-secret themselves, so verify_jwt=false is correct for them", async () => {
  const cfg = await rootConfig();
  for (const fn of C6) {
    assertEquals(cfg[fn]?.verify_jwt, false);
    assert((await read(`./${fn}/index.ts`)).includes("validateCronAuth"), `${fn} must guard itself`);
  }
});

Deno.test("DI07: the tombstones are actually inert 410 handlers (no secrets, no db client, no outbound call)", async () => {
  for (const fn of TOMBSTONES) {
    const code = (await read(`./${fn}/index.ts`)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert(code.includes("status: 410"));
    assertFalse(/Deno\.env|createClient|fetch\(|\.from\(/.test(code), `${fn} must stay inert`);
  }
});
