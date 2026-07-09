import { submitAvailability } from "./availabilityApi.js";
import { supabase, getSessionOrNull, getCurrentProfile } from "../auth/auth-client.js";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DISPLAY_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const GRID_START_MIN = 6 * 60; // 6:00 AM
const GRID_END_MIN = 22 * 60; // 10:00 PM
const SLOT_SIZE_OPTIONS = [15, 30, 60];
const TZ_OPTIONS = [
  "America/Toronto",
  "America/Vancouver",
  "America/Edmonton",
  "America/Winnipeg",
  "America/Halifax",
  "America/St_Johns",
  "America/Regina",
  "UTC",
];
const TZ_LABELS = {
  "America/Toronto": "Toronto",
  "America/Vancouver": "Vancouver",
  "America/Edmonton": "Edmonton",
  "America/Winnipeg": "Winnipeg",
  "America/Halifax": "Halifax",
  "America/St_Johns": "St. John's",
  "America/Regina": "Regina",
  UTC: "UTC",
};
const SUBGROUP_LABELS = {
  CESGA: "Prairies (MB / SK)",
  CESGB: "Atlantic Canada",
  CSGA: "GTA, Ottawa & Quebec",
  CSGB: "Waterloo & West GTA",
  WSGA: "Alberta & BC",
  WSGB: "Southern Alberta",
};

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function slotKey(day, time) { return `${day}__${time}`; }
function splitKey(key) { const [day, time] = String(key || "").split("__"); return { day, time }; }

function minutesToLabel(total) {
  const h = Math.floor(total / 60);
  const mi = total % 60;
  const ap = h >= 12 ? "PM" : "AM";
  let hh = h % 12;
  if (hh === 0) hh = 12;
  return `${hh}:${String(mi).padStart(2, "0")} ${ap}`;
}
function buildSlotStarts(slotMinutes) {
  const out = [];
  for (let m = GRID_START_MIN; m <= GRID_END_MIN; m += slotMinutes) out.push(m);
  return out;
}
function tzAbbrev(tz, when) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(when || new Date());
    return (parts.find((p) => p.type === "timeZoneName") || {}).value || "";
  } catch {
    return "";
  }
}
function tzDisplayLabel(tz) {
  const city = TZ_LABELS[tz] || String(tz || "").split("/").pop().replace(/_/g, " ");
  const abbr = tzAbbrev(tz);
  return abbr ? `${city} (${abbr})` : city;
}

function formatBatchRange(startDate, endDate) {
  const fmt = (d) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "-";
  return `${fmt(startDate)} - ${fmt(endDate)}`;
}
function selectedBatch(state) {
  return state.batches.find((b) => b.batch_id === state.batchId) || state.batches[0] || null;
}

function parseTime12h(v) {
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2]);
  const ap = m[3].toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return { h, mi };
}
function to24h(v) {
  const t = parseTime12h(v);
  if (!t) return null;
  return `${String(t.h).padStart(2, "0")}:${String(t.mi).padStart(2, "0")}:00`;
}
function dayIdx(day) { return DAYS.indexOf(day); }
function weekdayDateInMonth(year, monthIndex, weekdayName) {
  const first = new Date(year, monthIndex - 1, 1);
  const firstIdx = (first.getDay() + 6) % 7;
  const target = dayIdx(weekdayName);
  const delta = (target - firstIdx + 7) % 7;
  return 1 + delta;
}
function getTzOffsetMs(instant, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(instant).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - instant.getTime();
}
function wallClockToInstant(year, monthIndex, dayOfMonth, hour, minute, timeZone) {
  const naive = Date.UTC(year, monthIndex - 1, dayOfMonth, hour, minute, 0);
  const off1 = getTzOffsetMs(new Date(naive), timeZone);
  const adj = naive - off1;
  const off2 = getTzOffsetMs(new Date(adj), timeZone);
  return new Date(off1 === off2 ? adj : adj - off2 + off1);
}
// Preserve conversion logic from teacher-schedule.html
function convertTeacherSlotToCampus(slot, teacherTz, campusTz, month) {
  const t = parseTime12h(slot.time);
  if (!t) return { campusDay: slot.day, campusTime: slot.time };
  const dom = weekdayDateInMonth(month.year, month.monthIndex, slot.day);
  const instant = wallClockToInstant(month.year, month.monthIndex, dom, t.h, t.mi, teacherTz);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: campusTz, weekday: "long", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(instant);
  const campusDay = (parts.find((p) => p.type === "weekday") || {}).value || slot.day;
  const hr = (parts.find((p) => p.type === "hour") || {}).value || "";
  const mi = (parts.find((p) => p.type === "minute") || {}).value || "00";
  const dp = ((parts.find((p) => p.type === "dayPeriod") || {}).value || "").toUpperCase();
  return { campusDay, campusTime: `${hr}:${mi} ${dp}` };
}

export async function mountTeacherAvailability(containerId) {
  const root = document.getElementById(containerId);
  if (!root) throw new Error(`Container not found: ${containerId}`);

  const state = {
    profile: null,
    teacherRecord: null,
    teacherOptions: [],
    selectedTeacherRecord: null,
    submitForAnother: false,
    campuses: [],
    selectedCampusCodes: new Set(),
    activeCampusCode: "",
    defaultCampusCode: "",
    slotSet: new Set(),
    slotMinutes: 30,
    slotStarts: [],
    search: "",
    teacherTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto",
    batches: [],
    batchId: "",
    submitting: false,
  };
  state.slotStarts = buildSlotStarts(state.slotMinutes);

  const session = await getSessionOrNull();
  if (!session) {
    window.location.href = "../auth/login.html";
    return;
  }
  const profile = await getCurrentProfile();
  if (!profile?.email) {
    window.location.href = "../auth/login.html";
    return;
  }
  state.profile = profile;

  const teacherEmail = String(profile.email || "").trim().toLowerCase();
  const { data: teacherRow } = await supabase
    .from("teachers")
    .select("teacher_id,full_name,email,subgroup_id")
    .ilike("email", teacherEmail)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  state.teacherRecord = teacherRow || null;
  state.selectedTeacherRecord = state.teacherRecord || null;

  const { data: teacherOptionsRaw } = await supabase
    .from("teachers")
    .select("teacher_id,full_name,email,subgroup_id,deleted_at,active")
    .eq("active", true)
    .is("deleted_at", null)
    .order("full_name");
  state.teacherOptions = (teacherOptionsRaw || []).map((r) => ({
    teacher_id: String(r.teacher_id || "").trim(),
    full_name: String(r.full_name || "").trim(),
    email: String(r.email || "").trim(),
    subgroup_id: String(r.subgroup_id || "").trim(),
  })).filter((r) => r.teacher_id && r.email);

  const { data: campusesRaw, error: campusesErr } = await supabase
    .from("fellowship_map")
    .select("fellowship_code,campus_name,group_id,subgroup_id,timezone,active")
    .eq("active", true)
    .order("campus_name");
  if (campusesErr) throw campusesErr;

  state.campuses = (campusesRaw || []).map((r) => ({
    code: String(r.fellowship_code || "").trim(),
    campusName: String(r.campus_name || "").trim(),
    groupID: String(r.group_id || "").trim(),
    subgroupID: String(r.subgroup_id || "").trim(),
    timezone: String(r.timezone || "").trim() || "America/Toronto",
  })).filter((r) => r.code);

  let preferredCampus = null;
  if (state.teacherRecord?.subgroup_id) {
    preferredCampus = state.campuses.find((c) => c.subgroupID === state.teacherRecord.subgroup_id) || null;
    if (preferredCampus) state.teacherTimezone = preferredCampus.timezone || state.teacherTimezone;
  }
  state.defaultCampusCode = (preferredCampus || state.campuses[0] || {}).code || "";
  if (state.defaultCampusCode) {
    state.selectedCampusCodes.add(state.defaultCampusCode);
    state.activeCampusCode = state.defaultCampusCode;
  }

  root.innerHTML = `
    <style>
      .ta-page-head {
        position: sticky; top: 8px; z-index: 20;
        border: 1px solid var(--fs-border); border-radius: 16px; padding: 12px 14px;
        background: color-mix(in srgb, var(--fs-surface) 88%, transparent);
        backdrop-filter: blur(8px);
      }
      .ta-page-head h1 { margin: 0; font-size: 22px; font-weight: 800; }
      .ta-page-head p { margin: 4px 0 0; color: var(--fs-text-muted); font-size: 12px; }
      .ta-card { background:#fff; border:1px solid var(--fs-border); border-radius:12px; box-shadow: 0 4px 20px rgba(76,42,146,.08); padding:24px; margin-top:12px; }
      .availability-layout { display:grid; grid-template-columns: 1fr 280px; gap:24px; align-items:start; }
      .ta-left-grid { display:grid; grid-template-columns: repeat(2,minmax(0,1fr)); row-gap:14px; column-gap:48px; }
      .ta-card label.fs-label { font-size:11px; font-weight:700; color:var(--fs-text-muted); text-transform:uppercase; letter-spacing:.05em; }
      .ta-left-grid input:disabled { background: var(--fs-bg, #faf9ff); color: var(--fs-text-muted, #6b7280); border-color: var(--fs-border); opacity: 1; }
      .ta-pill-wrap { display:flex; flex-wrap:wrap; gap:6px; }
      .ta-pill { border-radius:999px; border:1px solid #d1d5db; background:#fff; color:#6b7280; min-height:34px; }
      .ta-pill:hover { background:#f5f3ff; border-color:#c4b5fd; color:#4C2A92; }
      .ta-pill.active { background:#4C2A92; color:#fff; border-color:#4C2A92; }
      .ta-badge { margin-left:6px; border-radius:999px; padding:1px 7px; font-size:11px; font-weight:700; background:rgba(0,0,0,.08); }
      .ta-pill.active .ta-badge { background:rgba(255,255,255,.2); color:#fff; }
      .ta-default-tag { font-size:9px; opacity:.85; margin-left:4px; text-transform:uppercase; letter-spacing:.04em; }
      .ta-more-campuses-summary { cursor:pointer; font-weight:700; color:#4C2A92; font-size:13px; }
      .ta-group-head { font-size:16px; font-weight:800; margin:0 0 6px; padding-left:10px; border-left:4px solid #4C2A92; }
      .ta-group-head.ce { border-left-color:#4C2A92; }
      .ta-group-head.cs { border-left-color:#C8102E; }
      .ta-group-head.ws { border-left-color:#1a3c5e; }
      .ta-subgroup { color:var(--fs-text-muted); font-size:11px; text-transform:uppercase; letter-spacing:.05em; font-weight:700; }
      .ta-search-wrap { position:relative; }
      .ta-search-wrap::before {
        content:"";
        position:absolute; left:12px; top:50%; transform:translateY(-50%);
        width:16px; height:16px; opacity:.55;
        background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E");
        background-size:16px 16px; background-repeat:no-repeat;
      }
      #taCampusSearch { width:100%; border:1px solid #e5e7eb; border-radius:8px; padding:10px 12px 10px 36px; }
      .ta-grid-toolbar { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:10px; padding-bottom:12px; border-bottom:1px solid var(--fs-border); margin-bottom:10px; }
      .ta-grid-toolbar-left { display:flex; align-items:center; gap:8px; font-weight:800; color:#19152d; font-size:15px; }
      .ta-grid-toolbar-right { display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
      .ta-grid-toolbar-right > span { display:flex; align-items:center; gap:6px; }
      .ta-grid-toolbar-right label { font-size:12px; font-weight:700; color:var(--fs-text-muted); }
      .ta-grid-toolbar-right select { border:1px solid #e5e7eb; border-radius:8px; padding:6px 10px; font-size:13px; }
      .ta-grid-note { display:flex; align-items:center; gap:6px; font-size:13px; color:var(--fs-text-muted); margin-bottom:10px; }
      .ta-grid-note strong { color:#19152d; }
      .ta-icon-cal, .ta-icon-clock { display:inline-block; width:16px; height:16px; vertical-align:-3px; opacity:.6; background-repeat:no-repeat; background-size:16px 16px; }
      .ta-icon-cal { background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='18' rx='2' ry='2'/%3E%3Cline x1='16' y1='2' x2='16' y2='6'/%3E%3Cline x1='8' y1='2' x2='8' y2='6'/%3E%3Cline x1='3' y1='10' x2='21' y2='10'/%3E%3C/svg%3E"); }
      .ta-icon-clock { background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cpolyline points='12 6 12 12 16 14'/%3E%3C/svg%3E"); }
      .ta-grid-scroll { max-height:460px; overflow-y:auto; border:1px solid var(--color-border,#e6dcff); border-radius:10px; }
      .ta-days { display:grid; grid-template-columns:72px repeat(7,1fr); background:var(--color-bg,#faf8ff); border-bottom:1px solid var(--color-border,#e6dcff); position:sticky; top:0; z-index:1; }
      .ta-days div { padding:7px; text-align:center; font-size:11px; font-weight:700; border-left:1px solid var(--color-border,#e6dcff); }
      .ta-days div:first-child { border-left:0; }
      .ta-row { display:grid; grid-template-columns:72px repeat(7,1fr); }
      .ta-time { padding:2px 8px; font-size:10.5px; color:var(--color-text-secondary,#9b94b3); text-align:right; line-height:22px; }
      .ta-time-hour { color:#19152d; font-weight:700; font-size:11px; }
      .ta-cell { min-height:22px; border-left:1px solid var(--color-border,#f1ecff); border-top:1px solid var(--color-border,#f6f2ff); cursor:pointer; user-select:none; touch-action:none; margin:0 2px; }
      .ta-cell:hover { background:#f6f2ff; }
      .ta-cell.on { background:#4C2A92; border-color:#4C2A92; }
      .ta-cell.on.pos-start { border-radius:8px 8px 0 0; }
      .ta-cell.on.pos-end { border-radius:0 0 8px 8px; }
      .ta-cell.on.pos-single { border-radius:8px; }
      .ta-day-ranges { margin-top:14px; border-top:1px solid var(--fs-border); padding-top:10px; }
      .ta-day-range-row { display:flex; align-items:baseline; gap:10px; padding:5px 2px; font-size:13px; }
      .ta-day-range-label { width:90px; font-weight:800; flex-shrink:0; }
      .ta-range-chip { display:inline-block; background:#f3ecff; color:#4C2A92; border-radius:999px; padding:2px 10px; margin:0 4px 4px 0; font-size:12px; font-weight:700; }
      .ta-range-empty { color:var(--fs-text-muted); }
      .ta-bottom { display:flex; justify-content:space-between; align-items:center; }
      .ta-summary { position: sticky; top: 86px; align-self:start; }
      .ta-save-btn { width:100%; background:#4C2A92; border-color:#4C2A92; color:#fff; border-radius:8px; padding:14px; font-weight:700; min-height:46px; }
      .ta-mobile-save { display:none; margin-top:12px; }
      @media (max-width: 1080px){ .availability-layout{grid-template-columns:1fr;} .ta-summary{position:static;} }
      @media (max-width: 760px){ .ta-left-grid{grid-template-columns:1fr;} .ta-mobile-save{display:block;} }
    </style>
    <section class="ta-page-head">
      <h1>My Availability</h1>
      <p>Select your available campuses and time slots</p>
    </section>

    <section class="ta-card" style="margin-bottom:12px;">
      <div class="availability-layout">
        <div>
          <div class="ta-left-grid">
            <div><label class="fs-label">Teacher</label><input class="fs-input" id="taTeacher" disabled /></div>
            <div><label class="fs-label">Email</label><input class="fs-input" id="taEmail" disabled /></div>
            <div><label class="fs-label">Batch</label><select id="batchSelect" class="fs-select"></select></div>
          </div>
          <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--fs-border);">
            <label style="display:flex;align-items:center;gap:8px;">
              <input type="checkbox" id="taOtherTeacherToggle" />
              <span class="fs-muted">Create availability for another teacher</span>
            </label>
            <div id="taOtherTeacherWrap" style="margin-top:8px;display:none;">
              <label class="fs-label">Select Teacher</label>
              <select id="taOtherTeacherSelect" class="fs-select"></select>
            </div>
          </div>
          <div class="ta-card" style="margin-top:12px;padding:16px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <strong>Campus</strong><span id="taCampusMeta" class="fs-muted"></span>
            </div>
            <div id="taDefaultCampusWrap" style="margin-top:10px;"></div>
            <details id="taMoreCampuses" style="margin-top:10px;">
              <summary class="ta-more-campuses-summary">Add other campuses</summary>
              <div style="margin-top:10px;">
                <label class="fs-label">Search Campus</label>
                <div class="ta-search-wrap"><input id="taCampusSearch" class="fs-input" placeholder="Search campus..." /></div>
                <div id="taCampusGroups" style="margin-top:8px;"></div>
              </div>
            </details>
            <div class="fs-muted" style="margin-top:8px;">You are selecting availability in your own timezone. Selected times are converted per campus timezone.</div>
          </div>
          <div class="ta-mobile-save">
            <button id="taReviewMobile" class="fs-btn ta-save-btn" disabled>Review &amp; Submit</button>
          </div>
        </div>
        <aside class="ta-card ta-summary" style="padding:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;"><strong>Availability Summary</strong><span id="taSumTotal" class="fs-muted"></span></div>
          <div id="taSummary" class="fs-muted" style="margin-top:8px;"></div>
          <button id="taReviewDesk" class="fs-btn ta-save-btn" style="margin-top:12px;" disabled>Review &amp; Submit</button>
        </aside>
      </div>
    </section>

    <section class="ta-card" style="margin-bottom:12px;">
      <div class="ta-grid-toolbar">
        <div class="ta-grid-toolbar-left"><span class="ta-icon-cal"></span><span>Click or drag to select your free time</span></div>
        <div class="ta-grid-toolbar-right">
          <span><label for="taTimezone">Time zone</label><select id="taTimezone" class="fs-select"></select></span>
          <span><label for="taSlotSize">Slot</label><select id="taSlotSize" class="fs-select">
            <option value="15">15 min</option>
            <option value="30">30 min</option>
            <option value="60">60 min</option>
          </select></span>
          <button id="taClearAll" type="button" class="fs-btn fs-btn-secondary fs-btn-sm">Clear all</button>
        </div>
      </div>
      <div class="ta-grid-note"><span class="ta-icon-clock"></span><span>Times shown in <strong id="taGridTzLabel"></strong> <span id="taGridTzNote" class="fs-muted"></span></span></div>
      <div id="taGridWrap" class="ta-grid-scroll"></div>
      <div id="taDayRanges" class="ta-day-ranges"></div>
    </section>

    <dialog id="taModal" class="fs-card" style="max-width:680px;width:92%;">
      <h3 class="fs-h3" style="margin:0 0 6px 0;">Review &amp; Submit</h3>
      <p class="fs-muted" style="margin:0 0 8px 0;">Confirm converted campus times before submitting.</p>
      <div id="taReviewBody" style="max-height:50vh;overflow:auto;"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:10px;">
        <span id="taSubmitState" class="fs-muted"></span>
        <div class="fs-row" style="gap:8px;">
          <button id="taClose" class="fs-btn fs-btn-secondary" type="button">Close</button>
          <button id="taSubmit" class="fs-btn fs-btn-primary" type="button">Confirm Submit</button>
        </div>
      </div>
    </dialog>

    <div id="taMsg" class="fs-muted" style="margin-top:10px;"></div>
  `;

  const teacherDisplay = root.querySelector("#taTeacher");
  const emailDisplay = root.querySelector("#taEmail");
  const batchSel = root.querySelector("#batchSelect");
  const tzSel = root.querySelector("#taTimezone");
  const slotSel = root.querySelector("#taSlotSize");
  const clearAllBtn = root.querySelector("#taClearAll");
  const campusSearch = root.querySelector("#taCampusSearch");
  const otherTeacherToggle = root.querySelector("#taOtherTeacherToggle");
  const otherTeacherWrap = root.querySelector("#taOtherTeacherWrap");
  const otherTeacherSelect = root.querySelector("#taOtherTeacherSelect");
  const campusMeta = root.querySelector("#taCampusMeta");
  const campusGroups = root.querySelector("#taCampusGroups");
  const defaultCampusWrap = root.querySelector("#taDefaultCampusWrap");
  const gridTzLabel = root.querySelector("#taGridTzLabel");
  const gridTzNote = root.querySelector("#taGridTzNote");
  const gridWrap = root.querySelector("#taGridWrap");
  const dayRangesEl = root.querySelector("#taDayRanges");
  const sumTotal = root.querySelector("#taSumTotal");
  const summary = root.querySelector("#taSummary");
  const reviewBtnDesk = root.querySelector("#taReviewDesk");
  const reviewBtnMobile = root.querySelector("#taReviewMobile");
  const modal = root.querySelector("#taModal");
  const reviewBody = root.querySelector("#taReviewBody");
  const submitState = root.querySelector("#taSubmitState");
  const submitBtn = root.querySelector("#taSubmit");
  const closeBtn = root.querySelector("#taClose");
  const msg = root.querySelector("#taMsg");

  teacherDisplay.value = String(state.teacherRecord?.full_name || profile.full_name || "Teacher");
  emailDisplay.value = String(profile.email || "");

  otherTeacherSelect.innerHTML =
    `<option value="">Select a teacher...</option>` +
    state.teacherOptions
      .map((t) => `<option value="${esc(t.teacher_id)}">${esc(t.full_name || t.email)} - ${esc(t.email)}</option>`)
      .join("");

  const { data: batchesRaw } = await supabase
    .from("batches")
    .select("batch_id,batch_name,start_date,end_date,active")
    .eq("active", true)
    .order("start_date", { ascending: false });
  state.batches = (batchesRaw || []).map((b) => ({
    batch_id: String(b.batch_id || "").trim(),
    batch_name: String(b.batch_name || b.batch_id || "").trim(),
    start_date: b.start_date || null,
    end_date: b.end_date || null,
    active: b.active === true,
  })).filter((b) => b.batch_id);
  batchSel.innerHTML =
    `<option value="">Select batch...</option>` +
    state.batches.map((b) => `<option value="${esc(b.batch_id)}">${esc(`${b.batch_name || b.batch_id} (${formatBatchRange(b.start_date, b.end_date)})`)}</option>`).join("");
  if (state.batches[0]) {
    state.batchId = state.batches[0].batch_id;
    batchSel.value = state.batchId;
  }

  TZ_OPTIONS.forEach((tz) => {
    const opt = document.createElement("option");
    opt.value = tz;
    opt.textContent = tz;
    tzSel.appendChild(opt);
  });
  if (!TZ_OPTIONS.includes(state.teacherTimezone)) {
    const opt = document.createElement("option");
    opt.value = state.teacherTimezone;
    opt.textContent = state.teacherTimezone;
    tzSel.appendChild(opt);
  }
  tzSel.value = state.teacherTimezone;
  slotSel.value = String(state.slotMinutes);

  function groupedCampuses() {
    const q = state.search.toLowerCase();
    const filtered = state.campuses.filter((c) => !q || c.campusName.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
    const grouped = new Map();
    const groupOrder = ["CE", "CS", "WS", "Other"];

    filtered.forEach((c) => {
      const isOther = !c.groupID || c.code.toUpperCase() === "REGIONAL";
      const g = isOther ? "Other" : c.groupID;
      const sg = c.subgroupID || "Other";
      if (!grouped.has(g)) grouped.set(g, new Map());
      const sub = grouped.get(g);
      if (!sub.has(sg)) sub.set(sg, []);
      sub.get(sg).push(c);
    });

    const ordered = [];
    groupOrder.forEach((g) => { if (grouped.has(g)) ordered.push([g, grouped.get(g)]); });
    [...grouped.entries()].forEach(([g, sub]) => { if (!groupOrder.includes(g)) ordered.push([g, sub]); });
    return { filteredCount: filtered.length, ordered };
  }

  function campusSlotCount(code) {
    if (!state.selectedCampusCodes.has(code)) return 0;
    return state.slotSet.size;
  }

  function campusPillHTML(c, isDefault) {
    const active = state.selectedCampusCodes.has(c.code);
    return `<button type="button" class="fs-btn fs-btn-secondary fs-btn-sm ta-pill ${active ? "active" : ""}" data-campus="${esc(c.code)}">${esc(c.code)}${isDefault ? ` <span class="ta-default-tag">default</span>` : ""}<span class="ta-badge">${campusSlotCount(c.code)}</span></button>`;
  }

  function bindCampusPillClick(btn) {
    btn.addEventListener("click", () => {
      const code = btn.getAttribute("data-campus");
      if (!code) return;
      if (state.selectedCampusCodes.has(code)) {
        state.selectedCampusCodes.delete(code);
        if (state.activeCampusCode === code) state.activeCampusCode = [...state.selectedCampusCodes][0] || "";
      } else {
        state.selectedCampusCodes.add(code);
        state.activeCampusCode = code;
      }
      renderAll();
    });
  }

  function renderDefaultCampus() {
    if (!state.defaultCampusCode) {
      defaultCampusWrap.innerHTML = `<span class="fs-muted">No default campus available.</span>`;
      return;
    }
    const c = state.campuses.find((x) => x.code === state.defaultCampusCode);
    if (!c) {
      defaultCampusWrap.innerHTML = "";
      return;
    }
    defaultCampusWrap.innerHTML = campusPillHTML(c, true);
    defaultCampusWrap.querySelectorAll("[data-campus]").forEach((btn) => bindCampusPillClick(btn));
  }

  function renderCampusGroups() {
    const { filteredCount, ordered } = groupedCampuses();
    campusGroups.innerHTML = ordered.map(([groupKey, subMap]) => {
      const subEntries = [...subMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      const groupCls = String(groupKey || "").toLowerCase();
      return `
        <div style="margin-bottom:10px;">
          <div class="ta-group-head ${esc(groupCls)}">${esc(groupKey)}</div>
          ${subEntries.map(([sg, campuses]) => `
            <div style="margin-top:6px;">
              <div class="ta-subgroup">${esc(sg)}${SUBGROUP_LABELS[sg] ? ` - ${esc(SUBGROUP_LABELS[sg])}` : ""}</div>
              <div class="ta-pill-wrap" style="margin-top:6px;">
                ${campuses.map((c) => campusPillHTML(c, c.code === state.defaultCampusCode)).join("")}
              </div>
            </div>
          `).join("")}
        </div>
      `;
    }).join("") || `<div class="fs-muted">No campuses match your search.</div>`;

    campusMeta.textContent = `${state.selectedCampusCodes.size} selected - Showing ${filteredCount} active fellowships`;

    campusGroups.querySelectorAll("[data-campus]").forEach((btn) => bindCampusPillClick(btn));
  }

  function computeRunPositions(day) {
    const selected = state.slotStarts.filter((m) => state.slotSet.has(slotKey(day, minutesToLabel(m))));
    const set = new Set(selected);
    const pos = {};
    selected.forEach((m) => {
      const label = minutesToLabel(m);
      const hasPrev = set.has(m - state.slotMinutes);
      const hasNext = set.has(m + state.slotMinutes);
      pos[label] = hasPrev && hasNext ? "mid" : hasPrev ? "end" : hasNext ? "start" : "single";
    });
    return pos;
  }

  function renderGrid() {
    state.slotStarts = buildSlotStarts(state.slotMinutes);
    gridTzLabel.textContent = tzDisplayLabel(state.teacherTimezone);
    const defaultCampus = state.campuses.find((c) => c.code === state.defaultCampusCode);
    if (defaultCampus) {
      gridTzNote.textContent = state.teacherTimezone === defaultCampus.timezone
        ? `— same as ${defaultCampus.code} time.`
        : `— will be converted for ${defaultCampus.code}.`;
    } else {
      gridTzNote.textContent = "";
    }

    if (!state.activeCampusCode) {
      gridWrap.innerHTML = `<div class="fs-muted" style="padding:8px;">Select at least one campus.</div>`;
      return;
    }

    const posMaps = {};
    DISPLAY_DAYS.forEach((day) => { posMaps[day] = computeRunPositions(day); });

    let html = `<div class="ta-days"><div></div>${DISPLAY_DAYS.map((d) => `<div>${esc(d.slice(0, 3))}</div>`).join("")}</div>`;
    state.slotStarts.forEach((startMin) => {
      const label = minutesToLabel(startMin);
      const isHour = startMin % 60 === 0;
      html += `<div class="ta-row">`;
      html += `<div class="ta-time ${isHour ? "ta-time-hour" : ""}">${esc(label)}</div>`;
      DISPLAY_DAYS.forEach((day) => {
        const key = slotKey(day, label);
        const on = state.slotSet.has(key);
        const pos = on ? posMaps[day][label] : "";
        html += `<div class="ta-cell ${on ? "on" : ""} ${pos ? "pos-" + pos : ""}" data-day="${esc(day)}" data-label="${esc(label)}"></div>`;
      });
      html += `</div>`;
    });
    gridWrap.innerHTML = html;
  }

  let dragState = null;
  function startDrag(day, minuteStart) {
    const key = slotKey(day, minutesToLabel(minuteStart));
    const mode = state.slotSet.has(key) ? "remove" : "add";
    dragState = { day, anchorMin: minuteStart, mode, baseline: new Set(state.slotSet) };
    applyDrag(minuteStart);
  }
  function applyDrag(currentMin) {
    if (!dragState) return;
    const { day, anchorMin, mode, baseline } = dragState;
    const lo = Math.min(anchorMin, currentMin);
    const hi = Math.max(anchorMin, currentMin);
    const next = new Set(baseline);
    for (let m = lo; m <= hi; m += state.slotMinutes) {
      const key = slotKey(day, minutesToLabel(m));
      if (mode === "add") next.add(key); else next.delete(key);
    }
    state.slotSet = next;
    renderGrid();
  }
  function endDrag() {
    if (!dragState) return;
    dragState = null;
    renderAll();
  }

  gridWrap.addEventListener("pointerdown", (e) => {
    const cell = e.target.closest(".ta-cell");
    if (!cell) return;
    e.preventDefault();
    const day = cell.getAttribute("data-day");
    const label = cell.getAttribute("data-label");
    const t = parseTime12h(label);
    if (!day || !t) return;
    startDrag(day, t.h * 60 + t.mi);
    try { gridWrap.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  gridWrap.addEventListener("pointermove", (e) => {
    if (!dragState) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el && el.closest ? el.closest(".ta-cell") : null;
    if (!cell || cell.getAttribute("data-day") !== dragState.day) return;
    const t = parseTime12h(cell.getAttribute("data-label"));
    if (!t) return;
    applyDrag(t.h * 60 + t.mi);
  });
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);

  function computeDayRangeTexts() {
    const out = {};
    DISPLAY_DAYS.forEach((day) => {
      const selected = state.slotStarts
        .filter((m) => state.slotSet.has(slotKey(day, minutesToLabel(m))))
        .sort((a, b) => a - b);
      const runs = [];
      let runStart = null;
      let prevM = null;
      selected.forEach((m) => {
        if (runStart === null) { runStart = m; prevM = m; return; }
        if (m === prevM + state.slotMinutes) { prevM = m; return; }
        runs.push([runStart, prevM]);
        runStart = m; prevM = m;
      });
      if (runStart !== null) runs.push([runStart, prevM]);
      out[day] = runs.map(([s, e]) => `${minutesToLabel(s)} – ${minutesToLabel(e + state.slotMinutes)}`);
    });
    return out;
  }

  function renderDayRanges() {
    const ranges = computeDayRangeTexts();
    dayRangesEl.innerHTML = DISPLAY_DAYS.map((day) => {
      const items = ranges[day] || [];
      const valuesHtml = items.length
        ? items.map((r) => `<span class="ta-range-chip">${esc(r)}</span>`).join("")
        : `<span class="ta-range-empty">—</span>`;
      return `<div class="ta-day-range-row"><span class="ta-day-range-label">${esc(day)}</span><span class="ta-day-range-values">${valuesHtml}</span></div>`;
    }).join("");
  }

  function convertedCampusSlots(campus) {
    const batch = selectedBatch(state);
    const start = batch?.start_date ? new Date(batch.start_date) : new Date();
    const month = { year: start.getFullYear(), monthIndex: start.getMonth() + 1 };
    return [...state.slotSet].map((k) => {
      const s = splitKey(k);
      const conv = convertTeacherSlotToCampus({ day: s.day, time: s.time }, state.teacherTimezone, campus.timezone, month);
      return { teacherDay: s.day, teacherTime: s.time, campusDay: conv.campusDay, campusTime: conv.campusTime };
    });
  }

  function renderSummary() {
    const selected = state.campuses.filter((c) => state.selectedCampusCodes.has(c.code));
    sumTotal.textContent = `${state.slotSet.size} teacher-time slots`;
    summary.innerHTML = `<div class="fs-muted" style="margin-bottom:8px;"><strong>Teacher Timezone:</strong> ${esc(state.teacherTimezone)}</div>` +
      (selected.map((c) => {
        const items = convertedCampusSlots(c);
        return `<div style="margin-bottom:8px;"><strong>${esc(c.code)}</strong> <span class="fs-muted">${esc(c.campusName)} - ${esc(c.timezone)}</span><div style="margin-top:4px;">${items.map((it) => `<span class="fs-btn fs-btn-secondary fs-btn-sm" style="padding:2px 8px;font-size:11px;">${esc(it.campusDay.slice(0, 3))} ${esc(it.campusTime)}</span>`).join(" ") || `<span class="fs-muted">No slots</span>`}</div></div>`;
      }).join("")) || `<span class="fs-muted">No campuses selected.</span>`;
  }

  function buildPayload() {
    const slots = [...state.slotSet].map((k) => {
      const s = splitKey(k);
      return {
        teacherDay: s.day,
        teacherTime: s.time,
        selectedCampusCodes: [...state.selectedCampusCodes],
      };
    });

    const activeTeacher = state.submitForAnother
      ? state.selectedTeacherRecord
      : (state.teacherRecord || {
        teacher_id: "",
        full_name: String(state.profile?.full_name || ""),
        email: String(state.profile?.email || ""),
      });

    return slots.map((s) => ({
      teacherID: String(activeTeacher?.teacher_id || ""),
      teacherName: String(activeTeacher?.full_name || state.profile?.full_name || ""),
      teacherEmail: String(activeTeacher?.email || state.profile?.email || ""),
      teacherTimezone: state.teacherTimezone,
      selectedCampusCodes: s.selectedCampusCodes,
      teacherDay: s.teacherDay,
      teacherTime: s.teacherTime,
      dbTimeSlot: to24h(s.teacherTime),
      batch_id: state.batchId || null,
    }));
  }

  function renderReview() {
    const activeTeacher = state.submitForAnother
      ? state.selectedTeacherRecord
      : (state.teacherRecord || { full_name: state.profile?.full_name, email: state.profile?.email });
    const byCampus = {};
    const payload = buildPayload();
    payload.forEach((p) => {
      (p.selectedCampusCodes || []).forEach((code) => {
        const campus = state.campuses.find((c) => c.code === code);
        if (!campus) return;
        const batch = selectedBatch(state);
        const start = batch?.start_date ? new Date(batch.start_date) : new Date();
        const month = { year: start.getFullYear(), monthIndex: start.getMonth() + 1 };
        const conv = convertTeacherSlotToCampus({ day: p.teacherDay, time: p.teacherTime }, state.teacherTimezone, campus.timezone, month);
        if (!byCampus[code]) byCampus[code] = { campusName: campus.campusName, timezone: campus.timezone, items: [] };
        byCampus[code].items.push(`${conv.campusDay.slice(0, 3)} ${conv.campusTime}`);
      });
    });

    reviewBody.innerHTML = `<div class="fs-muted" style="margin-bottom:8px;"><strong>Name:</strong> ${esc(activeTeacher?.full_name || "-")}<br><strong>Email:</strong> ${esc(activeTeacher?.email || "-")}<br><strong>Teacher Timezone:</strong> ${esc(state.teacherTimezone)}</div>` +
      Object.keys(byCampus).map((code) => {
        const d = byCampus[code];
        return `<div style="margin-bottom:8px;"><strong>${esc(code)} - ${esc(d.campusName)}</strong> <span class="fs-muted">(${esc(d.timezone)})</span><div style="margin-top:4px;">${d.items.map((i) => `<span class="fs-btn fs-btn-secondary fs-btn-sm" style="padding:2px 8px;font-size:11px;">${esc(i)}</span>`).join(" ")}</div></div>`;
      }).join("");
  }

  function setMsg(text, kind) {
    msg.className = kind ? `fs-banner fs-banner-${kind}` : "fs-muted";
    msg.textContent = text || "";
  }

  async function submitNow() {
    const payload = buildPayload();
    if (!payload.length) return;
    state.submitting = true;
    submitBtn.disabled = true;
    submitState.textContent = "Submitting...";
    try {
      const res = await submitAvailability(payload);
      setMsg(`Availability submitted. ${JSON.stringify(res)}`, "success");
      modal.close();
    } catch (e) {
      setMsg(`Submission failed: ${String(e?.message || e)}`, "danger");
    } finally {
      state.submitting = false;
      submitBtn.disabled = false;
      submitState.textContent = "";
    }
  }

  function renderFooter() {
    const hasTeacher = state.submitForAnother ? !!state.selectedTeacherRecord?.teacher_id : true;
    const disabled = !(hasTeacher && state.teacherTimezone && state.slotSet.size > 0 && state.selectedCampusCodes.size > 0);
    if (reviewBtnDesk) reviewBtnDesk.disabled = disabled;
    if (reviewBtnMobile) reviewBtnMobile.disabled = disabled;
  }

  function renderAll() {
    renderDefaultCampus();
    renderCampusGroups();
    renderGrid();
    renderDayRanges();
    renderSummary();
    renderFooter();
  }

  campusSearch.addEventListener("input", (e) => {
    state.search = String(e.target.value || "");
    renderCampusGroups();
  });
  batchSel.addEventListener("change", () => {
    state.batchId = batchSel.value;
    renderSummary();
  });
  tzSel.addEventListener("change", () => {
    state.teacherTimezone = tzSel.value;
    renderAll();
  });
  slotSel.addEventListener("change", () => {
    state.slotMinutes = Number(slotSel.value) || 30;
    state.slotSet = new Set();
    renderAll();
  });
  clearAllBtn.addEventListener("click", () => {
    state.slotSet = new Set();
    renderAll();
  });
  otherTeacherToggle.addEventListener("change", () => {
    state.submitForAnother = !!otherTeacherToggle.checked;
    otherTeacherWrap.style.display = state.submitForAnother ? "" : "none";
    if (!state.submitForAnother) {
      state.selectedTeacherRecord = state.teacherRecord || null;
      teacherDisplay.value = String(state.teacherRecord?.full_name || state.profile?.full_name || "Teacher");
      emailDisplay.value = String(state.profile?.email || "");
    }
    renderFooter();
  });
  otherTeacherSelect.addEventListener("change", () => {
    const tid = String(otherTeacherSelect.value || "").trim();
    state.selectedTeacherRecord = state.teacherOptions.find((t) => t.teacher_id === tid) || null;
    if (state.selectedTeacherRecord) {
      teacherDisplay.value = String(state.selectedTeacherRecord.full_name || "Teacher");
      emailDisplay.value = String(state.selectedTeacherRecord.email || "");
      if (state.selectedTeacherRecord.subgroup_id) {
        const preferred = state.campuses.find((c) => c.subgroupID === state.selectedTeacherRecord.subgroup_id);
        if (preferred) {
          state.teacherTimezone = preferred.timezone || state.teacherTimezone;
          tzSel.value = state.teacherTimezone;
        }
      }
    }
    renderAll();
  });

  function openReviewModal() {
    if ((reviewBtnDesk && reviewBtnDesk.disabled) && (reviewBtnMobile && reviewBtnMobile.disabled)) return;
    renderReview();
    modal.showModal();
  }
  reviewBtnDesk?.addEventListener("click", openReviewModal);
  reviewBtnMobile?.addEventListener("click", openReviewModal);
  closeBtn.addEventListener("click", () => modal.close());
  submitBtn.addEventListener("click", submitNow);

  renderAll();
}
