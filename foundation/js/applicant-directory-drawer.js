(function (global) {
  const Drawer = (global.FSApplicantDirectoryDrawer = global.FSApplicantDirectoryDrawer || {});

  function setKv(containerId, fields) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.replaceChildren(
      ...fields.map(({ label, value }) => {
        const div = document.createElement("div");
        const l = document.createElement("label");
        l.textContent = label;
        const strong = document.createElement("strong");
        strong.textContent = value;
        div.appendChild(l);
        div.appendChild(strong);
        return div;
      })
    );
  }

  function listRows(ctx, items, renderLabel) {
    const { esc, fmt } = ctx;
    if (!items.length) return `<div class="row muted">No records yet.</div>`;
    return items.map((item) => `<div class="row"><span>${renderLabel(item)}</span><span class="muted">${esc(fmt(item.created_at || item.updated_at || item.timestamp || item.scheduled_for || item.date))}</span></div>`).join("");
  }

  Drawer.renderDrawerContent = function renderDrawerContent(ctx, applicantId) {
    const { state, $, esc, milestoneKeys, milestoneLabels, getApplicantMilestones, getClassInfo, getAttendanceSummary, getNotificationRows, getAttendanceStatusCounts, attendanceStatusBadge, displayGroupValue, displaySubgroupValue, getDuplicateGroup, getGroupDuplicates, getDuplicateNotificationsForGroup, buildDuplicateApplicantDetails, getDuplicateGroupStatus } = ctx;
    const app = state.applicants.find((a) => String(a.id) === String(applicantId));
    if (!app) return null;
    state.selectedApplicantId = String(app.id);
    state.latestViewedApplicantId = String(app.id);
    const cls = getClassInfo(app.class_option_id);
    const attendance = getAttendanceSummary(app);
    const statusCounts = getAttendanceStatusCounts(app);
    const moodleStatus = state.moodle.find((m) => String(m.applicant_id || m.student_id || "") === String(app.id))?.status || "Unknown";
    $("drawerName").textContent = app.full_name || "Student";
    $("drawerSub").textContent = `${app.email || "-"} · ${app.phone || app.phone_number || "-"}`;
    setKv("overviewKv", [
      { label: "Fellowship", value: app.fellowship_code || app.fellowship || app.subgroup_id || "-" },
      { label: "Group / Subgroup", value: `${displayGroupValue(app)} / ${displaySubgroupValue(app)}` },
      { label: "Assigned Class", value: app.class_option_id || "-" },
      { label: "Teacher", value: cls?.teacher_name || cls?.teacher_id || "-" },
      { label: "Batch", value: app.batch_id || cls?.batch_id || "-" },
      { label: "Moodle Sync", value: moodleStatus },
      { label: "ClickUp Task", value: app.clickup_task_url || app.clickup_url || "Not linked" },
    ]);
    const applicantMilestones = new Set(getApplicantMilestones(app));
    const labels = milestoneLabels();
    $("milestoneChips").innerHTML = milestoneKeys().map((k) => `<span class="fs-badge fs-badge-primary" style="opacity:${applicantMilestones.has(k) ? 1 : .45}">${esc(labels[k] || k)}</span>`).join("");
    setKv("attendanceKv", [
      { label: "Attendance %", value: attendance.pct == null ? "-" : `${attendance.pct}%` },
      { label: "Sessions Attended", value: `${attendance.attended}/${attendance.total}` },
      { label: "Last Attendance", value: ctx.fmt(attendance.last) },
      { label: "Missing Sessions", value: String(attendance.missing) },
    ]);
    $("attendanceKv").insertAdjacentHTML("beforeend", `<div style="grid-column:1/-1"><label>Attendance Session Status</label><div class="chips" style="margin-top:6px">${[attendanceStatusBadge("Submitted", "completed", statusCounts.SUBMITTED), attendanceStatusBadge("Late Start", "unassigned", statusCounts.LATE_START), attendanceStatusBadge("Missing", "duplicate", statusCounts.MISSING)].filter(Boolean).join("") || '<span class="muted">No attendance status rows yet.</span>'}</div></div>`);
    const duplicateGroup = getDuplicateGroup ? getDuplicateGroup(app) : null;
    const duplicateSection = $("duplicateSection");
    if (duplicateGroup && duplicateSection) {
      const details = buildDuplicateApplicantDetails ? buildDuplicateApplicantDetails(duplicateGroup) : [];
      const groupMembers = getGroupDuplicates ? getGroupDuplicates(app) : [];
      const groupNotifications = getDuplicateNotificationsForGroup ? getDuplicateNotificationsForGroup(duplicateGroup.id) : [];
      duplicateSection.style.display = "";
      $("duplicateKv").innerHTML = `<div><label>Applicant status</label><strong>${esc(String(app.duplicate_status || "UNIQUE").toUpperCase())}</strong></div><div><label>Group status</label><strong>${esc(getDuplicateGroupStatus ? getDuplicateGroupStatus(duplicateGroup) : duplicateGroup.status || "-")}</strong></div><div><label>Group count</label><strong>${esc(String(duplicateGroup.duplicate_count || groupMembers.length || 0))}</strong></div><div><label>Notification state</label><strong>${esc(groupNotifications[0]?.notification_status || "none")}</strong></div>`;
      $("duplicateGroupMembers").innerHTML = details.length
        ? details.map((member) => `<div class="row"><span>${esc(member.name || member.email || "Unknown")} · ${esc(member.subgroup || "—")}</span><span class="muted">${esc(ctx.fmt(member.created_at))}</span></div>`).join("")
        : `<div class="row muted">No duplicate group members available.</div>`;
    } else if (duplicateSection) {
      duplicateSection.style.display = "none";
      $("duplicateKv").innerHTML = "";
      $("duplicateGroupMembers").innerHTML = "";
    }
    const notifRows = getNotificationRows(app).slice(0, 40);
    $("notificationHistory").innerHTML = listRows(ctx, notifRows, (n) => `${esc(String(n.status || n.event_status || n.provider_status || "PENDING").toUpperCase())} · ${esc(n.event_type || "EVENT")}`);
    const emailRows = state.emails.filter((e) => {
      const aid = String(e.applicant_id || e.student_id || "");
      const aemail = String(e.recipient_email || e.email || "").toLowerCase();
      return (aid && aid === String(app.id)) || (aemail && aemail === String(app.email || "").toLowerCase());
    }).slice(0, 40);
    $("emailHistory").innerHTML = listRows(ctx, emailRows, (e) => `${esc(e.subject || e.template_key || "Email")} · ${esc(String(e.status || "PENDING").toUpperCase())}`);
    const auditRows = state.audits.filter((a) => String(a.entity_id || "") === String(app.id) || String((a.details || {}).applicant_id || "") === String(app.id)).slice(0, 50);
    $("auditHistory").innerHTML = listRows(ctx, auditRows, (a) => `${esc(a.action || "ADMIN_ACTION")} · ${esc(a.actor_email || "staff")}`);
    $("openClickupBtn").disabled = !(app.clickup_task_url || app.clickup_url);
    return app;
  };

  Drawer.openDrawer = function openDrawer(ctx, applicantId) {
    const app = Drawer.renderDrawerContent(ctx, applicantId);
    if (!app) return;
    ctx.$("detailDrawer").classList.add("open");
    ctx.$("drawerOverlay").classList.add("open");
    ctx.$("detailDrawer").setAttribute("aria-hidden", "false");
  };

  Drawer.closeDrawer = function closeDrawer(ctx) {
    ctx.$("detailDrawer").classList.remove("open");
    ctx.$("detailDrawer").setAttribute("aria-hidden", "true");
    if (!ctx.$("classCorrectionModal").classList.contains("open")) ctx.$("drawerOverlay").classList.remove("open");
  };
})(window);

