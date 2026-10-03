// Retired functions answer 410 (or are tombstones); health pages must not list them as live
// expectations, or an intentionally retired endpoint makes operational health look wrong.
import { assertFalse } from "jsr:@std/assert@1";

const FILES = [
  "../../foundation/js/system-health.js",
  "../../foundation/staff/env-check.html",
  "../../foundation-spa/src/features/system-health/lib/system-health.js",
];
const RETIRED = ["clickup-sync", "notification-dispatcher"];

for (const rel of FILES) {
  Deno.test(`health probe list excludes retired functions: ${rel.split("/").pop()}`, async () => {
    const src = await Deno.readTextFile(new URL(rel, import.meta.url));
    const m = /const edgeFunctions = \[([^\]]*)\]/.exec(src);
    if (!m) throw new Error(`edgeFunctions list not found in ${rel}`);
    for (const fn of RETIRED) assertFalse(m[1].includes(fn), `${rel} still probes retired function ${fn}`);
  });
}
