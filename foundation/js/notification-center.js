import { supabase, getCurrentProfile, requireAuth } from "../auth/auth-client.js";
import { logout } from "../auth/logout.js";

const AdminApi = window.FSAdminApi;
const AdminUi = window.FSAdminUi;

const esc = (v) => (AdminUi?.esc ? AdminUi.esc(v) : String(v ?? ""));
const fmtDate = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
};
const chip = (status) => {
  const s = String(status || "").toLowerCase();
  let cls = "fs-badge fs-badge-info";
  if (s.includes("fail") || s.includes("error")) cls = "fs-badge fs-badge-danger";
  else if (s.includes("pending") || s.includes("retry")) cls = "fs-badge fs-badge-warning";
  else if (s.includes("sent") || s.includes("resolved") || s.includes("success")) cls = "fs-badge fs-badge-success";
  return `<span class="${cls}">${esc(status || "—")}</span>`;
};

async function selectSafe(table, query) {
  try {
    const { data, error } = await query(supabase.from(table));
    if (error) throw error;
    return data || [];
  } catch (e) {
    const msg = String(e?.message || e || "").toLowerCase();
    if (msg.includes("does not exist") || msg.includes("relation") || e?.code === "42P01") return [];
    throw e;
  }
}

const normalizeEmailRows = (rows) => rows.map((r) => ({
  id: String(r.id), source: "email_queue", type: "email", status: String(r.status || "").toUpperCase() || "UNKNOWN",
  recipient: r.recipient_email || "", subject: r.subject || r.template_key || "", error: r.error_message || r.last_error || "",
  created_at: r.created_at || r.updated_at, raw: r,
}));
const normalizeScheduledRows = (rows) => rows.map((r) => ({
  id: String(r.id), source: "scheduled_notifications", type: String(r.event_type || "").toUpperCase().includes("MOODLE") ? "moodle" : "notification",
  status: String(r.status || "").toUpperCase() || "UNKNOWN", recipient: r.recipient_email || "", subject: r.template_key || r.event_type || "",
  error: r.error_message || r.last_error || "", created_at: r.created_at || r.updated_at || r.scheduled_for, raw: r,
}));
const normalizeFailedSyncRows = (rows) => rows.map((r) => ({
  id: String(r.id), source: "failed_syncs", type: String(r.sync_type || "").toLowerCase().includes("moodle") ? "moodle" : "sync",
  status: String(r.status || "FAILED").toUpperCase(), recipient: "", subject: r.source_table || r.sync_type || "", error: r.error_message || "",
  created_at: r.created_at || r.last_retry_at, raw: r,
}));
const normalizeMoodleRows = (rows) => rows.map((r) => ({
  id: String(r.id), source: "moodle_enrollment_sync", type: "moodle", status: String(r.sync_status || r.status || "PENDING").toUpperCase(),
  recipient: r.email || r.student_email || "", subject: `Applicant ${r.applicant_id || ""} / Student ${r.student_id || ""}`,
  error: r.error_message || r.last_error || "", created_at: r.updated_at || r.last_attempt_at || r.created_at || r.synced_at, raw: r,
}));

const invokeRetryWorker = async (action, source, id) => {
  // Email Resolve is on hold: the email queue has no Resolved status yet. Retry is still available.
  if (String(action || "").trim() === "resolve" && String(source || "").trim() === "email_queue") {
    throw new Error("Email Resolve is on hold: the email queue has no Resolved status yet. Retry is still available.");
  }
  const { data, error } = await supabase.functions.invoke("retry-worker", { body: { action, source, id } });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || "Retry worker failed");
  return data;
};

(async function boot() {
  const auth = await requireAuth(["admin", "superadmin"]);
  if (!auth) return;

  const profile = await getCurrentProfile();
  const role = String(profile?.role || "").toLowerCase();
  const isRegionalSecretary = role === "regional_secretary";
  const who = document.getElementById("whoami");
  if (who) who.textContent = `${profile?.email || ""} (${profile?.role || ""})`;

  if (window.FSAdminShell?.mount) {
    window.FSAdminShell.mount({
      active: "notifications",
      role: profile.role,
      profileName: profile.full_name || profile.email || "Admin",
      breadcrumbs: [{ label: "Admin", href: "dashboards.html" }, { label: "Notifications" }],
      onLogout: logout,
    });
  }
  document.getElementById("logoutBtn")?.addEventListener("click", logout);

  if (isRegionalSecretary) {
    document.getElementById("retrySelectedBtn")?.setAttribute("hidden", "hidden");
    document.getElementById("resolveSelectedBtn")?.setAttribute("hidden", "hidden");
  }

  const mod = window.FSRetryTableModule?.initRetryTable({
    readOnly: isRegionalSecretary,
    sources: [
      { id: "email_queue", label: "Email Queue", load: async () => normalizeEmailRows(await selectSafe("email_queue", (q) => q.select("id,recipient_email,template_key,subject,status,error_message,created_at,updated_at").order("created_at", { ascending: false }).limit(1000))) },
      { id: "scheduled_notifications", label: "Scheduled Notifications", load: async () => normalizeScheduledRows(await selectSafe("scheduled_notifications", (q) => q.select("id,recipient_email,event_type,template_key,status,error_message,last_error,created_at,updated_at,scheduled_for").order("created_at", { ascending: false }).limit(1000))) },
      { id: "failed_syncs", label: "Failed Syncs", load: async () => normalizeFailedSyncRows(await selectSafe("failed_syncs", (q) => q.select("id,sync_type,source_table,status,error_message,created_at,last_retry_at").order("created_at", { ascending: false }).limit(600))) },
      { id: "moodle_enrollment_sync", label: "Moodle Sync", load: async () => normalizeMoodleRows(await selectSafe("moodle_enrollment_sync", (q) => q.select("id,applicant_id,student_id,email,sync_status,error_message,last_error,error_code,last_attempt_at,updated_at,created_at,synced_at").order("updated_at", { ascending: false }).limit(600))) },
    ],
    columns: [
      { key: "source", label: "Source", render: (v) => esc(v) },
      { key: "type", label: "Type", render: (v) => esc(v) },
      { key: "recipient", label: "Recipient", render: (v) => esc(v || "—") },
      { key: "subject", label: "Subject/Key", render: (v) => esc(v || "—") },
      { key: "status", label: "Status", render: (v) => chip(v) },
      { key: "error", label: "Error", render: (v) => `<span class="muted-cell" title="${esc(v || "")}">${esc(v || "—")}</span>` },
      { key: "created_at", label: "Updated", render: (v) => esc(fmtDate(v)) },
    ],
    actions: {
      retry: async (row) => {
        if (isRegionalSecretary) throw new Error("Regional Secretary has read-only access on this page.");
        await invokeRetryWorker("retry", row.source, row.id);
      },
      resolve: async (row) => {
        if (isRegionalSecretary) throw new Error("Regional Secretary has read-only access on this page.");
        await invokeRetryWorker("resolve", row.source, row.id);
      },
      bulk: async (action, rows) => {
        if (isRegionalSecretary) throw new Error("Regional Secretary has read-only access on this page.");
        // Email rows are skipped for Resolve while that action is on hold.
        const runnable = action === "resolve" ? rows.filter((r) => r.source !== "email_queue") : rows;
        for (const row of runnable) await invokeRetryWorker(action, row.source, row.id);
      },
    },
    filters: { status: true, type: true, date: true, search: true },
    statusClass: () => "",
    typeBadge: () => "",
    pageSize: 25,
    ids: {
      rows: "rows", pageInfo: "pageInfo", rowCount: "rowCount", refreshBtn: "refreshBtn", retrySelectedBtn: "retrySelectedBtn", resolveSelectedBtn: "resolveSelectedBtn",
      statusFilter: "statusFilter", typeFilter: "typeFilter", dateFilter: "dateFilter", searchInput: "searchInput", prevBtn: "prevBtn", nextBtn: "nextBtn",
    },
    renderSummary: (s) => {
      const isFail = (x) => String(x || "").toLowerCase().includes("fail") || String(x || "").toLowerCase().includes("error");
      const isPending = (x) => String(x || "").toLowerCase().includes("pending") || String(x || "").toLowerCase().includes("retry");
      document.getElementById("sumPendingEmails").textContent = String(s.rows.filter((r) => r.type === "email" && isPending(r.status)).length);
      document.getElementById("sumFailedEmails").textContent = String(s.rows.filter((r) => r.type === "email" && isFail(r.status)).length);
      document.getElementById("sumPendingMoodle").textContent = String(s.rows.filter((r) => r.type === "moodle" && isPending(r.status)).length);
      document.getElementById("sumFailedMoodle").textContent = String(s.rows.filter((r) => r.type === "moodle" && isFail(r.status)).length);
    },
    renderDetails: (row) => {
      const box = document.getElementById("detailsBox");
      if (!box) return;
      if (!row) { box.classList.add("hidden"); box.innerHTML = ""; return; }
      box.classList.remove("hidden");
      box.innerHTML = `<div class="details-head"><h3>Error Details</h3><button class="btn btn-xs" id="closeDetails">Close</button></div><pre>${esc(JSON.stringify(row.raw, null, 2))}</pre>`;
      document.getElementById("closeDetails")?.addEventListener("click", () => { box.classList.add("hidden"); box.innerHTML = ""; });
    },
    onError: (msg) => {
      const el = document.getElementById("errorBox");
      if (!el) return;
      el.textContent = AdminApi?.normalizeError ? AdminApi.normalizeError(msg) : String(msg);
      el.classList.remove("hidden");
    },
  });

  await mod.refresh();
})();

