/**
 * report-generator — Edge Function
 * Generates weekly / monthly / custom / pastor_digest reports with email delivery
 * and archive persistence.
 *
 * POST body:
 * {
 *   report_type: 'weekly' | 'monthly' | 'custom' | 'pastor_digest',
 *   scope: 'regional' | 'group' | 'subgroup',
 *   scope_value: string | null,
 *   date_from: string,   // ISO date — auto-calculated for weekly/monthly
 *   date_to: string,
 *   batch_id: string | null,
 *   recipients: string[],  // [] = auto-resolve by role
 *   send_email: boolean,
 *   save_archive: boolean,
 *   // pastor_digest extras:
 *   send_to_all_pastors?: boolean,  // superadmin trigger for individual per-pastor reports
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyAllowedOrigin, corsHeaders, jsonResponse, safeLogAudit } from "../_shared/http.ts";
import { validateCronAuth } from "../_shared/auth.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SUPABASE_ANON_KEY    = Deno.env.get("SUPABASE_ANON_KEY") || "";

function getBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

async function requireAdminAccess(req: Request, serviceDb: ReturnType<typeof createClient>) {
  const token = getBearerToken(req);
  if (!token) {
    return { ok: false as const, status: 401, error: "Missing bearer token" };
  }

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const userRes = await authClient.auth.getUser();
  if (userRes.error || !userRes.data?.user) {
    return { ok: false as const, status: 401, error: "Invalid session" };
  }

  const user = userRes.data.user;
  const { data: profile, error: profileErr } = await serviceDb
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileErr || !profile) {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }

  const role = String(profile.role || "").toLowerCase();
  if (role !== "admin" && role !== "superadmin" && role !== "regional_secretary") {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }

  return { ok: true as const, user };
}

function authJson(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function authorizeRequest(req: Request, serviceDb: any) {
  if (req.headers.has("x-cron-secret")) {
    const cronFailure = validateCronAuth(req);
    if (cronFailure) return { ok: false as const, response: cronFailure, mode: "cron" as const };
    return { ok: true as const, mode: "cron" as const };
  }

  if (req.headers.has("x-internal-secret")) {
    return {
      ok: false as const,
      response: authJson({ ok: false, error: "Unsupported caller credential" }, 401),
      mode: "user" as const,
    };
  }

  const userAuth = await requireAdminAccess(req, serviceDb);
  if (!userAuth.ok) {
    return {
      ok: false as const,
      response: authJson({ ok: false, error: userAuth.error }, userAuth.status),
      mode: "user" as const,
    };
  }
  return { ok: true as const, mode: "user" as const, user: userAuth.user };
}

function normalizeCronReportBody(body: Record<string, unknown>): Response | null {
  const reportType = String(body.report_type || "weekly");
  const allowed = ["weekly", "monthly", "weekly_regional", "monthly_regional", "pastor_digest"];
  if (!allowed.includes(reportType)) {
    return authJson({ ok: false, error: "Cron report type not allowed" }, 403);
  }
  if (Array.isArray(body.recipients) && body.recipients.length > 0) {
    return authJson({ ok: false, error: "Cron recipients override not allowed" }, 403);
  }
  if (reportType === "weekly_regional") {
    body.report_type = "weekly";
    body.scope = "regional";
  } else if (reportType === "monthly_regional") {
    body.report_type = "monthly";
    body.scope = "regional";
  }
  return null;
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function lastMonday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const dow = d.getUTCDay(); // 0=Sun
  d.setUTCDate(d.getUTCDate() - ((dow === 0 ? 7 : dow) + 6));
  return d;
}

function lastSunday(): Date {
  const d = lastMonday();
  d.setUTCDate(d.getUTCDate() + 6);
  return d;
}

function firstOfLastMonth(): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function lastDayOfLastMonth(): Date {
  const d = new Date();
  d.setUTCDate(0);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }

function fmtDate(s: string) {
  try { return new Date(s).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" }); }
  catch { return s; }
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

function esc(v: unknown) {
  return String(v ?? "").replace(/[&<>'"]/g, (c: string) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c] ?? c));
}

const LOGO_URL = "https://rocksolidsuite.netlify.app/foundation/registration/canada_sr.png";

function buildPrintStyle() {
  return `<style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; color: #1a1a2e; background: #fff; font-size: 14px; }
    .report-wrap { max-width: 900px; margin: 0 auto; padding: 24px; }
    .report-header { display: flex; align-items: center; gap: 20px; padding: 20px 24px; background: #C8102E; border-radius: 12px; margin-bottom: 24px; }
    .report-header img { height: 56px; }
    .report-header h1 { margin: 0; color: #fff; font-size: 22px; font-weight: 800; }
    .report-header p { margin: 4px 0 0; color: rgba(255,255,255,.82); font-size: 13px; }
    .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
    .kpi { background: #f9f9fb; border: 1px solid #e8e8f0; border-radius: 10px; padding: 14px 16px; }
    .kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; font-weight: 600; }
    .kpi-value { font-size: 26px; font-weight: 800; color: #1a1a2e; margin-top: 4px; }
    .section { margin-bottom: 28px; }
    .section h2 { margin: 0 0 10px; font-size: 16px; color: #1a1a2e; border-bottom: 2px solid #e8e8f0; padding-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #f3f4f6; text-align: left; padding: 8px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
    td { padding: 8px 10px; border-bottom: 1px solid #f0f0f4; }
    .warn-box { background: #fffbeb; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #78350f; }
    .greeting { background: #f0fdf4; border-left: 4px solid #16a34a; border-radius: 8px; padding: 14px 18px; margin-bottom: 20px; font-size: 14px; color: #14532d; }
    .report-footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e8e8f0; color: #9ca3af; font-size: 12px; text-align: center; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .report-wrap { padding: 0; max-width: 100%; }
      .report-header { border-radius: 0; margin-bottom: 16px; }
      .section { page-break-before: auto; }
      .section:nth-child(n+3) { page-break-before: always; }
      @page { size: A4; margin: 18mm 14mm; }
    }
  </style>`;
}

// ── Data queries ─────────────────────────────────────────────────────────────

async function fetchActiveBatch(supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase
    .from("batches")
    .select("batch_id,batch_name")
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  return data;
}

async function resolveSubgroupsForScope(
  supabase: ReturnType<typeof createClient>,
  scope: string,
  scope_value: string | null,
): Promise<string[] | null> {
  if (scope === "regional" || !scope_value) return null;
  const col = scope === "group" ? "group_id" : "subgroup_id";
  const { data } = await supabase
    .from("fellowship_map")
    .select("fellowship_code")
    .eq(col, scope_value)
    .eq("active", true);
  return (data || []).map((r: { fellowship_code: string }) => r.fellowship_code).filter(Boolean);
}

async function fetchNewRegistrations(
  supabase: ReturnType<typeof createClient>,
  dateFrom: string,
  dateTo: string,
  fellowshipCodes: string[] | null,
) {
  let q = supabase
    .from("applicants")
    .select("id,full_name,fellowship_code,registration_status")
    .gte("created_at", dateFrom)
    .lte("created_at", dateTo + "T23:59:59Z");
  if (fellowshipCodes?.length) q = q.in("fellowship_code", fellowshipCodes);
  const { data } = await q.limit(5000);
  return data || [];
}

async function fetchMilestonesInRange(
  supabase: ReturnType<typeof createClient>,
  dateFrom: string,
  dateTo: string,
  fellowshipCodes: string[] | null,
) {
  let q = supabase
    .from("student_milestone_status")
    .select("milestone_code,applicant_id,completed,applicants!inner(fellowship_code)")
    .eq("completed", true)
    .gte("updated_at", dateFrom)
    .lte("updated_at", dateTo + "T23:59:59Z");
  if (fellowshipCodes?.length) {
    q = q.in("applicants.fellowship_code", fellowshipCodes);
  }
  const { data } = await q.limit(5000);
  return data || [];
}

async function fetchSessionsInRange(
  supabase: ReturnType<typeof createClient>,
  dateFrom: string,
  dateTo: string,
  fellowshipCodes: string[] | null,
) {
  let q = supabase
    .from("session_outcomes")
    .select("class_option_id,class_session,submitted,class_date,class_options!inner(fellowship_codes)")
    .gte("class_date", dateFrom)
    .lte("class_date", dateTo);
  if (fellowshipCodes?.length) {
    q = q.overlaps("class_options.fellowship_codes", fellowshipCodes);
  }
  const { data } = await q.limit(5000);
  return data || [];
}

async function fetchFailedSyncs(
  supabase: ReturnType<typeof createClient>,
  batchId: string | null,
) {
  let q = supabase
    .from("moodle_enrollment_sync")
    .select("email,sync_status")
    .in("sync_status", ["FAILED", "RETRYING"]);
  if (batchId) q = q.eq("batch_id", batchId);
  const { data } = await q.limit(200);
  return data || [];
}

async function callRpc(
  supabase: ReturnType<typeof createClient>,
  rpcName: string,
  params: Record<string, unknown>,
) {
  const { data, error } = await (supabase.rpc as (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)(rpcName, params);
  if (error) return [];
  return Array.isArray(data) ? data : [];
}

// ── HTML builders ─────────────────────────────────────────────────────────────

type KvRow = { label: string; value: string | number };

function kpiRow(items: KvRow[]) {
  return `<div class="kpi-row">${items.map((i) => `
    <div class="kpi"><div class="kpi-label">${esc(i.label)}</div><div class="kpi-value">${esc(i.value)}</div></div>
  `).join("")}</div>`;
}

function tableSection(title: string, headers: string[], rows: string[][]) {
  const ths = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const trs = rows.map((r) =>
    `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`,
  ).join("") || `<tr><td colspan="${headers.length}" style="color:#9ca3af;">No data.</td></tr>`;
  return `<div class="section">
    <h2>${esc(title)}</h2>
    <table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>
  </div>`;
}

// ── Helpers for resolving auto-recipients ────────────────────────────────────

async function resolveAdminRecipients(supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase
    .from("profiles")
    .select("email")
    .in("role", ["superadmin", "admin"])
    .eq("is_active", true);
  return (data || []).map((r: { email: string }) => r.email).filter(Boolean) as string[];
}

async function resolvePastorRecipients(supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase
    .from("profiles")
    .select("user_id,email,full_name,role")
    .eq("role", "pastor")
    .eq("is_active", true);
  return (data || []) as Array<{ user_id: string; email: string; full_name: string; role: string }>;
}

async function resolveGroupForPastor(
  supabase: ReturnType<typeof createClient>,
  email: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("teachers")
    .select("group_id")
    .eq("email", email)
    .limit(1)
    .maybeSingle();
  return data?.group_id || null;
}

// ── Regional/group/subgroup report builder ────────────────────────────────────

async function buildReport(
  supabase: ReturnType<typeof createClient>,
  params: {
    report_type: string;
    scope: string;
    scope_value: string | null;
    date_from: string;
    date_to: string;
    batch_id: string | null;
    batch_name: string;
  },
): Promise<string> {
  const {
    report_type, scope, scope_value, date_from, date_to, batch_id, batch_name,
  } = params;

  const fellowshipCodes = await resolveSubgroupsForScope(supabase, scope, scope_value);
  const scopeLabel = scope === "regional"
    ? "Regional (All)"
    : `${scope === "group" ? "Group" : "Subgroup"}: ${scope_value || "All"}`;

  const subgroupFilter = fellowshipCodes?.length ? fellowshipCodes : null;

  const [newRegs, milestones, sessions, failedSyncs] = await Promise.all([
    fetchNewRegistrations(supabase, date_from, date_to, subgroupFilter),
    fetchMilestonesInRange(supabase, date_from, date_to, subgroupFilter),
    fetchSessionsInRange(supabase, date_from, date_to, subgroupFilter),
    fetchFailedSyncs(supabase, batch_id),
  ]);

  const regSummary = await callRpc(supabase, "get_registration_summary", {
    p_batch_id: batch_id,
    p_subgroups: fellowshipCodes,
  });
  const fellowshipBreakdown = await callRpc(supabase, "get_fellowship_breakdown", {
    p_batch_id: batch_id,
    p_subgroups: fellowshipCodes,
  });
  const capacitySummary = await callRpc(supabase, "get_capacity_summary", {
    p_batch_id: batch_id,
    p_subgroups: fellowshipCodes,
  });

  const totalEnrolled = regSummary.reduce(
    (s: number, r: { count?: number }) => s + (Number(r.count) || 0), 0,
  );
  const sessionsHeld = new Set(sessions.map((s: { class_option_id: string; class_session: string }) => `${s.class_option_id}:${s.class_session}`)).size;

  const bornAgain   = milestones.filter((m: { milestone_code: string }) => m.milestone_code === "BORN_AGAIN").length;
  const waterBaptized = milestones.filter((m: { milestone_code: string }) => m.milestone_code === "WATER_BAPTIZED").length;
  const holySpiritM = milestones.filter((m: { milestone_code: string }) => m.milestone_code === "HOLY_SPIRIT").length;

  const titleMap: Record<string, string> = {
    weekly: "Weekly Report",
    monthly: "Monthly Report",
    custom: "Custom Report",
    pastor_digest: "Pastor Digest",
  };
  const titleLabel = titleMap[report_type] || "Report";

  const regRows = (regSummary as Array<{ status: string; count: number }>).map((r) => {
    const pct = totalEnrolled > 0 ? `${((r.count / totalEnrolled) * 100).toFixed(1)}%` : "-";
    return [r.status, String(r.count), pct];
  });

  const fellowRows = (fellowshipBreakdown as Array<{ fellowship_code: string; campus_name: string; count: number }>).map((r) => [
    r.fellowship_code, r.campus_name || "-", String(r.count),
  ]);

  const capRows = (capacitySummary as Array<{
    class_option_id: string; teacher_name: string; day: string; class_time: string;
    current_enrolment: number; max_capacity: number;
  }>).map((r) => {
    const fill = r.max_capacity > 0
      ? `${((r.current_enrolment / r.max_capacity) * 100).toFixed(0)}%`
      : "-";
    return [r.class_option_id, r.teacher_name || "-", `${r.day || ""} ${r.class_time || ""}`.trim(), String(r.current_enrolment), String(r.max_capacity || "-"), fill];
  });

  const failedHtml = failedSyncs.length
    ? `<div class="section"><h2>Failed Moodle Syncs</h2><div class="warn-box">⚠ ${failedSyncs.length} enrollment(s) failed or are retrying.<br><small>${failedSyncs.slice(0, 5).map((f: { email: string }) => esc(f.email)).join(", ")}${failedSyncs.length > 5 ? ` and ${failedSyncs.length - 5} more` : ""}</small></div></div>`
    : "";

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${esc(titleLabel)}</title>${buildPrintStyle()}</head>
<body><div class="report-wrap">
  <div class="report-header">
    <img src="${LOGO_URL}" alt="Rock Solid Foundation School" />
    <div>
      <h1>Rock Solid Foundation School — ${esc(titleLabel)}</h1>
      <p>${esc(fmtDate(date_from))} to ${esc(fmtDate(date_to))} &nbsp;·&nbsp; Batch: ${esc(batch_name)} &nbsp;·&nbsp; ${esc(scopeLabel)}</p>
    </div>
  </div>
  ${kpiRow([
    { label: "New Registrations", value: newRegs.length },
    { label: "Total Enrolled", value: totalEnrolled },
    { label: "Milestones Completed", value: milestones.length },
    { label: "Sessions Held", value: sessionsHeld },
  ])}
  ${tableSection("Registration Breakdown", ["Status", "Count", "%"], regRows)}
  ${tableSection("Fellowship Breakdown", ["Fellowship", "Campus", "Count"], fellowRows)}
  ${tableSection("Class Capacity", ["Class", "Teacher", "Day / Time", "Enrolled", "Max", "Fill %"], capRows)}
  <div class="section">
    <h2>Milestones This Period</h2>
    <table><thead><tr><th>Milestone</th><th>Count</th></tr></thead>
    <tbody>
      <tr><td>Born Again</td><td>${bornAgain}</td></tr>
      <tr><td>Water Baptized</td><td>${waterBaptized}</td></tr>
      <tr><td>Holy Spirit (Moodle)</td><td>${holySpiritM}</td></tr>
    </tbody></table>
  </div>
  ${failedHtml}
  <div class="report-footer">
    Generated ${new Date().toLocaleString("en-CA")} &nbsp;·&nbsp; Rock Solid Foundation School &nbsp;·&nbsp; BLW Canada
  </div>
</div></body></html>`;
}

// ── Pastor digest builder ────────────────────────────────────────────────────

async function buildPastorDigest(
  supabase: ReturnType<typeof createClient>,
  params: {
    date_from: string;
    date_to: string;
    batch_id: string | null;
    batch_name: string;
    group_id: string;
    pastor_name: string;
  },
): Promise<string> {
  const { date_from, date_to, batch_id, batch_name, group_id, pastor_name } = params;
  const firstName = pastor_name.split(/\s+/)[0];

  const fellowshipCodes = await resolveSubgroupsForScope(supabase, "group", group_id);

  const [newRegs, milestones, sessions] = await Promise.all([
    fetchNewRegistrations(supabase, date_from, date_to, fellowshipCodes),
    fetchMilestonesInRange(supabase, date_from, date_to, fellowshipCodes),
    fetchSessionsInRange(supabase, date_from, date_to, fellowshipCodes),
  ]);

  const fellowshipBreakdown = await callRpc(supabase, "get_fellowship_breakdown", {
    p_batch_id: batch_id,
    p_subgroups: fellowshipCodes,
  });

  const totalEnrolled = newRegs.length;
  const sessionsHeld = new Set(sessions.map((s: { class_option_id: string; class_session: string }) => `${s.class_option_id}:${s.class_session}`)).size;
  const bornAgain    = milestones.filter((m: { milestone_code: string }) => m.milestone_code === "BORN_AGAIN").length;
  const waterBaptized = milestones.filter((m: { milestone_code: string }) => m.milestone_code === "WATER_BAPTIZED").length;
  const holySpirit   = milestones.filter((m: { milestone_code: string }) => m.milestone_code === "HOLY_SPIRIT").length;

  const fellowRows = (fellowshipBreakdown as Array<{ fellowship_code: string; campus_name: string; count: number }>).map((r) => [
    r.fellowship_code, r.campus_name || "-", String(r.count),
  ]);

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Pastor Digest — ${esc(pastor_name)}</title>${buildPrintStyle()}</head>
<body><div class="report-wrap">
  <div class="report-header">
    <img src="${LOGO_URL}" alt="Rock Solid Foundation School" />
    <div>
      <h1>Your Foundation School Weekly — ${esc(pastor_name)}</h1>
      <p>${esc(fmtDate(date_from))} to ${esc(fmtDate(date_to))} &nbsp;·&nbsp; Batch: ${esc(batch_name)} &nbsp;·&nbsp; Group: ${esc(group_id)}</p>
    </div>
  </div>
  <div class="greeting">Hi ${esc(firstName)}, here is your group update for ${esc(fmtDate(date_from))} – ${esc(fmtDate(date_to))}.</div>
  ${kpiRow([
    { label: "New Registrations", value: newRegs.length },
    { label: "Total Enrolled", value: totalEnrolled },
    { label: "Milestones", value: milestones.length },
    { label: "Sessions Held", value: sessionsHeld },
  ])}
  ${tableSection("Your Fellowships", ["Fellowship", "Campus", "Enrolled"], fellowRows)}
  <div class="section">
    <h2>Milestones in Your Group</h2>
    <table><thead><tr><th>Milestone</th><th>Count</th></tr></thead>
    <tbody>
      <tr><td>Born Again</td><td>${bornAgain}</td></tr>
      <tr><td>Water Baptized</td><td>${waterBaptized}</td></tr>
      <tr><td>Holy Spirit (Course Completed)</td><td>${holySpirit}</td></tr>
    </tbody></table>
  </div>
  <div class="report-footer">
    Generated ${new Date().toLocaleString("en-CA")} &nbsp;·&nbsp; Rock Solid Foundation School &nbsp;·&nbsp; BLW Canada
  </div>
</div></body></html>`;
}

// ── Queue email helper ────────────────────────────────────────────────────────

async function queueEmail(
  supabase: ReturnType<typeof createClient>,
  recipientEmail: string,
  subject: string,
  bodyHtml: string,
  payload: Record<string, unknown>,
) {
  const traceId = String(payload?.trace_id || "").trim() || crypto.randomUUID();
  await supabase.from("email_queue").insert({
    recipient_email: recipientEmail,
    template_key:    "report",
    subject,
    body_html:       bodyHtml,
    status:          "Pending",
    trace_id:        traceId,
    payload:         { ...payload, trace_id: traceId },
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  applyAllowedOrigin(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST")    return jsonResponse({ ok: false, error: "POST required" }, 405);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const auth = await authorizeRequest(req, supabase);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return jsonResponse({ ok: false, error: "Invalid JSON" }, 400); }
  if (auth.mode === "cron") {
    const cronScopeFailure = normalizeCronReportBody(body);
    if (cronScopeFailure) return cronScopeFailure;
  }

  const report_type     = String(body.report_type  || "weekly");
  const scope           = String(body.scope        || "regional");
  const scope_value     = body.scope_value ? String(body.scope_value) : null;
  const send_email      = body.send_email !== false;
  const save_archive    = body.save_archive !== false;
  const sendToAllPastors = body.send_to_all_pastors === true;
  const requestorEmail  = body.requestor_email ? String(body.requestor_email) : null;
  const flowTraceId     = String(body.trace_id || "").trim() || crypto.randomUUID();

  // Resolve date range
  let date_from = body.date_from ? String(body.date_from) : "";
  let date_to   = body.date_to   ? String(body.date_to)   : "";
  if (report_type === "weekly") {
    date_from = isoDate(lastMonday());
    date_to   = isoDate(lastSunday());
  } else if (report_type === "monthly") {
    date_from = isoDate(firstOfLastMonth());
    date_to   = isoDate(lastDayOfLastMonth());
  }
  if (!date_from || !date_to) {
    return jsonResponse({ ok: false, error: "date_from and date_to are required for custom reports" }, 400);
  }

  // Resolve batch
  let batch_id   = body.batch_id   ? String(body.batch_id) : null;
  let batch_name = "N/A";
  if (!batch_id) {
    const active = await fetchActiveBatch(supabase);
    if (active) { batch_id = active.batch_id; batch_name = active.batch_name; }
  } else {
    const { data: bRow } = await supabase.from("batches").select("batch_name").eq("batch_id", batch_id).maybeSingle();
    if (bRow) batch_name = bRow.batch_name;
  }

  // ── PASTOR DIGEST ──────────────────────────────────────────────────────────
  if (report_type === "pastor_digest") {
    const pastors = sendToAllPastors || !(body.recipients as string[] | undefined)?.length
      ? await resolvePastorRecipients(supabase)
      : [];

    if (pastors.length === 0 && !scope_value) {
      return jsonResponse({ ok: false, error: "No pastors found and no scope_value provided" }, 400);
    }

    let archived_id: string | null = null;
    let emails_queued = 0;

    if (pastors.length > 0) {
      for (const pastor of pastors) {
        const group_id = await resolveGroupForPastor(supabase, pastor.email);
        if (!group_id) continue;
        const html = await buildPastorDigest(supabase, {
          date_from, date_to, batch_id, batch_name,
          group_id, pastor_name: pastor.full_name || pastor.email,
        });
        const subject = `Foundation School Weekly — ${pastor.full_name || pastor.email} — ${fmtDate(date_from)} to ${fmtDate(date_to)}`;
        if (send_email) {
          await queueEmail(supabase, pastor.email, subject, html, { report_type, date_from, date_to, scope: "group", scope_value: group_id, trace_id: flowTraceId });
          emails_queued++;
        }
        if (save_archive) {
          const { data: arc } = await supabase.from("report_archive").insert({
            report_type, scope: "group", scope_value: group_id,
            date_from, date_to, batch_id,
            generated_by: requestorEmail, recipient_count: 1, body_html: html,
          }).select("id").single();
          if (!archived_id && arc) archived_id = arc.id;
        }
      }
    } else {
      // Single pastor generating their own digest
      const resolvedGroup = scope_value || (requestorEmail ? await resolveGroupForPastor(supabase, requestorEmail) : null);
      if (!resolvedGroup) return jsonResponse({ ok: false, error: "Could not resolve group for pastor" }, 400);
      const recipients = Array.isArray(body.recipients) ? (body.recipients as string[]) : [];
      const html = await buildPastorDigest(supabase, {
        date_from, date_to, batch_id, batch_name,
        group_id: resolvedGroup, pastor_name: requestorEmail || "Pastor",
      });
      const subject = `Foundation School Weekly — ${fmtDate(date_from)} to ${fmtDate(date_to)}`;
      if (send_email && recipients.length) {
        for (const r of recipients) {
          await queueEmail(supabase, r, subject, html, { report_type, date_from, date_to, scope: "group", scope_value: resolvedGroup, trace_id: flowTraceId });
          emails_queued++;
        }
      }
      if (save_archive) {
        const { data: arc } = await supabase.from("report_archive").insert({
          report_type, scope: "group", scope_value: resolvedGroup,
          date_from, date_to, batch_id,
          generated_by: requestorEmail, recipient_count: recipients.length, body_html: html,
        }).select("id").single();
        archived_id = arc?.id ?? null;
        await safeLogAudit(supabase, { action: "REPORT_GENERATED", entity_type: "system", status: "SUCCESS", details: { report_type, scope: "group", date_from, date_to, recipient_count: recipients.length, trace_id: flowTraceId } });
      }
      return jsonResponse({ ok: true, report_html: html, archived_id, emails_queued });
    }

    await safeLogAudit(supabase, { action: "REPORT_GENERATED", entity_type: "system", status: "SUCCESS", details: { report_type, scope: "group", date_from, date_to, recipient_count: emails_queued, trace_id: flowTraceId } });
    return jsonResponse({ ok: true, archived_id, emails_queued });
  }

  // ── STANDARD REPORT ────────────────────────────────────────────────────────
  const html = await buildReport(supabase, {
    report_type, scope, scope_value, date_from, date_to, batch_id, batch_name,
  });

  let recipients = Array.isArray(body.recipients) ? (body.recipients as string[]) : [];
  if (!recipients.length && send_email) {
    recipients = await resolveAdminRecipients(supabase);
  }

  let emails_queued  = 0;
  let archived_id: string | null = null;

  const subject = `${report_type.charAt(0).toUpperCase() + report_type.slice(1)} Report — ${fmtDate(date_from)} to ${fmtDate(date_to)}`;

  if (send_email) {
    for (const r of recipients) {
      await queueEmail(supabase, r, subject, html, { report_type, date_from, date_to, scope, trace_id: flowTraceId });
      emails_queued++;
    }
  }

  if (save_archive) {
    const { data: arc } = await supabase.from("report_archive").insert({
      report_type, scope, scope_value,
      date_from, date_to, batch_id,
      generated_by: requestorEmail, recipient_count: recipients.length, body_html: html,
    }).select("id").single();
    archived_id = arc?.id ?? null;
  }

  await safeLogAudit(supabase, {
    action:      "REPORT_GENERATED",
    entity_type: "system",
    status:      "SUCCESS",
    details:     { report_type, scope, date_from, date_to, recipient_count: recipients.length, trace_id: flowTraceId },
  });

  return jsonResponse({ ok: true, report_html: html, archived_id, emails_queued });
});

