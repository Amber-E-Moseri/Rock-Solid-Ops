(function (global) {
  const Filters = (global.FSApplicantDirectoryFilters = global.FSApplicantDirectoryFilters || {});

  Filters.renderFilters = function renderFilters(ctx) {
    const { state, $, esc, milestoneLabels, classIdOf } = ctx;
    const fellowships = [...new Set(state.applicants.map((a) => a.fellowship_code || a.fellowship || a.subgroup_id).filter(Boolean))].sort();
    $("fellowshipFilter").innerHTML = `<option value="">All Fellowships</option>${fellowships.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("")}`;
    
    // NEW: Add subgroup filter
    const subgroups = [...new Set(state.applicants.map((a) => a.subgroup_id).filter(Boolean))].sort();
    const subgroupSelect = $("subgroupFilter");
    if (subgroupSelect) {
      subgroupSelect.innerHTML = `<option value="">All Subgroups</option>${subgroups.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("")}`;
    }
    
    const classes = state.classOptions.map((c) => classIdOf(c)).filter(Boolean).sort((a, b) => a.localeCompare(b));
    $("classFilter").innerHTML = `<option value="">All Classes</option>${classes.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("")}`;
    const batches = [...new Set(state.applicants.map((a) => a.batch_id).concat(state.classOptions.map((c) => c.batch_id)).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
    $("batchFilter").innerHTML = `<option value="">All Batches</option>${batches.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("")}`;
    const labels = milestoneLabels();
    $("milestoneFilter").innerHTML = `<option value="">All Milestones</option>${Object.entries(labels).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join("")}`;
    $("statusFilter").innerHTML = `<option value="">All Status</option><option value="assigned">Assigned</option><option value="unassigned">Unassigned</option><option value="attention">Needs Attention</option><option value="duplicate">Duplicate</option><option value="completed">Completed</option>`;
  };

  Filters.applyFilters = function applyFilters(ctx) {
    const { state, ymd, getClassInfo, summarizeApplicant, classifyRowStatus, getAttendanceSummary, getApplicantMilestones } = ctx;
    const f = state.filters;
    return state.applicants.filter((app) => {
      // Quick tab pre-filter
      const qt = state.quickTab || "all";
      if (qt === "needs_review" && !app.needs_admin_review) return false;
      if (qt === "at_risk") {
        const att = getAttendanceSummary(app);
        if (att.pct == null || att.pct >= 75) return false;
      }
      if (qt === "waitlisted") {
        const regStatus = String(app.registration_status || app.status || "").toUpperCase();
        if (regStatus !== "WAITLISTED") return false;
      }

      if (state.mode === "review") {
        const regStatus = String(app.registration_status || app.status || "").toUpperCase();
        const needsReview = Boolean(app.needs_admin_review || app.retry_assignment || app.review_required);
        const inQueue = regStatus === "REVIEW" || regStatus === "PENDING" || needsReview || (!app.class_option_id && regStatus !== "DUPLICATE" && regStatus !== "INACTIVE");
        if (!inQueue) return false;
      }
      const summary = summarizeApplicant(app);
      const fellowship = String(app.fellowship_code || app.fellowship || app.subgroup_id || "");
      const batch = String(app.batch_id || getClassInfo(app.class_option_id)?.batch_id || "");
      const q = f.search.trim().toLowerCase();
      if (q) {
        const pool = [app.full_name, app.email, app.phone, app.phone_number].map((v) => String(v || "").toLowerCase()).join(" ");
        if (!pool.includes(q)) return false;
      }
      if (f.fellowship && fellowship !== f.fellowship) return false;
      // NEW: Add subgroup filter support
      if (f.subgroup && String(app.subgroup_id || "") !== String(f.subgroup)) return false;
      if (f.classOption && String(app.class_option_id || "") !== String(f.classOption)) return false;
      if (f.batch && batch !== String(f.batch)) return false;
      if (f.assignment === "assigned" && !app.class_option_id) return false;
      if (f.assignment === "unassigned" && app.class_option_id) return false;
      // NEW: Handle duplicate filter
      const duplicateStatus = String(app.duplicate_status || "UNIQUE").toUpperCase();
      const duplicateGroup = ctx.getDuplicateGroup ? ctx.getDuplicateGroup(app) : null;
      const duplicateGroupStatus = ctx.getDuplicateGroupStatus ? ctx.getDuplicateGroupStatus(duplicateGroup) : "";
      if (f.duplicate === "duplicate_only" && duplicateStatus === "UNIQUE" && !app.duplicate_group_id) return false;
      if (f.duplicate === "unresolved_only" && !(duplicateStatus === "CONFIRMED" && duplicateGroupStatus !== "resolved")) return false;
      if (f.duplicate === "unassigned_only" && app.class_option_id) return false;
      if (f.notif && summary.notificationState !== f.notif) return false;
      if (f.milestone) {
        const ms = getApplicantMilestones(app);
        if (!ms.includes(String(f.milestone || "").toUpperCase())) return false;
      }
      if (f.attendance === "high" && (summary.attendancePct == null || summary.attendancePct < 75)) return false;
      if (f.attendance === "low" && (summary.attendancePct == null || summary.attendancePct >= 75)) return false;
      if (f.attendance === "none" && summary.attendancePct != null) return false;
      if (f.status && classifyRowStatus(app, summary).cls !== f.status) return false;
      if (f.date && ymd(app.created_at) !== f.date) return false;
      const af = state.advFilters;
      if (af.active) {
        if (af.dateFrom && ymd(app.created_at) < af.dateFrom) return false;
        if (af.dateTo && ymd(app.created_at) > af.dateTo) return false;
        if (af.moodle) {
          const mr = state.moodle.find((m) => String(m.applicant_id || m.student_id || "") === String(app.id) || String(m.email || "").toLowerCase() === String(app.email || "").toLowerCase());
          if (af.moodle === "yes" && !mr) return false;
          if (af.moodle === "no" && mr) return false;
          if (af.moodle === "synced" && (!mr || String(mr.sync_status || "").toUpperCase() !== "SYNCED")) return false;
          if (af.moodle === "failed" && (!mr || String(mr.sync_status || "").toUpperCase() !== "FAILED")) return false;
        }
        if (af.attStatus) {
          const att = getAttendanceSummary(app);
          if (af.attStatus === "never" && att.total > 0) return false;
          if (af.attStatus === "active" && (att.pct == null || att.pct < 75)) return false;
          if (af.attStatus === "atrisk" && (att.pct == null || att.pct >= 75)) return false;
        }
      }
      return true;
    });
  };

  Filters.updateBadge = function updateBadge(ctx) {
    const { state, $ } = ctx;
    const af = state.advFilters;
    const count = [af.dateFrom, af.dateTo, af.moodle, af.attStatus].filter(Boolean).length;
    const badge = $("advFilterBadge");
    if (!badge) return;
    badge.style.display = count ? "inline" : "none";
    badge.textContent = String(count);
  };

  Filters.bind = function bind(ctx, renderAll) {
    const { state, $ } = ctx;
    const map = [
      ["globalSearch", "search", "input"], ["quickAssignment", "assignment", "change"], ["quickNotif", "notif", "change"],
      ["fellowshipFilter", "fellowship", "change"], ["subgroupFilter", "subgroup", "change"], ["classFilter", "classOption", "change"], ["batchFilter", "batch", "change"],
      ["milestoneFilter", "milestone", "change"], ["attendanceFilter", "attendance", "change"], ["statusFilter", "status", "change"], ["duplicateFilter", "duplicate", "change"], ["dateFilter", "date", "change"],
    ];
    // Debounce text input so a full re-render doesn't run on every keystroke.
    let searchTimer = null;
    const debouncedRenderAll = () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderAll, 150); };
    map.forEach(([id, key, ev]) => $(id)?.addEventListener(ev, (e) => { state.filters[key] = e.target.value; (ev === "input" ? debouncedRenderAll : renderAll)(); }));
    $("clearFilters").addEventListener("click", () => {
      Object.keys(state.filters).forEach((k) => { state.filters[k] = ""; });
      map.forEach(([id]) => { $(id).value = ""; });
      renderAll();
    });
    $("toggleAdvFilters").addEventListener("click", () => {
      const panel = $("advFilterPanel");
      panel.style.display = panel.style.display === "none" || !panel.style.display ? "" : "none";
    });
    $("afApplyBtn").addEventListener("click", () => {
      state.advFilters = { dateFrom: $("afDateFrom").value, dateTo: $("afDateTo").value, moodle: $("afMoodle").value, attStatus: $("afAttStatus").value, active: true };
      Filters.updateBadge(ctx);
      renderAll();
    });
    $("afResetBtn").addEventListener("click", () => {
      state.advFilters = { dateFrom: "", dateTo: "", moodle: "", attStatus: "", active: false };
      ["afDateFrom", "afDateTo", "afMoodle", "afAttStatus"].forEach((id) => { $(id).value = ""; });
      Filters.updateBadge(ctx);
      renderAll();
    });
  };
})(window);
