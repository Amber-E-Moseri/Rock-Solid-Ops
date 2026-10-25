// Release configuration for retry-worker. JWT verification stays on at the project level, the obsolete
// function-local config is gone, and nothing in the repo schedules retry-worker. Needs --allow-read.
import { assert, assertEquals } from "jsr:@std/assert@1";

const projectConfig = await Deno.readTextFile(new URL("../../config.toml", import.meta.url));

// Body of one TOML table: from its header to the next table header.
function tableBody(toml: string, header: string): string {
  const start = toml.indexOf(header);
  if (start < 0) throw new Error(`${header} not found in supabase/config.toml`);
  const rest = toml.slice(start + header.length);
  const next = rest.search(/^\[/m);
  return next < 0 ? rest : rest.slice(0, next);
}

Deno.test("project config keeps JWT verification on for retry-worker", () => {
  const body = tableBody(projectConfig, "[functions.retry-worker]");
  assert(/^verify_jwt\s*=\s*true\s*$/m.test(body), "verify_jwt must be true");
  assertEquals(/verify_jwt\s*=\s*false/.test(body), false, "verify_jwt must not be disabled");
});

Deno.test("project config defines no schedule for retry-worker", () => {
  const body = tableBody(projectConfig, "[functions.retry-worker]");
  assertEquals(/^schedule\s*=/m.test(body), false, "no schedule key");
});

Deno.test("the obsolete function-local retry-worker config.toml is removed", async () => {
  let exists = true;
  try {
    await Deno.stat(new URL("../retry-worker/config.toml", import.meta.url));
  } catch (err) {
    exists = !(err instanceof Deno.errors.NotFound);
  }
  assertEquals(exists, false, "supabase/functions/retry-worker/config.toml must not exist");
});

Deno.test("project config no longer refers to a function-local retry-worker file", () => {
  assertEquals(projectConfig.includes("retry-worker/config.toml"), false);
});

Deno.test("no migration schedules retry-worker with pg_cron", async () => {
  const migrations = new URL("../../migrations/", import.meta.url);
  const offenders: string[] = [];
  for await (const entry of Deno.readDir(migrations)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const sql = await Deno.readTextFile(new URL(entry.name, migrations));
    if (/cron\.schedule\s*\([^;]*retry-worker/s.test(sql)) offenders.push(entry.name);
  }
  assertEquals(offenders, []);
});

Deno.test("no GitHub workflow schedules or calls retry-worker", async () => {
  const workflows = new URL("../../../.github/workflows/", import.meta.url);
  const offenders: string[] = [];
  for await (const entry of Deno.readDir(workflows)) {
    if (!entry.isFile) continue;
    const text = await Deno.readTextFile(new URL(entry.name, workflows));
    if (/^\s*schedule:/m.test(text) && text.includes("retry-worker")) offenders.push(entry.name);
    if (text.includes("functions/v1/retry-worker")) offenders.push(entry.name);
  }
  assertEquals(offenders, []);
});
