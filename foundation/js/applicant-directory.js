import { CONFIG as AUTH_CONFIG, supabase as AUTH_SUPABASE, requireAuth as AUTH_REQUIRE_AUTH } from "../auth/auth-client.js";

let CONFIG = {};
let supabase = null;
let requireAuth = null;

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
const fmt = (v) => v ? new Date(v).toLocaleString() : "-";
const ymd = (v) => {
  if (!v) return "";
  try { return new Date(v).toISOString().slice(0, 10); } catch (_) { return ""; }
};
const fallbackMilestoneDefs = [
  { code: "BORN_AGAIN", label: "Born Again" },
  { code: "FILLED_WITH_SPIRIT", label: "Filled with the Spirit" },
  { code: "PARTNERSHIP", label: "Partnership" },
  { code: "JOINED_CELL", label: "Joined Cell" },
  { code: "SERVING_TEAM_INTEREST", label: "Serving Team Interest" },
  { code: "NEEDS_FOLLOW_UP", label: "Needs Follow-up" },
  { code: "FOUNDATION_COMPLETED", label: "Foundation Completed" },
];

const state = {
  auth: null,
  mode: "directory",
  applicants: [], classOptions: [], batches: [], notifications: [], emails: [], audits: [], moodle: [], attendance: [],
  milestoneDefs: fallbackMilestoneDefs,
  milestoneStatusRows: [],
  milestonesByApplicant: new Map(),
  applicantSummaries: new Map(),
  duplicateGroups: [], duplicateNotifications: [],
  duplicatesByGroup: new Map(),
  quickTab: "all",
  filters: { search: "", fellowship: "", classOption: "", batch: "", assignment: "", notif: "", milestone: "", attendance: "", status: "", date: "" },
  advFilters: { dateFrom: "", dateTo: "", moodle: "", attStatus: "", active: false },
  selectedApplicantId: null, latestViewedApplicantId: null, selectedIds: new Set(),
  rowLimit: 50,
  showAllColumns: (() => { try { return localStorage.getItem("fs_dir_all_cols") === "1"; } catch (_) { return false; } })(),
};

const canDecisionActions = () => ["admin", "superadmin", "principal", "regional_secretary"].includes(String(state.auth?.profile?.role || "").toLowerCase());
const preferredClassTime = (app) => app?.preferred_class_time || app?.class_time || app?.class_label || app?.availability || app?.availability_status || "";

window.addEventListener("unhandledrejection", (event) => {
  console.error("[UnhandledRejection]", event.reason);
  const message = event.reason?.message || String(event.reason) || "An unexpected error occurred.";
  showFlash(`Error: ${message}`, "error");
  event.preventDefault();
});

function showFlash(msg, type = "success") { const klass = type === "error" ? "err" : type === "warn" ? "warn" : "success"; $("flashArea").innerHTML = `<div class="${klass}">${esc(msg)}</div>`; setTimeout(() => { if ($("flashArea")) $("flashArea").innerHTML = ""; }, 4200); }
const setTheme = () => { document.documentElement.setAttribute("data-theme", "light"); localStorage.setItem("fs_theme", "light"); };
const statusPill = (status) => { const normalized = String(status || "PENDING").toUpperCase(); const map = { SENT: "completed", PENDING: "attention", FAILED: "duplicate", RETRIED: "assigned" }; const pretty = normalized.charAt(0) + normalized.slice(1).toLowerCase(); return `<span class="pill ${map[normalized] || "unassigned"}">${esc(pretty)}</span>`; };
const displayGroupValue = (app) => (String(app?.fellowship_code || "").toUpperCase() === "REGIONAL" && !app?.group_id ? "Regional" : (app?.group_id || "-"));
const displaySubgroupValue = (app) => (String(app?.fellowship_code || "").toUpperCase() === "REGIONAL" && !app?.subgroup_id ? "Regional" : (app?.subgroup_id || "-"));
const normalizedMilestoneCode = (v) => String(v || "").trim().toUpperCase();
const milestoneKeys = () => state.milestoneDefs.map((m) => normalizedMilestoneCode(m.code)).filter(Boolean);
const milestoneLabels = () => {
  const out = {};
  state.milestoneDefs.forEach((m) => { out[normalizedMilestoneCode(m.code)] = m.label || m.code; });
  return out;
};
function buildMilestoneCache() {
  const byApplicant = new Map();
  if (state.applicantSummaries.size) {
    // Server-side aggregate mode: completed codes arrive as arrays per applicant.
    state.applicantSummaries.forEach((row, applicantId) => {
      const codes = (row.completed_milestones || []).map(normalizedMilestoneCode).filter(Boolean);
      if (codes.length) byApplicant.set(applicantId, new Set(codes));
    });
  } else {
    (state.milestoneStatusRows || []).forEach((row) => {
      const applicantId = String(row.applicant_id || "").trim();
      const code = normalizedMilestoneCode(row.milestone_code);
      if (!applicantId || !code || row.completed !== true) return;
      if (!byApplicant.has(applicantId)) byApplicant.set(applicantId, new Set());
      byApplicant.get(applicantId).add(code);
    });
  }
  state.milestonesByApplicant = byApplicant;
}
const getApplicantMilestones = (app) => [...(state.milestonesByApplicant.get(String(app.id || "")) || new Set())];
const classIdOf = (row) => String(row?.class_option_id || row?.id || "");
const getClassInfo = (id) => state.classOptions.find((c) => classIdOf(c) === String(id || "")) || null;

// Attendance rows are looked up per applicant on every render, so they are
// indexed by id and email once per data load instead of re-scanned linearly.
let attendanceIndex = { byId: new Map(), byEmail: new Map() };
function buildAttendanceCache() {
  const byId = new Map();
  const byEmail = new Map();
  (state.attendance || []).forEach((r, i) => {
    const rid = String(r.applicant_id || r.student_id || r.registration_id || "");
    const remail = String(r.email || r.student_email || "").toLowerCase();
    if (rid) { if (!byId.has(rid)) byId.set(rid, []); byId.get(rid).push([i, r]); }
    if (remail) { if (!byEmail.has(remail)) byEmail.set(remail, []); byEmail.get(remail).push([i, r]); }
  });
  attendanceIndex = { byId, byEmail };
}

function getAttendanceRows(app) {
  const byId = String(app.id || "");
  const byEmail = String(app.email || "").toLowerCase();
  const idRows = (byId && attendanceIndex.byId.get(byId)) || [];
  const emailRows = (byEmail && attendanceIndex.byEmail.get(byEmail)) || [];
  if (!idRows.length && !emailRows.length) return [];
  if (!emailRows.length) return idRows.map(([, r]) => r);
  if (!idRows.length) return emailRows.map(([, r]) => r);
  // Merge by original index so ordering matches the source array, dedup rows
  // that match on both id and email.
  const merged = new Map();
  idRows.forEach(([i, r]) => merged.set(i, r));
  emailRows.forEach(([i, r]) => merged.set(i, r));
  return [...merged.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
}

function getAttendanceSummary(app) {
  // Server-side aggregate (applicant_directory_summaries view) when available.
  const agg = state.applicantSummaries.get(String(app.id || ""));
  if (agg) {
    const total = Number(agg.total_sessions || 0);
    const attended = Number(agg.attended_sessions || 0);
    if (!total) return { pct: null, attended: 0, total: 0, last: agg.last_attendance_at || null, missing: 0 };
    return {
      pct: Math.round((attended / total) * 100),
      attended, total,
      last: agg.last_attendance_at || null,
      missing: Math.max(0, total - attended),
    };
  }
  const rows = getAttendanceRows(app);
  if (!rows.length) return { pct: null, attended: 0, total: 0, last: null, missing: 0 };
  const attended = rows.filter((r) => r.present === true || String(r.present).toLowerCase() === "yes" || String(r.status).toLowerCase() === "present").length;
  const total = rows.length;
  const pct = total ? Math.round((attended / total) * 100) : 0;
  const last = rows.map((r) => r.created_at || r.date || r.session_date || r.class_date || r.logged_at).filter(Boolean).sort().at(-1) || null;
  return { pct, attended, total, last, missing: Math.max(0, total - attended) };
}

function getAttendanceStatusCounts(app) {
  const out = { SUBMITTED: 0, LATE_START: 0, MISSING: 0 };
  // attendance_records has no session_status column, so in aggregate mode all
  // sessions count as SUBMITTED — identical to what the row scan produces.
  const agg = state.applicantSummaries.get(String(app.id || ""));
  if (agg) {
    out.SUBMITTED = Number(agg.total_sessions || 0);
    return out;
  }
  getAttendanceRows(app).forEach((r) => {
    const key = String(r.session_status || "SUBMITTED").toUpperCase();
    if (key === "LATE_START" || key === "MISSING" || key === "SUBMITTED") out[key] += 1;
    else out.SUBMITTED += 1;
  });
  return out;
}

const attendanceStatusBadge = (label, cls, count) => count ? `<span class="pill ${cls}">${esc(label)} (${count})</span>` : "";
function getNotificationRows(app) {
  const byId = String(app.id || "");
  const byEmail = String(app.email || "").toLowerCase();
  return state.notifications.filter((n) => {
    const nid = String(n.applicant_id || n.student_id || "");
    const nemail = String(n.recipient_email || n.email || "").toLowerCase();
    return (byId && nid && byId === nid) || (byEmail && nemail && byEmail === nemail);
  });
}

function getNotificationState(app) {
  const rows = getNotificationRows(app);
  if (!rows.length) return "PENDING";
  const order = ["FAILED", "RETRIED", "PENDING", "SENT"];
  const normalized = rows.map((r) => String(r.status || r.event_status || r.provider_status || "PENDING").toUpperCase());
  return order.find((stateName) => normalized.includes(stateName)) || normalized[0] || "PENDING";
}

// summarizeApplicant is called once per applicant by each of applyFilters,
// renderKpis, renderTable and renderMobileCards on every render pass, so the
// result is cached until the underlying data changes.
let summaryCache = new Map();
function invalidateSummaryCache() { summaryCache = new Map(); }

function summarizeApplicant(app) {
  const cacheKey = String(app.id || "");
  const cached = cacheKey && summaryCache.get(cacheKey);
  if (cached) return cached;
  const milestones = getApplicantMilestones(app);
  const attendance = getAttendanceSummary(app);
  const completed = milestones.length >= milestoneKeys().length && milestoneKeys().length > 0;
  const summary = {
    milestoneCount: milestones.length,
    attendancePct: attendance.pct,
    notificationState: getNotificationState(app),
    completed,
    needsFollowUp: Boolean(app.needs_follow_up || app.needs_admin_review),
    duplicate: Number(app.duplicate_count || 0) > 1,
    lastActivity: [app.updated_at, app.created_at, getNotificationRows(app)[0]?.created_at, attendance.last].filter(Boolean).sort().at(-1) || null,
  };
  if (cacheKey) summaryCache.set(cacheKey, summary);
  return summary;
}

function classifyRowStatus(app, summary) {
  if (summary.duplicate) return { label: "Duplicate", cls: "duplicate" };
  if (summary.needsFollowUp) return { label: "Needs Attention", cls: "attention" };
  if (summary.completed) return { label: "Completed", cls: "completed" };
  if (app.class_option_id) return { label: "Assigned", cls: "assigned" };
  return { label: "Unassigned", cls: "unassigned" };
}

function milestoneStatus(summary) {
  const total = milestoneKeys().length;
  const done = Number(summary?.milestoneCount || 0);
  if (done <= 0) return { label: "Not Started", cls: "unassigned", counter: `0/${total}` };
  if (done >= total) return { label: "Complete", cls: "completed", counter: `${total}/${total}` };
  return { label: "In Progress", cls: "assigned", counter: `${done}/${total}` };
}

function classCapacityInfo(classOptionId) {
  const cls = getClassInfo(classOptionId);
  const current = state.applicants.filter((a) => String(a.class_option_id || "") === String(classOptionId || "")).length;
  const max = Number(cls?.capacity || cls?.max_capacity || cls?.class_capacity || 0) || 0;
  return { current, max, full: max > 0 && current >= max };
}

function getDuplicateGroup(app) {
  const groupId = app.duplicate_group_id;
  if (!groupId) return null;
  return state.duplicatesByGroup.get(String(groupId)) || null;
}

function getGroupDuplicates(app) {
  const groupId = app.duplicate_group_id;
  if (!groupId) return [];
  return state.applicants.filter((a) => String(a.duplicate_group_id) === String(groupId));
}

function getDuplicateNotificationsForGroup(groupId) {
  if (!groupId) return [];
  return state.duplicateNotifications.filter((n) => String(n.duplicate_group_id) === String(groupId));
}

function buildDuplicateCache() {
  const byGroup = new Map();
  (state.duplicateGroups || []).forEach((group) => {
    byGroup.set(String(group.id), group);
  });
  state.duplicatesByGroup = byGroup;
}

function getDuplicateGroupStatus(group) {
  return String(group?.status || "").toLowerCase();
}

function buildDuplicateApplicantDetails(group) {
  if (!group) return [];
  if (Array.isArray(group.applicant_details) && group.applicant_details.length) return group.applicant_details;
  return state.applicants
    .filter((app) => String(app.duplicate_group_id || "") === String(group.id || ""))
    .map((app) => ({
      id: app.id,
      name: app.full_name || [app.first_name, app.last_name].filter(Boolean).join(" ") || app.email || "Unknown applicant",
      email: app.email || "",
      phone: app.phone || app.phone_number || "",
      fellowship: app.fellowship_code || app.fellowship || "",
      subgroup: app.subgroup_id || "",
      batch_id: app.batch_id || "",
      status: app.registration_status || app.status || "",
      created_at: app.created_at || null,
      is_primary: Boolean(app.is_primary_duplicate),
    }));
}

function getDuplicateGroupCount(app, group) {
  const groupCount = Number(group?.duplicate_count || 0);
  if (groupCount > 0) return groupCount;
  const applicantCount = getGroupDuplicates(app).length;
  return applicantCount || 0;
}

function hasUnresolvedDuplicate(app, group) {
  const duplicateStatus = String(app?.duplicate_status || "").toUpperCase();
  return duplicateStatus === "CONFIRMED" && getDuplicateGroupStatus(group) !== "resolved";
}

function getDuplicateBadgeMeta(app) {
  const duplicateStatus = String(app?.duplicate_status || "UNIQUE").toUpperCase();
  const group = getDuplicateGroup(app);
  const groupStatus = getDuplicateGroupStatus(group);
  const groupCount = getDuplicateGroupCount(app, group);
  const unresolved = hasUnresolvedDuplicate(app, group);
  const resolved = duplicateStatus === "RESOLVED" || groupStatus === "resolved";
  if (duplicateStatus === "UNIQUE" && !group) {
    return {
      pillClass: "unassigned",
      label: "—",
      meta: "",
      showWarning: false,
      groupId: "",
    };
  }
  return {
    pillClass: resolved ? "completed" : unresolved ? "duplicate" : "attention",
    label: resolved ? "Resolved" : duplicateStatus,
    meta: groupCount > 0 ? `${groupCount} in group` : "Duplicate group",
    showWarning: unresolved,
    groupId: group?.id ? String(group.id) : "",
    group,
  };
}

function openDuplicateResolution(groupId) {
  const group = state.duplicatesByGroup.get(String(groupId || ""));
  if (!group || !window.DuplicateUI?.openResolutionModal) return;
  window.DuplicateUI.openResolutionModal({
    ...group,
    applicant_details: buildDuplicateApplicantDetails(group),
  });
}

function renderDuplicateChip(rows) {
  const chip = $("duplicateCountChip");
  if (!chip) return;
  const count = rows.filter((app) => {
    const duplicateStatus = String(app.duplicate_status || "UNIQUE").toUpperCase();
    return duplicateStatus !== "UNIQUE" || Boolean(app.duplicate_group_id);
  }).length;
  chip.textContent = `Duplicates: ${count}`;
  chip.title = `${count} duplicate-tagged record${count === 1 ? "" : "s"} in the current result set`;
}

function renderDuplicateNotificationPanel(rows) {
  const list = $("duplicateNotificationList");
  const meta = $("duplicateNotificationMeta");
  if (!list || !meta) return;

  const visibleGroupIds = new Set(rows.map((app) => String(app.duplicate_group_id || "")).filter(Boolean));
  const unresolvedGroups = (state.duplicateGroups || [])
    .filter((group) => getDuplicateGroupStatus(group) !== "resolved")
    .filter((group) => visibleGroupIds.has(String(group.id)));

  const pendingNotificationsByGroup = new Map(
    (state.duplicateNotifications || [])
      .filter((notification) => String(notification.notification_status || "").toLowerCase() === "pending")
      .map((notification) => [String(notification.duplicate_group_id), notification])
  );

  const panelItems = unresolvedGroups
    .filter((group) => pendingNotificationsByGroup.has(String(group.id)))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  meta.textContent = panelItems.length
    ? `${panelItems.length} unresolved duplicate group${panelItems.length === 1 ? "" : "s"} in the current view`
    : "No unresolved duplicate notifications in the current view.";

  list.innerHTML = panelItems.map((group) => {
    const details = buildDuplicateApplicantDetails(group);
    const names = details.map((item) => item.name || item.email || "Unknown").filter(Boolean);
    const notification = pendingNotificationsByGroup.get(String(group.id));
    const createdAt = notification?.created_at || group.created_at || null;
    return `<article class="duplicate-panel-item"><div><h4>${esc(names.slice(0, 3).join(", ") || "Duplicate group")}</h4><div class="duplicate-panel-meta">Subgroup: ${esc(group.subgroup_id || notification?.subgroup_id || "—")}<br>Affected students: ${esc(names.join(", ") || "—")}<br>Created: ${esc(fmt(createdAt))}</div></div><div style="display:flex;align-items:center;justify-content:flex-end"><button class="fs-btn fs-btn-secondary" data-duplicate-open="${esc(group.id)}">Resolve</button></div></article>`;
  }).join("") || `<div class="muted">No unresolved duplicate groups match the current filters.</div>`;
  list.querySelectorAll("[data-duplicate-open]").forEach((btn) => btn.addEventListener("click", (event) => {
    event.stopPropagation();
    openDuplicateResolution(btn.getAttribute("data-duplicate-open"));
  }));

  const countBadge = $("duplicateNotificationCount");
  if (countBadge) countBadge.textContent = String(panelItems.length);
  // Auto-open the collapsed panel when there is real work in it, until the
  // user has toggled it manually.
  const panel = $("duplicateNotificationPanel");
  if (panel && typeof panel.open === "boolean" && !panel.dataset.userToggled) {
    panel.open = panelItems.length > 0;
  }
}

const ctx = { state, $, esc, fmt, ymd, milestoneKeys, milestoneLabels, getApplicantMilestones, supabase, showFlash, classIdOf, getClassInfo, classCapacityInfo, summarizeApplicant, classifyRowStatus, getAttendanceSummary, getNotificationRows, getAttendanceStatusCounts, attendanceStatusBadge, displayGroupValue, displaySubgroupValue, getDuplicateGroup, getGroupDuplicates, getDuplicateNotificationsForGroup, buildDuplicateApplicantDetails, getDuplicateGroupStatus, openDuplicateResolution };
const Filters = window.FSApplicantDirectoryFilters;
const Drawer = window.FSApplicantDirectoryDrawer;
const Actions = window.FSApplicantDirectoryActions;
async function openDrawerAsync(id) {
  ctx.$("detailDrawer").classList.add("open");
  ctx.$("drawerOverlay").classList.add("open");
  ctx.$("detailDrawer").setAttribute("aria-hidden", "false");
  ctx.$("drawerName").textContent = "Loading…";
  ctx.$("drawerSub").textContent = "";
  const overviewKv = ctx.$("overviewKv");
  if (overviewKv) overviewKv.innerHTML = '<div class="skeleton" style="height:6rem;border-radius:6px;background:var(--border)"></div>';

  const applicant = state.applicants.find((a) => String(a.id) === String(id));
  const detailData = await fetchApplicantDetailData(applicant || { id });
  state.notifications = detailData.notifRows;
  state.emails = detailData.emailRows;
  state.audits = detailData.auditRows;
  state.moodle = detailData.moodleRows;
  invalidateSummaryCache();

  Drawer.renderDrawerContent(ctx, id);
}

window.openDrawer = (id) => openDrawerAsync(id);
window.closeDrawer = () => Drawer.closeDrawer(ctx);
window.renderDrawerContent = (id) => Drawer.renderDrawerContent(ctx, id);
window.applyFilters = () => Filters.applyFilters(ctx);
window.renderFilters = () => Filters.renderFilters(ctx);
window.sendEmail = (id) => Actions.sendEmail(ctx, id);
window.bulkAction = (kind, value) => Actions.bulkAction(ctx, kind, value);
window.exportData = () => Actions.exportData(ctx);

// Animates KPI numbers from their previous value to the new one.
const kpiPrev = new Map();
function animateKpiValues() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll("#kpiGrid .kpi-value[data-count]").forEach((el) => {
    const target = Number(el.dataset.count || 0);
    const key = el.dataset.kpiKey || "";
    const from = kpiPrev.has(key) ? kpiPrev.get(key) : 0;
    kpiPrev.set(key, target);
    if (reduceMotion || from === target || !Number.isFinite(target)) { el.textContent = String(target); return; }
    const start = performance.now();
    const duration = 450;
    const step = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(from + (target - from) * eased));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function renderKpis(rows) {
  const total = rows.length;
  const assigned = rows.filter((a) => Boolean(a.class_option_id)).length;
  const unassigned = total - assigned;
  const duplicates = rows.filter((a) => String(a.duplicate_status || "").toUpperCase() === "CONFIRMED").length;
  const needsAttention = rows.filter((a) => summarizeApplicant(a).needsFollowUp).length;
  const pendingNotifications = state.duplicateNotifications.filter((n) => String(n.notification_status).toLowerCase() === "pending").length;
  const kpiActive = {
    all: false,
    assigned: state.filters.assignment === "assigned",
    unassigned: state.filters.assignment === "unassigned",
    duplicates: state.filters.duplicate === "duplicate_only",
    attention: state.quickTab === "needs_review",
  };
  const items = [["Total Registrants", total, "Click to show everyone", "all"], ["Assigned Students", assigned, `${total ? Math.round((assigned / total) * 100) : 0}% assigned`, "assigned"], ["Unassigned Students", unassigned, "Need class placement", "unassigned"], ["Confirmed Duplicates", duplicates, `${pendingNotifications} pending notifications`, "duplicates"], ["Needs Attention", needsAttention, "Follow-up required", "attention"]];
  $("kpiGrid").innerHTML = items.map(([l, v, s, action]) => `<article class="card kpi-card kpi-clickable ${kpiActive[action] ? "active" : ""}" data-kpi="${action}" role="button" tabindex="0" title="Click to filter the list"><div class="kpi-label">${esc(l)}</div><div class="kpi-value" data-count="${esc(v)}" data-kpi-key="${esc(l)}" style="${l === "Confirmed Duplicates" && v > 0 ? "color:var(--pill-duplicate)" : ""}">${esc(v)}</div><div class="kpi-sub">${esc(s)}</div></article>`).join("");
  $("kpiGrid").querySelectorAll("[data-kpi]").forEach((card) => {
    const go = () => applyKpiAction(card.dataset.kpi);
    card.addEventListener("click", go);
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });
  animateKpiValues();
}

// KPI cards act as one-click filters; clicking an active card toggles it off.
function applyKpiAction(action) {
  if (action === "all") { resetAllFilters(); return; }
  if (action === "assigned" || action === "unassigned") {
    state.filters.assignment = state.filters.assignment === action ? "" : action;
    const el = $("quickAssignment"); if (el) el.value = state.filters.assignment;
  } else if (action === "duplicates") {
    state.filters.duplicate = state.filters.duplicate === "duplicate_only" ? "" : "duplicate_only";
    const el = $("duplicateFilter"); if (el) el.value = state.filters.duplicate;
  } else if (action === "attention") {
    state.quickTab = state.quickTab === "needs_review" ? "all" : "needs_review";
  }
  renderAll();
}

function renderActionButtons(app) {
  if (state.mode === "review" && canDecisionActions()) {
    return `<div class="btns"><button class="btn primary" data-assign="${esc(app.id)}">Assign Class</button><button class="btn" data-open="${esc(app.id)}">Open</button><button class="btn" data-mark-status="WAITLISTED" data-id="${esc(app.id)}">Waitlist</button><button class="btn" data-mark-status="DUPLICATE" data-id="${esc(app.id)}">Duplicate</button><button class="btn" data-mark-status="REVIEW" data-id="${esc(app.id)}">Flag Review</button></div>`;
  }
  return `<div class="btns"><button class="btn" data-open="${esc(app.id)}">Open</button><button class="btn" data-profile="${esc(app.id)}">Profile</button><button class="btn" data-direct-email="${esc(app.id)}">Email</button></div>`;
}

function reviewStatusClass(app) {
  const status = String(app.duplicate_status || app.registration_status || app.status || "PENDING").toUpperCase();
  if (status === "DUPLICATE") return "duplicate";
  if (status === "REVIEW") return "review";
  if (status === "ASSIGNED" || app.class_option_id) return "assigned";
  return "pending";
}

function relativeTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diff = Math.max(0, Date.now() - date.getTime());
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "Today";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function reviewComparisonGroup(app) {
  const email = String(app?.email || "").toLowerCase().trim();
  if (!email) return [app].filter(Boolean);
  const matches = state.applicants.filter((row) => String(row.email || "").toLowerCase().trim() === email);
  if (matches.length) {
    return [...matches].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }
  return [app].filter(Boolean);
}

function reviewFieldRows(primary, secondary) {
  const formatClassSchedule = (app) => {
    const cls = getClassInfo(app?.class_option_id);
    const schedule = [cls?.day, cls?.class_time].filter(Boolean).join(" ");
    return preferredClassTime(app) || schedule || app?.class_option_id || "Unassigned";
  };
  const rows = [
    ["Email", primary?.email || "-", secondary?.email || "-"],
    ["Phone", primary?.phone || primary?.phone_number || "-", secondary?.phone || secondary?.phone_number || "-"],
    ["Fellowship", primary?.fellowship_code || primary?.fellowship || primary?.subgroup_id || "-", secondary?.fellowship_code || secondary?.fellowship || secondary?.subgroup_id || "-"],
    ["Campus", primary?.group_id || displayGroupValue(primary) || "-", secondary?.group_id || displayGroupValue(secondary) || "-"],
    ["Batch", primary?.batch_id || "-", secondary?.batch_id || "-"],
    ["Class Time", formatClassSchedule(primary), formatClassSchedule(secondary)],
  ];
  return rows.map(([label, left, right]) => ({ label, left, right, diff: String(left) !== String(right) }));
}

async function resolveDuplicateGroup(email, keepId, resolutionNote = "") {
  const normalizedEmail = String(email || "").toLowerCase().trim();
  const group = state.applicants.filter((a) => String(a.email || "").toLowerCase().trim() === normalizedEmail);
  if (group.length < 2) return;
  const keep = group.find((a) => String(a.id) === String(keepId));
  if (!keep) return;

  const now = new Date().toISOString();
  const others = group.filter((a) => String(a.id) !== String(keepId));

  try {
    const { error: keepErr } = await supabase
      .from("applicants")
      .update({
        registration_status: keep.class_option_id ? "ASSIGNED" : "PENDING",
        needs_admin_review: false,
        reviewed_at: now,
        updated_at: now,
        updated_by: state.auth?.profile?.email || null,
      })
      .eq("id", keep.id);
    if (keepErr) throw keepErr;

    if (others.length) {
      const { error: dupErr } = await supabase
        .from("applicants")
        .update({
          registration_status: "DUPLICATE",
          duplicate_status: "RESOLVED",
          needs_admin_review: true,
          reviewed_at: now,
          updated_at: now,
          updated_by: state.auth?.profile?.email || null,
        })
        .in("id", others.map((rec) => rec.id));
      if (dupErr) throw dupErr;
    }

    await supabase.from("audit_logs").insert({
      action: "DUPLICATE_GROUP_RESOLVED",
      entity_type: "applicant",
      entity_id: String(keep.id),
      actor_email: state.auth?.profile?.email || null,
      status: "SUCCESS",
      details: {
        email: normalizedEmail,
        kept_applicant_id: keep.id,
        duplicate_applicant_ids: others.map((row) => row.id),
        resolution_note: resolutionNote || null,
      },
      created_at: now,
    });

    // Patch the affected records locally instead of re-fetching every table.
    Object.assign(keep, {
      registration_status: keep.class_option_id ? "ASSIGNED" : "PENDING",
      needs_admin_review: false, reviewed_at: now, updated_at: now,
    });
    others.forEach((rec) => Object.assign(rec, {
      registration_status: "DUPLICATE", duplicate_status: "RESOLVED",
      needs_admin_review: true, reviewed_at: now, updated_at: now,
    }));
    invalidateSummaryCache();
    showFlash("Duplicate group resolved.", "success");
    state.selectedApplicantId = keep.id;
    state.latestViewedApplicantId = keep.id;
    renderAll();
  } catch (err) {
    showFlash(`Duplicate resolution failed: ${err?.message || err}`, "error");
  }
}

function renderReviewWorkspace(rows) {
  const workspace = $("reviewWorkspace");
  const queue = $("reviewQueueList");
  const detail = $("reviewDetailBody");
  const meta = $("reviewQueueMeta");
  if (!workspace || !queue || !detail || !meta) return;

  workspace.style.display = state.mode === "review" ? "grid" : "none";
  if (state.mode !== "review") return;

  const reviewRows = rows.filter((app) => ["PENDING", "REVIEW", "DUPLICATE", "WAITLISTED", "ASSIGNED"].includes(String(app.registration_status || "PENDING").toUpperCase()));
  meta.textContent = `Showing ${reviewRows.length}`;
  const classMap = new Map(state.classOptions.map((c) => [classIdOf(c), c]));

  if (!state.selectedApplicantId && reviewRows.length) {
    state.selectedApplicantId = String(reviewRows[0].id);
  }
  const selected = reviewRows.find((app) => String(app.id) === String(state.selectedApplicantId)) || reviewRows[0] || null;

  queue.innerHTML = reviewRows.map((app) => {
    const active = String(app.id) === String(selected?.id);
    const statusCls = reviewStatusClass(app);
    const cls = classMap.get(String(app.class_option_id || ""));
    const classTime = [cls?.day, cls?.class_time].filter(Boolean).join(" ");
    const reviewSub = preferredClassTime(app) || classTime || app.class_option_id || app.fellowship_code || app.subgroup_id || "-";
    return `
      <article class="review-item ${active ? "active" : ""}" data-review-open="${esc(app.id)}">
        <div class="review-avatar">${esc((app.full_name || app.email || "?").split(/\s+/).map((part) => part[0]).join("").slice(0,2).toUpperCase())}</div>
        <div>
          <div class="review-name">${esc(app.full_name || "-")}</div>
          <div class="review-sub">${esc(reviewSub)}</div>
        </div>
        <div>
          <span class="review-status ${statusCls}">${esc(String(app.duplicate_status || app.registration_status || "PENDING").toUpperCase())}</span>
          <div class="review-time">${esc(relativeTime(app.created_at || app.updated_at))}</div>
        </div>
      </article>`;
  }).join("") || `<div class="review-empty">No applicants match the current review filters.</div>`;

  if (!selected) {
    detail.innerHTML = `<div class="review-empty">Select an applicant to review.</div>`;
    return;
  }

  const compareGroup = reviewComparisonGroup(selected);
  const incoming = compareGroup[0] || selected;
  const existing = compareGroup.find((item) => String(item.id) !== String(incoming.id)) || selected;
  const fieldRows = reviewFieldRows(incoming, existing);
  const isDuplicateGroup = compareGroup.length > 1;

  detail.innerHTML = `
    <div class="review-student-head">
      <div class="review-student-main">
        <div class="review-avatar" style="width:56px;height:56px;font-size:22px">${esc((selected.full_name || selected.email || "?").split(/\s+/).map((part) => part[0]).join("").slice(0,2).toUpperCase())}</div>
        <div class="review-student-meta">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <h3>${esc(selected.full_name || "-")}</h3>
            <span class="review-status ${reviewStatusClass(selected)}">${esc(String(selected.duplicate_status || selected.registration_status || "PENDING").toUpperCase())}</span>
          </div>
          <p>${esc(selected.fellowship_code || displayGroupValue(selected) || "Applicant")} · ${esc(selected.batch_id || "No batch")} · submitted ${esc(relativeTime(selected.created_at || selected.updated_at))}</p>
        </div>
      </div>
    </div>
    <div class="review-alert">${isDuplicateGroup ? "Same person, submitted twice — pick the record to keep going forward. Differences are highlighted." : "Review this applicant and choose the next action."}</div>
    <div class="review-compare">
      <article class="compare-card ${String(selected.id) === String(incoming.id) ? "selected" : ""}">
        <div class="compare-card-head">
          <div>
            <div class="compare-kicker">New submission</div>
            <div class="compare-name">${esc(incoming.full_name || "-")}</div>
            <div class="compare-date">Submitted ${esc(relativeTime(incoming.created_at || incoming.updated_at))}</div>
          </div>
          <span class="compare-badge incoming">Incoming</span>
        </div>
        <div class="compare-grid">
          ${fieldRows.map((row) => `<div class="row ${row.diff ? "diff" : ""}"><div class="key">${esc(row.label)}</div><div class="value">${esc(row.left)}</div></div>`).join("")}
        </div>
        <div class="compare-footer">${String(selected.id) === String(incoming.id) ? "✓ Selected" : "Use this one"}</div>
      </article>
      <article class="compare-card ${String(selected.id) === String(existing.id) ? "selected" : ""}">
        <div class="compare-card-head">
          <div>
            <div class="compare-kicker">Existing record${existing?.id ? ` · #${esc(String(existing.id).slice(0, 4))}` : ""}</div>
            <div class="compare-name">${esc(existing.full_name || "-")}</div>
            <div class="compare-date">${existing.class_option_id ? `Enrolled ${esc(relativeTime(existing.updated_at || existing.created_at))}` : `Submitted ${esc(relativeTime(existing.created_at || existing.updated_at))}`}</div>
          </div>
          <span class="compare-badge assigned">${existing.class_option_id ? "Assigned" : "Current"}</span>
        </div>
        <div class="compare-grid">
          ${fieldRows.map((row) => `<div class="row ${row.diff ? "diff" : ""}"><div class="key">${esc(row.label)}</div><div class="value">${esc(row.right)}</div></div>`).join("")}
        </div>
        <div class="compare-footer">${String(selected.id) === String(existing.id) ? "✓ Keeping this record" : "Use this one"}</div>
      </article>
    </div>
    <div class="review-note-wrap">
      <div class="review-note-label">Resolution note (optional)</div>
      <textarea id="reviewResolutionNote" placeholder="Why this record was kept..."></textarea>
    </div>
    <div class="review-actions-bar">
      <button id="reviewKeepBtn" class="review-primary-btn">${isDuplicateGroup ? "✓ Keep selected & resolve" : "✓ Mark reviewed"}</button>
      <button id="reviewNotDuplicateBtn" class="review-secondary-btn">✕ Not a duplicate</button>
      <button id="reviewRequestInfoBtn" class="review-warn-btn">▢ Request info</button>
    </div>
  `;

  queue.querySelectorAll("[data-review-open]").forEach((node) => {
    node.addEventListener("click", () => {
      state.selectedApplicantId = node.getAttribute("data-review-open");
      state.latestViewedApplicantId = state.selectedApplicantId;
      renderAll();
    });
  });

  $("reviewKeepBtn")?.addEventListener("click", async () => {
    const note = $("reviewResolutionNote")?.value || "";
    if (isDuplicateGroup) {
      await resolveDuplicateGroup(selected.email, selected.id, note);
    } else {
      await markApplicantStatus(selected.id, selected.class_option_id ? "ASSIGNED" : "PENDING");
    }
  });
  $("reviewNotDuplicateBtn")?.addEventListener("click", async () => {
    await markApplicantStatus(selected.id, selected.class_option_id ? "ASSIGNED" : "PENDING");
  });
  $("reviewRequestInfoBtn")?.addEventListener("click", async () => {
    await markApplicantStatus(selected.id, "REVIEW");
  });
}

function renderMobileCards(rows) {
  const cards = $("mobileCards");
  if (!cards) return;
  const classMap = new Map(state.classOptions.map((c) => [classIdOf(c), c]));
  const visible = rows.slice(0, state.rowLimit);
  const moreCount = rows.length - visible.length;
  cards.innerHTML = (visible.map((app) => {
    const summary = summarizeApplicant(app);
    const milestone = milestoneStatus(summary);
    const cls = classMap.get(String(app.class_option_id || ""));
    const rowStatus = classifyRowStatus(app, summary);
    const duplicateMeta = getDuplicateBadgeMeta(app);
    return `
      <article class="mobile-card">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
          <div style="min-width:0">
            <div style="font-size:15px;font-weight:800;line-height:1.2">${esc(app.full_name || "-")}</div>
            <div class="muted" style="font-size:12px;margin-top:4px">${esc(app.email || "-")}</div>
            <div class="muted" style="font-size:12px">${esc(app.phone || app.phone_number || "-")}</div>
          </div>
          <span class="pill ${rowStatus.cls}">${esc(rowStatus.label)}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;font-size:12px">
          <div><strong>Fellowship</strong><div class="muted">${esc(app.fellowship_code || app.fellowship || app.subgroup_id || "-")}</div></div>
          <div><strong>Class</strong><div class="muted">${esc(app.class_option_id || "-")}</div></div>
          <div><strong>Teacher</strong><div class="muted">${esc(cls?.teacher_name || cls?.teacher_id || "-")}</div></div>
          <div><strong>Batch</strong><div class="muted">${esc(app.batch_id || cls?.batch_id || "-")}</div></div>
          <div><strong>Milestones</strong><div><span class="pill ${milestone.cls}">${esc(milestone.counter)} · ${esc(milestone.label)}</span></div></div>
          <div><strong>Attendance</strong><div class="muted">${summary.attendancePct == null ? "-" : `${summary.attendancePct}%`}</div></div>
          <div><strong>Email Status</strong><div>${statusPill(summary.notificationState)}</div></div>
          <div><strong>Duplicate</strong><div><span class="pill ${duplicateMeta.pillClass}">${esc(duplicateMeta.label)}</span></div></div>
        </div>
        <div style="margin-top:10px">${renderActionButtons(app)}</div>
      </article>`;
  }).join("") || `<div class="table-empty"><div style="font-size:34px">🔍</div><h4>No students match these filters</h4><p>Try removing a filter, or start fresh.</p><button class="fs-btn fs-btn-secondary" data-mobile-clear>Clear all filters</button></div>`) +
  (moreCount > 0 ? `<button class="fs-btn fs-btn-secondary" data-mobile-more style="width:100%">Show 50 more (${moreCount.toLocaleString()} remaining)</button>` : "");

  cards.querySelector("[data-mobile-more]")?.addEventListener("click", () => { state.rowLimit += 50; renderAll(); });
  cards.querySelector("[data-mobile-clear]")?.addEventListener("click", resetAllFilters);
  document.querySelectorAll("#mobileCards [data-open]").forEach((btn) => btn.addEventListener("click", () => {
    const id = String(btn.getAttribute("data-open") || "");
    if (!id) return;
    state.selectedApplicantId = id;
    state.latestViewedApplicantId = id;
    openDrawerAsync(id);
  }));
  document.querySelectorAll("#mobileCards [data-assign]").forEach((btn) => btn.addEventListener("click", () => {
    const id = String(btn.getAttribute("data-assign") || "");
    if (!id) return;
    state.selectedApplicantId = id;
    state.latestViewedApplicantId = id;
    openClassCorrectionModal();
  }));
  document.querySelectorAll("#mobileCards [data-direct-email]").forEach((btn) => btn.addEventListener("click", () => Actions.sendEmail(ctx, btn.getAttribute("data-direct-email"))));
  document.querySelectorAll("#mobileCards [data-mark-status]").forEach((btn) => btn.addEventListener("click", () => markApplicantStatus(btn.getAttribute("data-id"), btn.getAttribute("data-mark-status"))));
  document.querySelectorAll("#mobileCards [data-profile]").forEach((btn) => btn.addEventListener("click", () => {
    const id = String(btn.getAttribute("data-profile") || "");
    if (!id) return;
    state.selectedApplicantId = id;
    state.latestViewedApplicantId = id;
    window.FSStudentProfile?.open(id);
  }));
}

// Core columns are always shown; "extra" columns appear via the More columns
// toggle so the default table fits on screen without sideways scrolling.
const TABLE_COLUMNS = [
  { label: "Fellowship",    extra: true,  cell: (app, x) => esc(app.fellowship_code || app.fellowship || app.subgroup_id || "-") },
  { label: "Class",         extra: false, cell: (app, x) => esc(app.class_option_id || "-") },
  { label: "Teacher",       extra: true,  cell: (app, x) => esc(x.cls?.teacher_name || x.cls?.teacher_id || "-") },
  { label: "Batch",         extra: false, cell: (app, x) => esc(app.batch_id || x.cls?.batch_id || "-") },
  { label: "Milestones",    extra: false, cell: (app, x) => `<span class="pill ${x.milestone.cls}">${esc(x.milestone.counter)} · ${esc(x.milestone.label)}</span>` },
  { label: "Attendance",    extra: false, cell: (app, x) => x.summary.attendancePct == null ? "-" : `${x.summary.attendancePct}%` },
  { label: "Email Status",  extra: true,  cell: (app, x) => statusPill(x.summary.notificationState) },
  { label: "Last Activity", extra: true,  cell: (app, x) => esc(fmt(x.summary.lastActivity)) },
  { label: "Status",        extra: false, cell: (app, x) => `<span class="pill ${x.rowStatus.cls}">${esc(x.rowStatus.label)}</span>` },
  { label: "Duplicate",     extra: true,  cell: (app, x) => x.duplicateBadge },
];

// Resets every filter control and re-renders. Shared by the Clear-all chip,
// KPI "Total" click, empty states, and the review reset button.
function resetAllFilters() {
  state.quickTab = "all";
  Object.keys(state.filters).forEach((k) => { state.filters[k] = ""; });
  state.advFilters = { dateFrom: "", dateTo: "", moodle: "", attStatus: "", active: false };
  ["globalSearch", "fellowshipFilter", "subgroupFilter", "classFilter", "batchFilter", "statusFilter", "duplicateFilter", "attendanceFilter", "milestoneFilter", "quickAssignment", "quickNotif", "afDateFrom", "afDateTo", "afMoodle", "afAttStatus"].forEach((id) => { const el = $(id); if (el) el.value = ""; });
  Filters.updateBadge(ctx);
  renderAll();
}

// Removable chips showing every active filter, so users can always see why
// the list is narrowed and undo any filter with one click.
function renderFilterChips() {
  const wrap = $("activeFilterChips");
  if (!wrap) return;
  const f = state.filters;
  const af = state.advFilters;
  const chips = [];
  const syncClear = (key, elId) => () => { f[key] = ""; const el = $(elId); if (el) el.value = ""; };
  if (state.quickTab && state.quickTab !== "all") {
    const tab = QUICK_TABS.find((t) => t.id === state.quickTab);
    chips.push({ label: tab?.label || state.quickTab, clear: () => { state.quickTab = "all"; } });
  }
  if (f.search) chips.push({ label: `Search: "${f.search}"`, clear: syncClear("search", "globalSearch") });
  if (f.fellowship) chips.push({ label: `Fellowship: ${f.fellowship}`, clear: syncClear("fellowship", "fellowshipFilter") });
  if (f.subgroup) chips.push({ label: `Subgroup: ${f.subgroup}`, clear: syncClear("subgroup", "subgroupFilter") });
  if (f.classOption) chips.push({ label: `Class: ${f.classOption}`, clear: syncClear("classOption", "classFilter") });
  if (f.batch) chips.push({ label: `Batch: ${f.batch}`, clear: syncClear("batch", "batchFilter") });
  if (f.assignment) chips.push({ label: f.assignment === "assigned" ? "Has a class" : "Needs a class", clear: syncClear("assignment", "quickAssignment") });
  if (f.notif) chips.push({ label: `Email: ${f.notif.charAt(0) + f.notif.slice(1).toLowerCase()}`, clear: syncClear("notif", "quickNotif") });
  if (f.milestone) chips.push({ label: `Milestone: ${milestoneLabels()[String(f.milestone).toUpperCase()] || f.milestone}`, clear: syncClear("milestone", "milestoneFilter") });
  if (f.attendance) { const attLabels = { high: "Attendance 75%+", low: "Attendance under 75%", none: "No attendance data" }; chips.push({ label: attLabels[f.attendance] || f.attendance, clear: syncClear("attendance", "attendanceFilter") }); }
  if (f.status) { const stLabels = { assigned: "Status: Assigned", unassigned: "Status: Unassigned", attention: "Status: Needs attention", duplicate: "Status: Duplicate", completed: "Status: Completed" }; chips.push({ label: stLabels[f.status] || `Status: ${f.status}`, clear: syncClear("status", "statusFilter") }); }
  if (f.duplicate) { const dupLabels = { duplicate_only: "Duplicates only", unresolved_only: "Unresolved duplicates", unassigned_only: "Unassigned only" }; chips.push({ label: dupLabels[f.duplicate] || f.duplicate, clear: syncClear("duplicate", "duplicateFilter") }); }
  if (f.date) chips.push({ label: `Registered: ${f.date}`, clear: syncClear("date", "dateFilter") });
  const advClear = (key, elId) => () => { af[key] = ""; const el = $(elId); if (el) el.value = ""; af.active = Boolean(af.dateFrom || af.dateTo || af.moodle || af.attStatus); Filters.updateBadge(ctx); };
  if (af.active && af.dateFrom) chips.push({ label: `From ${af.dateFrom}`, clear: advClear("dateFrom", "afDateFrom") });
  if (af.active && af.dateTo) chips.push({ label: `To ${af.dateTo}`, clear: advClear("dateTo", "afDateTo") });
  if (af.active && af.moodle) { const ml = { yes: "Has Moodle account", no: "No Moodle account", synced: "Moodle synced", failed: "Moodle sync failed" }; chips.push({ label: ml[af.moodle] || af.moodle, clear: advClear("moodle", "afMoodle") }); }
  if (af.active && af.attStatus) { const al = { never: "Never attended", active: "Active (75%+)", atrisk: "At risk (under 75%)" }; chips.push({ label: al[af.attStatus] || af.attStatus, clear: advClear("attStatus", "afAttStatus") }); }

  if (!chips.length) { wrap.innerHTML = ""; wrap.style.display = "none"; return; }
  wrap.style.display = "flex";
  // "ghost" exempts these buttons from premium-theme's global primary-button rule.
  wrap.innerHTML = chips.map((c, i) => `<button type="button" class="filter-chip ghost" data-chip="${i}" title="Remove this filter">${esc(c.label)} <span aria-hidden="true">✕</span></button>`).join("") + `<button type="button" class="filter-chip filter-chip-clear ghost" data-chip-clear>Clear all</button>`;
  wrap.querySelectorAll("[data-chip]").forEach((btn) => btn.addEventListener("click", () => { chips[Number(btn.dataset.chip)].clear(); renderAll(); }));
  wrap.querySelector("[data-chip-clear]")?.addEventListener("click", resetAllFilters);
}

function renderTable(rows) {
  const classMap = new Map(state.classOptions.map((c) => [classIdOf(c), c]));
  const cols = TABLE_COLUMNS.filter((c) => state.showAllColumns || !c.extra);
  const visible = rows.slice(0, state.rowLimit);
  const colCount = cols.length + 3;
  const bodyHtml = visible.map((app) => {
    const summary = summarizeApplicant(app);
    const milestone = milestoneStatus(summary);
    const cls = classMap.get(String(app.class_option_id || ""));
    const rowStatus = classifyRowStatus(app, summary);
    const checked = state.selectedIds.has(String(app.id)) ? "checked" : "";
    const duplicateMeta = getDuplicateBadgeMeta(app);
    const duplicateWarning = duplicateMeta.showWarning ? `<button class="duplicate-alert-btn" type="button" data-duplicate-open="${esc(duplicateMeta.groupId)}" title="Resolve duplicate group" aria-label="Resolve duplicate group">!</button>` : "";
    const duplicateBadge = `<div class="duplicate-cell"><span class="pill ${duplicateMeta.pillClass}">${esc(duplicateMeta.label)}</span>${duplicateMeta.meta ? `<span class="duplicate-meta">${esc(duplicateMeta.meta)}</span>` : ""}</div>`;
    const x = { summary, milestone, cls, rowStatus, duplicateBadge };
    return `<tr><td style="width:36px;padding:8px"><input type="checkbox" class="row-chk" data-id="${esc(app.id)}" ${checked} style="cursor:pointer;width:16px;height:16px" /></td><td class="student-cell" data-row-open="${esc(app.id)}" title="Open student drawer" style="cursor:pointer"><div class="name">${duplicateWarning}${esc(app.full_name || "-")}</div><div class="sub">${esc(app.email || "-")} · ${esc(app.phone || app.phone_number || "-")}</div></td>${cols.map((c) => `<td>${c.cell(app, x)}</td>`).join("")}<td>${renderActionButtons(app)}</td></tr>`;
  }).join("") || `<tr><td colspan="${colCount}"><div class="table-empty"><div style="font-size:34px">🔍</div><h4>No students match these filters</h4><p>Try removing a filter or two — or start fresh.</p><button class="fs-btn fs-btn-secondary" data-empty-clear>Clear all filters</button></div></td></tr>`;
  const foot = rows.length > visible.length
    ? `<div class="table-foot"><span>Showing first ${visible.length.toLocaleString()} of ${rows.length.toLocaleString()} students</span><span style="display:flex;gap:8px"><button class="fs-btn fs-btn-secondary" data-show-more>Show 50 more</button><button class="fs-btn fs-btn-secondary" data-show-all>Show all</button></span></div>`
    : "";
  $("tableWrap").innerHTML = `<table class="${state.showAllColumns ? "" : "slim"}"><thead><tr><th style="width:36px"><input type="checkbox" id="selectAllChk" style="cursor:pointer;width:16px;height:16px" /></th><th>Student</th>${cols.map((c) => `<th>${c.label}</th>`).join("")}<th>Actions</th></tr></thead><tbody>${bodyHtml}</tbody></table>${foot}`;
  $("tableWrap").querySelector("[data-show-more]")?.addEventListener("click", () => { state.rowLimit += 50; renderAll(); });
  $("tableWrap").querySelector("[data-show-all]")?.addEventListener("click", () => { state.rowLimit = Infinity; renderAll(); });
  $("tableWrap").querySelector("[data-empty-clear]")?.addEventListener("click", resetAllFilters);
  document.querySelectorAll("[data-open]").forEach((btn) => btn.addEventListener("click", () => {
    const id = String(btn.getAttribute("data-open") || "");
    if (!id) return;
    state.selectedApplicantId = id;
    state.latestViewedApplicantId = id;
    openDrawerAsync(id);
  }));
  document.querySelectorAll("[data-assign]").forEach((btn) => btn.addEventListener("click", () => {
    const id = String(btn.getAttribute("data-assign") || "");
    if (!id) return;
    state.selectedApplicantId = id;
    state.latestViewedApplicantId = id;
    openClassCorrectionModal();
  }));
  document.querySelectorAll("[data-row-open]").forEach((cell) => cell.addEventListener("click", () => {
    const id = String(cell.getAttribute("data-row-open") || "");
    if (!id) return;
    state.selectedApplicantId = id;
    state.latestViewedApplicantId = id;
    openDrawerAsync(id);
  }));
  document.querySelectorAll("[data-duplicate-open]").forEach((btn) => btn.addEventListener("click", (event) => {
    event.stopPropagation();
    openDuplicateResolution(btn.getAttribute("data-duplicate-open"));
  }));
  document.querySelectorAll("[data-direct-email]").forEach((btn) => btn.addEventListener("click", () => Actions.sendEmail(ctx, btn.getAttribute("data-direct-email"))));
  document.querySelectorAll("[data-mark-status]").forEach((btn) => btn.addEventListener("click", () => markApplicantStatus(btn.getAttribute("data-id"), btn.getAttribute("data-mark-status"))));
  document.querySelectorAll("[data-profile]").forEach((btn) => btn.addEventListener("click", () => {
    const id = String(btn.getAttribute("data-profile") || "");
    if (!id) return;
    state.selectedApplicantId = id;
    state.latestViewedApplicantId = id;
    window.FSStudentProfile?.open(id);
  }));
}

function renderStudentsByBatch(rows) {
  const wrap = $("batchStudentsWrap");
  if (!wrap) return;
  const classMap = new Map(state.classOptions.map((c) => [classIdOf(c), c]));
  const batches = new Map();
  rows.forEach((app) => {
    const cls = classMap.get(String(app.class_option_id || ""));
    const batchId = String(app.batch_id || cls?.batch_id || "Unbatched");
    if (!batches.has(batchId)) batches.set(batchId, []);
    batches.get(batchId).push({ app, cls });
  });

  const ordered = [...batches.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const batchCount = $("batchCount");
  if (batchCount) batchCount.textContent = `${rows.length.toLocaleString()} student${rows.length === 1 ? "" : "s"}`;
  if (!ordered.length) {
    wrap.innerHTML = `<div class="row muted">No students match the current filters.</div>`;
    return;
  }

  wrap.innerHTML = ordered.map(([batchId, items]) => {
    const batchMeta = state.batches.find((b) => String(b.batch_id || "") === String(batchId));
    const title = batchMeta?.batch_name ? `${batchMeta.batch_name} (${batchId})` : batchId;
    const students = items.sort((x, y) => String(x.app.full_name || "").localeCompare(String(y.app.full_name || ""))).map(({ app, cls }) => `<div class="row" data-batch-open="${esc(app.id)}" style="cursor:pointer" title="Open student drawer"><div><strong>${esc(app.full_name || "-")}</strong><div class="muted" style="font-size:12px">${esc(app.email || "-")}</div></div><div style="text-align:right"><div>${esc(app.class_option_id || "-")}</div><div class="muted" style="font-size:12px">${esc(cls?.teacher_name || cls?.teacher_id || "-")}</div></div></div>`).join("");
    return `<details style="border:1px solid var(--line);border-radius:12px;padding:8px 10px;background:var(--surface-2);margin-bottom:8px" open><summary style="cursor:pointer;font-weight:800">${esc(title)} <span class="muted" style="font-weight:600">(${items.length})</span></summary><div style="margin-top:8px">${students}</div></details>`;
  }).join("");
  wrap.querySelectorAll("[data-batch-open]").forEach((row) => {
    row.addEventListener("click", () => openDrawerAsync(row.getAttribute("data-batch-open")));
  });
}

// Only one of the two registration surfaces is visible per viewport (CSS
// breakpoint at 768px); render just that one and re-render on crossover.
const mobileViewMq = window.matchMedia("(max-width: 768px)");
mobileViewMq.addEventListener?.("change", () => renderAll());

const batchSection = $("studentsByBatchSection");
const tableCard = document.querySelector(".table-card");
const duplicatePanel = $("duplicateNotificationPanel");
const workspace = $("reviewWorkspace");

function applyModeUi() {
  var isReview = state.mode === "review";
  const title = $("pageTitle");
  const subtitle = $("pageSubtitle");
  if (title) title.textContent = "Applicants";
  if (subtitle) subtitle.textContent = isReview
    ? "Review new registrations — assign a class, waitlist, or resolve duplicates"
    : "Find students, fix class assignments, and follow up — all in one place";

  function showEl(el) {
    if (!el) return;
    el.style.display = el.dataset.displayType || "block";
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        el.style.opacity = "1";
        el.style.transform = "none";
      });
    });
  }

  function hideEl(el) {
    if (!el) return;
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    window.setTimeout(function () {
      el.style.display = "none";
    }, 180);
  }

  if (isReview) {
    hideEl(batchSection);
    hideEl(tableCard);
    hideEl(duplicatePanel);
    showEl(workspace);
  } else {
    showEl(batchSection);
    showEl(tableCard);
    showEl(duplicatePanel);
    hideEl(workspace);
  }
}

const QUICK_TABS = [
  { id: "all",          label: "All Applicants" },
  { id: "needs_review", label: "Needs Review" },
  { id: "at_risk",      label: "At Risk" },
  { id: "waitlisted",   label: "Waitlisted" },
];

function renderQuickTabs() {
  const wrap = $("quickTabStrip");
  if (!wrap) return;
  wrap.innerHTML = QUICK_TABS.map((t) =>
    `<button class="fs-btn ${state.quickTab === t.id ? "fs-btn-primary" : "fs-btn-secondary"}" data-quick-tab="${esc(t.id)}">${esc(t.label)}</button>`
  ).join("");
  wrap.querySelectorAll("[data-quick-tab]").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.quickTab = btn.getAttribute("data-quick-tab") || "all";
      renderAll();
    })
  );
}

function renderModeTabs() {
  const wrap = $("modeTabs");
  if (!wrap) return;
  const tabs = [{ id: "review", label: "Review Queue" }, { id: "directory", label: "Directory" }];
  wrap.innerHTML = tabs.map((t) => `<button class="fs-btn ${state.mode === t.id ? "fs-btn-primary" : "fs-btn-secondary"}" data-mode-tab="${t.id}">${esc(t.label)}</button>`).join("");
  wrap.querySelectorAll("[data-mode-tab]").forEach((btn) => btn.addEventListener("click", () => setMode(btn.getAttribute("data-mode-tab"))));
}

function setMode(mode) {
  state.mode = String(mode || "directory").toLowerCase() === "review" ? "review" : "directory";
  const url = new URL(window.location.href);
  url.searchParams.set("tab", state.mode);
  window.history.replaceState({}, "", url.toString());
  renderModeTabs();
  applyModeUi();
  renderAll();
}

async function markApplicantStatus(applicantId, status) {
  if (!canDecisionActions()) {
    showFlash("You do not have permission for review decisions.", "warn");
    return;
  }
  const app = state.applicants.find((a) => String(a.id) === String(applicantId || ""));
  if (!app || !status) return;
  const now = new Date().toISOString();
  const patch = { registration_status: status, status, updated_at: now };
  if (status === "WAITLISTED") patch.retry_assignment = true;
  if (status === "DUPLICATE" || status === "REVIEW") patch.needs_admin_review = true;
  const { error } = await supabase.from("applicants").update(patch).eq("id", app.id);
  if (error) {
    showFlash(`Failed to update status: ${error.message || error}`, "error");
    return;
  }
  await supabase.from("audit_logs").insert({
    action: "APPLICANT_STATUS_SET",
    entity_type: "applicant",
    entity_id: app.id,
    actor_email: state.auth?.profile?.email || null,
    status: "SUCCESS",
    details: { previous_status: app.registration_status || app.status || null, new_status: status, source: "applicants-review-mode" },
    created_at: now,
  });
  showFlash(`Status updated to ${status}.`, "success");
  Object.assign(app, patch);
  invalidateSummaryCache();
  renderAll();
}

// When any filter changes, pagination snaps back to the first page.
let lastFilterSig = "";
function renderAll() {
  renderQuickTabs();
  const sig = JSON.stringify([state.filters, state.advFilters, state.quickTab, state.mode]);
  if (sig !== lastFilterSig) { lastFilterSig = sig; state.rowLimit = 50; }
  const rows = Filters.applyFilters(ctx);
  renderKpis(rows);
  renderFilterChips();
  renderDuplicateChip(rows);
  renderDuplicateNotificationPanel(rows);
  if (mobileViewMq.matches) {
    renderMobileCards(rows);
    $("tableWrap").innerHTML = "";
  } else {
    renderTable(rows);
    $("mobileCards").innerHTML = "";
  }
  renderReviewWorkspace(rows);
  if (state.mode !== "review") renderStudentsByBatch(rows);
  const totalCount = state.applicants.length;
  $("rowMeta").textContent = rows.length === totalCount
    ? `Showing all ${totalCount.toLocaleString()} students`
    : `Showing ${rows.length.toLocaleString()} of ${totalCount.toLocaleString()} students`;
  document.querySelectorAll(".row-chk").forEach((chk) => chk.addEventListener("change", () => { chk.checked ? state.selectedIds.add(chk.dataset.id) : state.selectedIds.delete(chk.dataset.id); Actions.updateBulkBar(ctx); }));
  const allChk = $("selectAllChk");
  if (allChk) {
    allChk.checked = rows.length > 0 && rows.every((a) => state.selectedIds.has(String(a.id)));
    allChk.addEventListener("change", () => { if (allChk.checked) rows.forEach((a) => state.selectedIds.add(String(a.id))); else state.selectedIds.clear(); renderAll(); });
  }
  Actions.updateBulkBar(ctx);
  if (state.mode === "review") {
    const bulkBar = $("bulkBar");
    if (bulkBar) bulkBar.style.display = "none";
  }
}
ctx.filteredApplicants = () => Filters.applyFilters(ctx);

async function safeLoad(queryFn, fallback = [], label = "") {
  try {
    const result = await queryFn();
    if (result === null || result === undefined) return fallback;
    return result;
  } catch (err) {
    console.error(`[safeLoad${label ? " " + label : ""}] query failed:`, err?.message || err);
    return fallback;
  }
}
async function fetchApplicantDetailData(applicant) {
  const applicantId = applicant.id;
  // Duplicate groups/notifications are loaded page-wide in loadData; fetching
  // them here used to clobber the directory-level duplicate panel state.
  const [notifRows, emailRows, auditRows, moodleRows] = await Promise.all([
    supabase.from("notification_events").select("*").eq("applicant_id", applicantId).order("created_at", { ascending: false }).limit(50),
    supabase.from("email_queue").select("*").eq("student_id", applicantId).order("created_at", { ascending: false }).limit(50),
    supabase.from("audit_logs").select("*").eq("entity_id", applicantId).order("created_at", { ascending: false }).limit(50),
    supabase.from("moodle_sync").select("*").eq("applicant_id", applicantId).limit(20),
  ]);
  return {
    notifRows: notifRows.data ?? [],
    emailRows: emailRows.data ?? [],
    auditRows: auditRows.data ?? [],
    moodleRows: moodleRows.data ?? [],
  };
}

// attendance_records is the applicant-keyed table the current portals write;
// attendance_log is the legacy student-keyed table (no created_at/applicant_id
// columns — ordering by created_at on it errors, which left attendance empty).
async function loadAttendance() {
  const { data: rec, error: recErr } = await supabase
    .from("attendance_records")
    .select("applicant_id,class_option_id,batch_id,session_date,class_session,status,created_at")
    .order("created_at", { ascending: false })
    .limit(10000);
  if (!recErr && rec?.length) return rec;
  const { data: log } = await supabase
    .from("attendance_log")
    .select("student_id,class_option_id,batch_id,present,made_up,class_date,class_number,logged_at")
    .order("logged_at", { ascending: false })
    .limit(10000);
  return log || [];
}

// Server-side aggregation (applicant_directory_summaries view): one row per
// applicant instead of ~10k attendance rows + ~20k milestone rows. Returns
// null when the view doesn't exist yet so loadData falls back to raw tables.
async function loadSummaries() {
  try {
    const { data, error } = await supabase
      .from("applicant_directory_summaries")
      .select("applicant_id,total_sessions,attended_sessions,last_attendance_at,completed_milestones")
      .limit(5000);
    if (error) return null;
    return data || [];
  } catch (_) {
    return null;
  }
}

async function loadData() {
  const summaryRows = await loadSummaries();
  const useSummaries = Array.isArray(summaryRows);
  const [applicants, classOptions, batches, attendance, milestoneDefs, milestoneStatusRows, duplicateGroups, duplicateNotifications] = await Promise.all([
    safeLoad(async () => (await supabase.from("applicants").select("*").order("created_at", { ascending: false }).limit(3000)).data || [], [], "applicants"),
    safeLoad(async () => (await supabase.from("class_options").select("*").limit(3000)).data || [], [], "class_options"),
    safeLoad(async () => (await supabase.from("batches").select("batch_id,batch_name,start_sunday,status,active").limit(500)).data || [], [], "batches"),
    useSummaries ? Promise.resolve([]) : safeLoad(loadAttendance, [], "attendance"),
    safeLoad(async () => (await supabase.from("milestone_definitions").select("code,title,label,active").eq("active", true).order("sort_order", { ascending: true })).data || [], [], "milestone_definitions"),
    useSummaries ? Promise.resolve([]) : safeLoad(async () => (await supabase.from("student_milestone_status").select("applicant_id,milestone_code,completed,updated_at").eq("completed", true).limit(20000)).data || [], [], "student_milestone_status"),
    safeLoad(async () => (await supabase.from("duplicate_registration_groups").select("*").order("created_at", { ascending: false }).limit(1000)).data || [], [], "duplicate_registration_groups"),
    safeLoad(async () => (await supabase.from("duplicate_notifications").select("*").order("created_at", { ascending: false }).limit(1000)).data || [], [], "duplicate_notifications"),
  ]);
  const defs = (milestoneDefs || []).map((m) => ({
    code: normalizedMilestoneCode(m.code),
    label: String(m.label || m.title || m.code || "").trim(),
  })).filter((m) => m.code);
  Object.assign(state, {
    applicants, classOptions, batches,
    notifications: [], emails: [], audits: [], moodle: [], attendance,
    milestoneDefs: defs.length ? defs : fallbackMilestoneDefs,
    milestoneStatusRows: milestoneStatusRows || [],
    applicantSummaries: new Map((summaryRows || []).map((r) => [String(r.applicant_id), r])),
    duplicateGroups: duplicateGroups || [],
    duplicateNotifications: duplicateNotifications || [],
  });
  buildMilestoneCache();
  buildDuplicateCache();
  buildAttendanceCache();
  invalidateSummaryCache();
  Filters.renderFilters(ctx);
  renderAll();
}
ctx.loadData = loadData;

function closeClassModal() {
  $("classCorrectionModal").classList.remove("open");
  if (!$("detailDrawer").classList.contains("open")) $("drawerOverlay").classList.remove("open");
}

function openClassCorrectionModal() {
  const app = state.applicants.find((a) => String(a.id) === String(state.selectedApplicantId));
  if (!app) { showFlash("No student selected.", "warn"); return; }
  $("currentClassDisplay").value = app.class_option_id || "Unassigned";
  const sel = $("newClassOptionId");
  sel.innerHTML = '<option value="">Select new class…</option>' +
    state.classOptions
      .filter((c) => c.active !== false && c.class_option_id !== app.class_option_id)
      .sort((a, b) => String(a.class_option_id).localeCompare(String(b.class_option_id)))
      .map((c) => `<option value="${esc(c.class_option_id)}">${esc(c.class_option_id)} — ${esc(c.teacher_name || "")} ${esc(c.day || "")} ${esc(c.class_time || "")}</option>`)
      .join("");
  $("correctionReason").value = "";
  $("modalError").innerHTML = "";
  $("classMeta").innerHTML = "";
  $("modalWarnings").innerHTML = "";
  $("classCorrectionModal").classList.add("open");
  $("drawerOverlay").classList.add("open");
}

function wireActions() {
  $("refreshBtnTop").addEventListener("click", loadData);
  $("refreshBtn").addEventListener("click", loadData);
  $("reviewResetBtn")?.addEventListener("click", () => {
    resetAllFilters();
    Filters.renderFilters(ctx);
  });

  // More/fewer columns toggle — persisted per browser.
  const colsBtn = $("toggleColumnsBtn");
  if (colsBtn) {
    colsBtn.textContent = state.showAllColumns ? "Fewer columns" : "More columns";
    colsBtn.addEventListener("click", () => {
      state.showAllColumns = !state.showAllColumns;
      try { localStorage.setItem("fs_dir_all_cols", state.showAllColumns ? "1" : "0"); } catch (_) { /* best effort */ }
      colsBtn.textContent = state.showAllColumns ? "Fewer columns" : "More columns";
      renderAll();
    });
  }

  // Once a user opens/closes the duplicate panel themselves, stop auto-toggling it.
  $("duplicateNotificationPanel")?.querySelector("summary")?.addEventListener("click", () => {
    $("duplicateNotificationPanel").dataset.userToggled = "1";
  });
  
  // NEW: CSV Export
  $("exportCsvBtn")?.addEventListener("click", () => {
    const filtered = Filters.applyFilters(ctx);
    if (window.DuplicateManager) {
      window.DuplicateManager.exportToCSV(filtered, `registrations-${new Date().toISOString().split('T')[0]}.csv`);
    }
  });
  
  // Listen for export-csv custom event
  document.addEventListener('export-csv', () => {
    const filtered = Filters.applyFilters(ctx);
    if (window.DuplicateManager) {
      window.DuplicateManager.exportToCSV(filtered, `registrations-${new Date().toISOString().split('T')[0]}.csv`);
    }
  });
  
  $("drawerOverlay").addEventListener("click", () => {
    if (!$("classCorrectionModal").classList.contains("open")) Drawer.closeDrawer(ctx);
  });
  $("closeDrawerBtn").addEventListener("click", () => Drawer.closeDrawer(ctx));

  // Change Class — opens correction modal
  $("changeClassBtn").addEventListener("click", openClassCorrectionModal);
  $("cancelCorrectionBtn").addEventListener("click", closeClassModal);
  $("closeCorrectionBtn").addEventListener("click", closeClassModal);

  // Class select change — show capacity info
  $("newClassOptionId").addEventListener("change", () => {
    const val = $("newClassOptionId").value;
    if (!val) { $("classMeta").innerHTML = ""; $("modalWarnings").innerHTML = ""; return; }
    const cls = ctx.getClassInfo(val);
    const info = ctx.classCapacityInfo(val);
    $("classMeta").innerHTML = `
      <div><label>Teacher</label><strong>${esc(cls?.teacher_name || "-")}</strong></div>
      <div><label>Day / Time</label><strong>${esc(cls?.day || "-")} ${esc(cls?.class_time || "")}</strong></div>
      <div><label>Enrolled</label><strong>${info.current}${info.max ? " / " + info.max : ""}</strong></div>`;
    $("modalWarnings").innerHTML = info.full
      ? `<div class="warn">This class is at capacity. Assignment will be blocked.</div>` : "";
  });

  // Save class correction
  $("saveCorrectionBtn").addEventListener("click", async () => {
    try {
      const app = state.applicants.find((a) => String(a.id) === String(state.selectedApplicantId));
      if (!app) return;
      const newClassId = $("newClassOptionId").value;
      const reason = ($("correctionReason")?.value || "").trim();
      if (!newClassId) { $("modalError").innerHTML = '<div class="err">Please select a new class.</div>'; return; }
      if (reason.length < 10) { $("modalError").innerHTML = '<div class="err">Reason must be at least 10 characters.</div>'; return; }
      const info = ctx.classCapacityInfo(newClassId);
      if (info.full) { $("modalError").innerHTML = '<div class="err">This class is at capacity. Assignment blocked.</div>'; return; }
      const cls = ctx.getClassInfo(newClassId);
      const now = new Date().toISOString();
      const actor = state.auth?.profile?.email || null;
      const patch = { class_option_id: newClassId, registration_status: "ASSIGNED", assigned_at: now, updated_at: now };
      if (cls?.batch_id) patch.batch_id = cls.batch_id;
      const { error } = await supabase.from("applicants").update(patch).eq("id", app.id);
      if (error) { $("modalError").innerHTML = `<div class="err">${esc(error.message)}</div>`; return; }
      await supabase.from("email_queue").insert({
        recipient_email: app.email, recipient_name: app.full_name || "",
        template_key: "class_reassignment_notice",
        subject: "Your Rock Solid class has been updated",
        status: "Pending",
        payload: {
          first_name: String(app.full_name || "Student").split(/\s+/)[0],
          old_class: app.class_option_id || "Unassigned", new_class: newClassId,
          new_teacher: cls?.teacher_name || "", new_day: cls?.day || "", new_time: cls?.class_time || "",
          reason,
        },
      });
      await supabase.from("moodle_enrollment_sync")
        .update({ class_option_id: newClassId, sync_status: "PENDING", updated_at: now })
        .eq("applicant_id", app.id);
      await supabase.from("audit_logs").insert({
        action: "CLASS_CORRECTION", entity_type: "applicant", entity_id: app.id,
        actor_email: actor, status: "SUCCESS",
        details: { old_class: app.class_option_id, new_class: newClassId, reason },
        created_at: now,
      });
      closeClassModal();
      showFlash(`Class changed to ${newClassId}. Notification queued.`, "success");
      Object.assign(app, patch);
      invalidateSummaryCache();
      renderAll();
      openDrawerAsync(app.id);
    } catch (err) {
      showFlash(`Failed: ${err?.message || err}`, "error");
    }
  });

  // Mark Needs Follow-up — toggle
  $("needsFollowUpBtn").addEventListener("click", async () => {
    try {
      const app = state.applicants.find((a) => String(a.id) === String(state.selectedApplicantId));
      if (!app) { showFlash("No student selected.", "warn"); return; }
      const next = !app.needs_admin_review;
      const now = new Date().toISOString();
      const { error } = await supabase.from("applicants")
        .update({ needs_admin_review: next, updated_at: now }).eq("id", app.id);
      if (error) { showFlash(`Failed: ${error.message}`, "error"); return; }
      await supabase.from("audit_logs").insert({
        action: "NEEDS_FOLLOW_UP_TOGGLED", entity_type: "applicant", entity_id: app.id,
        actor_email: state.auth?.profile?.email || null, status: "SUCCESS",
        details: { needs_admin_review: next }, created_at: now,
      });
      showFlash(next ? "Marked as needs follow-up." : "Follow-up cleared.", "success");
      $("needsFollowUpBtn").textContent = next ? "✓ Needs Follow-up" : "Mark Needs Follow-up";
      app.needs_admin_review = next;
      app.updated_at = now;
      invalidateSummaryCache();
      renderAll();
      Drawer.renderDrawerContent(ctx, state.selectedApplicantId);
    } catch (err) {
      showFlash(`Failed: ${err?.message || err}`, "error");
    }
  });

  // Send Email
  $("sendEmailBtn").addEventListener("click", () => Actions.sendEmail(ctx, state.selectedApplicantId));

  // Open Attendance — opens FSStudentProfile on attendance tab (default)
  $("openAttendanceBtn").addEventListener("click", () => {
    if (!state.selectedApplicantId) { showFlash("No student selected.", "warn"); return; }
    Drawer.closeDrawer(ctx);
    window.FSStudentProfile?.open(state.selectedApplicantId);
  });

  // Open Milestones — opens FSStudentProfile on milestones tab
  $("openMilestonesBtn").addEventListener("click", () => {
    if (!state.selectedApplicantId) { showFlash("No student selected.", "warn"); return; }
    Drawer.closeDrawer(ctx);
    window.FSStudentProfile?.open(state.selectedApplicantId, { initialTab: "milestones" });
  });

  // Retry Notification — finds latest failed email_queue or scheduled_notification row and calls retry-worker
  $("retryNotificationBtn").addEventListener("click", async () => {
    const app = state.applicants.find((a) => String(a.id) === String(state.selectedApplicantId));
    if (!app) { showFlash("No student selected.", "warn"); return; }
    const isFailed = (st) => ["FAILED", "ERROR"].includes(String(st || "").trim().toUpperCase());
    const byApplicant = (r) => {
      const rid = String(r.applicant_id || r.student_id || "");
      const remail = String(r.recipient_email || r.email || "").toLowerCase();
      return (rid && rid === String(app.id)) || (app.email && remail === app.email.toLowerCase());
    };
    const failedEmail = state.emails.filter((e) => byApplicant(e) && isFailed(e.status))
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];
    const failedNotif = state.notifications.filter((n) => byApplicant(n) && isFailed(n.status || n.event_status))
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];
    const target = failedEmail || failedNotif;
    if (!target) { showFlash("No failed notifications found for this student.", "warn"); return; }
    const btn = $("retryNotificationBtn");
    btn.disabled = true;
    btn.textContent = "Retrying…";
    try {
      await supabase.functions.invoke("retry-worker", {
        body: {
          action: "retry",
          source: failedEmail ? "email_queue" : "scheduled_notifications",
          id: String(target.id),
        },
      });
      showFlash("Retry queued. Email will send on next run.", "success");
      btn.textContent = "Retried ✓";
      setTimeout(() => { btn.textContent = "Retry Email"; btn.disabled = false; }, 3000);
    } catch (err) {
      showFlash(`Retry failed: ${err?.message || err}`, "error");
      btn.textContent = "Retry Email";
      btn.disabled = false;
    }
  });

  // Open ClickUp Task
  $("openClickupBtn").addEventListener("click", () => {
    const app = state.applicants.find((a) => String(a.id) === String(state.selectedApplicantId));
    const url = app?.clickup_task_url || app?.clickup_url;
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  });

  $("openSelectedBtn").addEventListener("click", () => {
    const fallbackSelectedId = [...state.selectedIds][0] || "";
    const targetId = String(state.latestViewedApplicantId || state.selectedApplicantId || fallbackSelectedId || "");
    if (!targetId) { showFlash("Open a student first.", "warn"); return; }
    state.selectedApplicantId = targetId;
    state.latestViewedApplicantId = targetId;
    openDrawerAsync(targetId);
  });

  $("bulkStatusSelect").addEventListener("change", async (e) => { if (e.target.value) await Actions.bulkAction(ctx, "status", e.target.value); });
  $("bulkClassSelect").addEventListener("change", async (e) => { if (e.target.value) await Actions.bulkAction(ctx, "class", e.target.value); });
  $("bulkEmailBtn").addEventListener("click", () => { if (!state.selectedIds.size) { showFlash("No students selected.", "warn"); return; } if (!window.FSDirectEmail?.open) { showFlash("Direct email modal is not available.", "error"); return; } window.FSDirectEmail.open({ bulk: true }); });
  $("bulkExportBtn").addEventListener("click", () => Actions.exportData(ctx));
  $("bulkClearBtn").addEventListener("click", () => { state.selectedIds.clear(); Actions.updateBulkBar(ctx); renderAll(); });

  // NEW: Duplicate resolution
  $("resolveduplicateBtn")?.addEventListener("click", async () => {
    const groupId = $("duplicateResolutionModal")?.dataset.groupId;
    const primaryId = $("duplicatePrimarySelect").value;
    const note = ($("duplicateResolutionNote")?.value || "").trim();
    
    if (!groupId || !primaryId) {
      $("duplicateModalError").innerHTML = '<div class="err">Please select a primary record.</div>';
      return;
    }
    
    $("resolveduplicateBtn").disabled = true;
    $("resolveduplicateBtn").textContent = "Resolving...";
    
    try {
      const success = await window.DuplicateManager.resolveDuplicates(supabase, groupId, primaryId, note);
      if (success) {
        showFlash("Duplicates resolved successfully.", "success");
        window.DuplicateUI.closeResolutionModal();
        loadData();
      } else {
        $("duplicateModalError").innerHTML = '<div class="err">Failed to resolve duplicates. Please try again.</div>';
      }
    } catch (err) {
      $("duplicateModalError").innerHTML = `<div class="err">${esc(err?.message || "Unknown error")}</div>`;
    } finally {
      $("resolveduplicateBtn").disabled = false;
      $("resolveduplicateBtn").textContent = "Confirm & Mark Primary";
    }
  });
}

async function boot() {
  CONFIG = AUTH_CONFIG;
  supabase = AUTH_SUPABASE;
  requireAuth = AUTH_REQUIRE_AUTH;
  ctx.supabase = supabase;
  setTheme();
  if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes("YOUR-PROJECT-REF") || !CONFIG.SUPABASE_ANON_KEY || CONFIG.SUPABASE_ANON_KEY.includes("YOUR_SUPABASE_ANON_KEY")) {
    window.FSAdminShell && window.FSAdminShell.mount({ active: "applicants", pageTitle: "Applicants", profileName: "Not connected" });
    $("flashArea").innerHTML = `<div class="err">Not connected - open through live server with config.js in place.</div>`;
    return;
  }
  const auth = await requireAuth(["admin", "superadmin", "principal", "regional_secretary"]);
  if (!auth) return;
  state.auth = auth;
  const searchParams = new URLSearchParams(window.location.search);
  const tabParam = String(searchParams.get("tab") || "").toLowerCase();
  state.mode = tabParam === "review" ? "review" : "directory";
  const duplicateFilterParam = String(searchParams.get("duplicate") || "").toLowerCase();
  if (duplicateFilterParam) {
    state.filters.duplicate = duplicateFilterParam;
  }

  window.FSDirectEmail?.init({ supabase, senderEmail: auth.profile?.email || "" });
  window.FSStudentProfile?.init({ supabase, userRole: state.auth?.profile?.role || "admin" });
  window.FSAdminShell?.mount({ active: "applicants", pageTitle: "Applicants", role: auth.profile?.role || null });

  Filters.bind(ctx, renderAll);
  wireActions();
  renderModeTabs();
  [batchSection, tableCard, duplicatePanel, workspace].forEach(function (el) {
    if (el) el.dataset.displayType = getComputedStyle(el).display === "none"
      ? "block"
      : getComputedStyle(el).display;
  });
  if (workspace) workspace.dataset.displayType = "grid";
  applyModeUi();
  await loadData();
  if (duplicateFilterParam && $("duplicateFilter")) {
    $("duplicateFilter").value = duplicateFilterParam;
  }
}

boot().catch((e) => { $("flashArea").innerHTML = `<div class="err">Failed to load applicants: ${esc(e?.message || e)}</div>`; });
