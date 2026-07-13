import { supabase, getCurrentProfile, isAdmin } from "../auth/auth-client.js";

const adminApi = window.FSAdminApi;
const adminUi = window.FSAdminUi;
const esc = (v) => (adminUi?.esc ? adminUi.esc(v) : String(v ?? ""));

function isMissingTable(error) {
  const msg = String(error?.message || "").toLowerCase();
  return error?.code === "42P01" || msg.includes("does not exist") || msg.includes("relation");
}

function pick(obj, keys, fallback = "-") { for (const k of keys) { const v = obj?.[k]; if (v !== null && v !== undefined && v !== "") return v; } return fallback; }
function fmtDateTime(v) { if (!v || v === "-") return "-"; const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString(); }
function typeBadge(type) { const t = String(type || "").toLowerCase(); if (t.includes("moodle")) return "Moodle"; if (t.includes("mailchimp")) return "Mailchimp"; if (t.includes("email") || t.includes("notification")) return "Email"; return "Sync"; }
function statusClass(status) { const s = String(status || "").toLowerCase(); if (s.includes("fail") || s.includes("error")) return "danger"; if (s.includes("pending") || s.includes("retry")) return "warning"; return "info"; }

function normalizeJob(source, row, fallbackType) {
  const status = String(pick(row, ["status", "sync_status"], "Unknown"));
  return {
    source,
    id: String(pick(row, ["id", "queue_id", "sync_id"], "")),
    type: fallbackType,
    recipient: String(pick(row, ["recipient_email", "email", "recipient_name", "student_id", "applicant_id"], "-")),
    status,
    error: String(pick(row, ["error_message", "last_error", "failure_reason"], "-")),
    failureReason: String(row?.failure_reason || ""),
    traceId: String(row?.trace_id || row?.payload?.trace_id || row?.metadata?.trace_id || row?.details?.trace_id || ""),
    created_at: pick(row, ["created_at", "occurred_at", "logged_at"], "-"),
    lastAttemptedAt: pick(row, ["updated_at", "last_retry_at", "sent_at"], "-"),
    retryCount: Number(pick(row, ["retry_count", "attempts", "sync_attempts"], 0)) || 0,
    raw: row,
  };
}

async function loadSource(table, query, map) {
  const { data, error } = await query(supabase.from(table));
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return (data || []).map(map);
}

async function ensureAccess() {
  const { data } = await supabase.auth.getSession();
  if (!data?.session) { window.location.href = "login.html"; return null; }
  const profile = await getCurrentProfile();
  if (!profile || !isAdmin(profile.role)) throw new Error("Access denied for this account.");
  window.FSAdminShell?.mount({ active: "health", title: "Foundation School Admin", profileName: profile.full_name || profile.email || "Admin", role: profile.role, breadcrumbs: [{ label: "Admin", href: "dashboards.html" }, "Retry Center"] });
  return profile;
}

(async function init() {
  if (!adminApi || !adminUi) throw new Error("Shared admin modules failed to load.");
  const profile = await ensureAccess();

  const mod = window.FSRetryTableModule?.initRetryTable({
    sources: [
      { id: "failed_syncs", label: "failed_syncs", load: () => loadSource("failed_syncs", (q) => q.select("*").order("created_at", { ascending: false }).limit(500), (r) => normalizeJob("failed_syncs", r, typeBadge(pick(r, ["sync_type", "source_table", "provider"], "sync")))) },
      { id: "email_queue", label: "email_queue", load: () => loadSource("email_queue", (q) => q.select("*").or("status.ilike.%fail%,status.ilike.%error%").order("updated_at", { ascending: false }).limit(500), (r) => normalizeJob("email_queue", r, "Email")) },
      { id: "scheduled_notifications", label: "scheduled_notifications", load: () => loadSource("scheduled_notifications", (q) => q.select("*").or("status.ilike.%fail%,status.ilike.%error%").order("updated_at", { ascending: false }).limit(500), (r) => normalizeJob("scheduled_notifications", r, "Email")) },
      { id: "moodle_enrollment_sync", label: "moodle_enrollment_sync", load: () => loadSource("moodle_enrollment_sync", (q) => q.select("*").or("sync_status.ilike.%fail%,sync_status.ilike.%error%,sync_status.ilike.%retry%,status.ilike.%retry%,last_error.not.is.null").order("updated_at", { ascending: false }).limit(500), (r) => normalizeJob("moodle_enrollment_sync", r, "Moodle")) },
    ],
    columns: [
      { key: "type", label: "Type", render: (v) => `<span class="fs-badge fs-badge-info">${esc(v)}</span>` },
      { key: "recipient", label: "Recipient / Student", render: (v) => esc(v) },
      { key: "traceId", label: "Trace ID", render: (v) => (v ? `<code>${esc(v.slice(0, 8))}...${esc(v.slice(-6))}</code>` : "<span class=\"muted\">-</span>") },
      { key: "status", label: "Status", render: (v) => `<span class="fs-badge fs-badge-${statusClass(v)}">${esc(v)}</span>` },
      { key: "failureReason", label: "Cause", render: (v) => (v ? `<span class="fs-badge fs-badge-info">${esc(v.replace(/^MOODLE_/, ""))}</span>` : "") },
      { key: "error", label: "Error", render: (v) => `<span class="muted-cell" title="${esc(v)}">${esc(v)}</span>` },
      { key: "created_at", label: "Created", render: (v) => esc(fmtDateTime(v)) },
      { key: "lastAttemptedAt", label: "Last Attempted", render: (v) => esc(fmtDateTime(v)) },
      { key: "retryCount", label: "Retry Count", render: (v) => esc(String(v)) },
    ],
    actions: {
      retry: async (row) => { await adminApi.invokeRetryWorker(supabase, { action: "retry", source: row.source, id: String(row.id) }); },
      resolve: async (row) => { await adminApi.invokeRetryWorker(supabase, { action: "resolve", source: row.source, id: String(row.id) }); },
      bulk: async (action, rows) => { for (const row of rows) await adminApi.invokeRetryWorker(supabase, { action, source: row.source, id: String(row.id) }); },
    },
    filters: { status: true, type: true, date: true, search: true },
    statusClass,
    typeBadge,
    ids: {
      rows: "rows", refreshBtn: "refreshBtn", retrySelectedBtn: "retrySelectedBtn", resolveSelectedBtn: "resolveSelectedBtn",
      typeFilter: "filterType", statusFilter: "filterStatus", dateFilter: "filterFrom", searchInput: "searchInput",
    },
    renderSummary: (s) => {
      document.getElementById("kTotal").textContent = String(s.rows.length);
      document.getElementById("kEmails").textContent = String(s.rows.filter((j) => j.source === "email_queue" || j.source === "scheduled_notifications").length);
      document.getElementById("kMoodle").textContent = String(s.rows.filter((j) => String(j.type).toLowerCase() === "moodle").length);
      document.getElementById("summaryLine").textContent = `${s.filtered.length} visible of ${s.rows.length} total failed jobs`;
    },
    renderDetails: (job) => {
      const overlay = document.getElementById("detailOverlay");
      if (!job || !overlay) return;
      document.getElementById("detailTitle").textContent = `${job.type} - ${job.source}`;
      document.getElementById("detailBody").textContent = JSON.stringify(job.raw, null, 2);
      document.getElementById("detailError").textContent = job.error || "-";
      overlay.classList.add("open");
    },
    onError: (msg) => {
      const box = document.getElementById("errorBox");
      box.textContent = `Failed to load failed jobs: ${adminApi.normalizeError(msg)}`;
      box.classList.remove("hidden");
    },
  });

  document.getElementById("retryVisibleBtn")?.addEventListener("click", async () => {
    const { filtered } = mod.getState();
    await mod.getState();
    for (const row of filtered) await adminApi.invokeRetryWorker(supabase, { action: "retry", source: row.source, id: String(row.id) });
    await mod.refresh();
  });
  document.getElementById("detailCloseBtn")?.addEventListener("click", () => document.getElementById("detailOverlay").classList.remove("open"));
  document.getElementById("detailOverlay")?.addEventListener("click", (e) => { if (e.target === document.getElementById("detailOverlay")) document.getElementById("detailOverlay").classList.remove("open"); });

  await mod.refresh();
})();


