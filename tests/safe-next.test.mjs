// Static login `next` validation. Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// foundation/auth/safe-next.js is a browser ES module with no package.json
// scope, so Node would load it as CommonJS. Load its source as an ES module.
const src = readFileSync(
  fileURLToPath(new URL("../foundation/auth/safe-next.js", import.meta.url)),
  "utf8"
);
const { safeNextPath } = await import(
  "data:text/javascript;base64," + Buffer.from(src).toString("base64")
);

test("accepts same-origin application paths", () => {
  for (const ok of [
    "/foundation/staff/dashboards.html",
    "/foundation/staff/StudentProgressView.html?id=12&tab=notes#top",
    "/staff/dashboards",
    "/foundation/teacher/index.html",
    "/staff/student-progress?next=%2Fstaff%2Fdashboards",
  ]) {
    assert.equal(safeNextPath(ok), ok, ok);
  }
});

test("rejects protocol-relative and absolute targets", () => {
  for (const bad of [
    "//evil.example",
    "//evil.example/foundation/auth/login.html",
    "https://evil.example/",
    "http:/evil.example",
    "javascript:alert(1)",
    "evil.example",
    "\\\\evil.example",
  ]) {
    assert.equal(safeNextPath(bad), null, bad);
  }
});

test("rejects backslash ambiguities", () => {
  for (const bad of ["/\\evil.example", "/\\\\evil.example", "/foo\\..\\bar", "/%5Cevil.example", "/%5cevil.example"]) {
    assert.equal(safeNextPath(bad), null, bad);
  }
});

test("rejects raw whitespace and control characters", () => {
  for (const bad of [
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r/evil.example",
    "/\u0000evil",
    "/\u001fevil",
    "/\u007fevil",
    " /staff/dashboards",
    "/staff/dash boards",
    "/staff dashboards",
  ]) {
    assert.equal(safeNextPath(bad), null, JSON.stringify(bad));
  }
});

test("rejects percent-encoded protocol-relative and whitespace bypasses", () => {
  for (const bad of [
    "/%2F%2Fevil.example",
    "/%2f%2fevil.example",
    "%2F%2Fevil.example",
    "/%09/evil.example",
    "/%0a/evil.example",
    "/%0d/evil.example",
    "/%20/evil.example",
    "/%00evil",
    "/%2F%5Cevil.example",
  ]) {
    assert.equal(safeNextPath(bad), null, bad);
  }
});

test("rejects malformed encodings and oversized values", () => {
  assert.equal(safeNextPath("/%E0%A4%A"), null);
  assert.equal(safeNextPath("/" + "a".repeat(2048)), null);
});

test("rejects empty and non-string input", () => {
  for (const bad of ["", null, undefined, 42, ["/staff"]]) {
    assert.equal(safeNextPath(bad), null, String(bad));
  }
});

test("static login routes every next value through the validator", () => {
  const html = readFileSync(
    fileURLToPath(new URL("../foundation/auth/login.html", import.meta.url)),
    "utf8"
  );
  assert.match(html, /import \{ safeNextPath \} from "\.\/safe-next\.js";/);
  assert.match(html, /return safeNextPath\(raw\) \|\| appPath\("staff\/admin-dashboard\.html"\);/);
  assert.doesNotMatch(html, /raw\.startsWith\("\/\/"\)/);
});

test("blocks the two reported open-redirect inputs", () => {
  assert.equal(safeNextPath("/\\evil.example"), null);
  assert.equal(safeNextPath("/%09/evil.example"), null);
});
