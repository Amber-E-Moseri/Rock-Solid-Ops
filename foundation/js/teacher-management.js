(function teacherManagementPage(global) {
  const FSAdminUi  = global.FSAdminUi;
  const FSAdminApi = global.FSAdminApi;

  if (!FSAdminUi || !FSAdminApi) {
    console.error("Missing shared admin modules.");
    return;
  }

  const statusTabs = ["PENDING", "ACTIVE", "SUSPENDED", "INACTIVE", "ALL"];

  const state = {
    profile: null,
    teachers: [],
    filtered: [],
    classMap: new Map(), // teacher_id → class_option_id
    activeTab: "ALL",
    loading: false,
    linkTargetTeacherId: null,
    unlinkTargetTeacherId: null,
  };

  const $ = (id) => document.getElementById(id);
  const isSuperAdmin  = () => String(state.profile?.role || "").toLowerCase() === "superadmin";
  const isAdmin       = () => ["admin", "superadmin"].includes(String(state.profile?.role || "").toLowerCase());
  const isRegionalSecretary = () => String(state.profile?.role || "").toLowerCase() === "regional_secretary";
  const isOperationalRole = () => isAdmin() || isRegionalSecretary();

  const isMissingTable = (error) => {
    const msg = String(error?.message || "").toLowerCase();
    return error?.code === "42P01" || msg.includes("does not exist") || msg.includes("relation");
  };

  const esc     = (s) => FSAdminUi.esc(s);
  const fmtDate = (v) => FSAdminUi.fmtDate(v);

  const notify = (message, type = "info") => {
    if (global.FSToast?.show) { global.FSToast.show(message, type); return; }
    if (typeof FSAdminUi.toast === "function") { FSAdminUi.toast(message, type); return; }
    console[type === "error" ? "error" : "log"](message);
  };

  function assertRpcOk(result, fallback = "Operation failed") {
    if (result?.error) throw result.error;
    if (result?.data && typeof result.data === "object" && result.data.ok === false) {
      throw new Error(String(result.data.error || fallback));
    }
    return result?.data || null;
  }

  // ── Status chip ────────────────────────────────────────────────────────────
  function statusChip(status) {
    const n = FSAdminApi.normalizeTeacherStatus(status, false).toLowerCase();
    return `<span class="chip ${n}">${n.toUpperCase()}</span>`;
  }

  // ── State helpers ──────────────────────────────────────────────────────────
  function setState(message) {
    const el = $("state");
    el.textContent = message;
    el.classList.remove("hidden");
    $("tableWrap").classList.add("hidden");
    $("mobileCards").classList.add("hidden");
  }

  function showData() {
    $("state").classList.add("hidden");
    $("tableWrap").classList.remove("hidden");
    $("mobileCards").classList.remove("hidden");
  }

  // ── Reason modal ───────────────────────────────────────────────────────────
  // Returns a promise that resolves to the entered reason string, or null if cancelled.
  function askReason({ title, description, minLength = 10 }) {
    return new Promise((resolve) => {
      const overlay   = $("actionReasonModal");
      const titleEl   = $("actionReasonTitle");
      const descEl    = $("actionReasonDesc");
      const input     = $("actionReasonInput");
      const errorEl   = $("actionReasonError");
      const confirmBtn = $("actionReasonConfirmBtn");
      const cancelBtn  = $("actionReasonCancelBtn");

      titleEl.textContent = title;
      descEl.textContent  = description || "";
      input.value         = "";
      errorEl.textContent = "";
      overlay.classList.add("open");
      input.focus();

      const cleanup = () => {
        overlay.classList.remove("open");
        confirmBtn.replaceWith(confirmBtn.cloneNode(true));
        cancelBtn.replaceWith(cancelBtn.cloneNode(true));
      };

      $("actionReasonConfirmBtn").addEventListener("click", () => {
        const val = String(input.value || "").trim();
        if (val.length < minLength) {
          $("actionReasonError").textContent = `Reason must be at least ${minLength} characters.`;
          return;
        }
        cleanup();
        resolve(val);
      });

      $("actionReasonCancelBtn").addEventListener("click", () => {
        cleanup();
        resolve(null);
      });

      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) { cleanup(); resolve(null); }
      }, { once: true });
    });
  }

  // ── Tabs ───────────────────────────────────────────────────────────────────
  function renderTabs() {
    $("statusTabs").replaceChildren(
      ...statusTabs.map((s) => {
        const btn = document.createElement("button");
        btn.className = `tab${state.activeTab === s ? " active" : ""}`;
        btn.dataset.status = s;
        btn.textContent = s;
        return btn;
      })
    );
  }

  // ── Action buttons (role-aware) ────────────────────────────────────────────
  function actionButtons(row) {
    const normalized = FSAdminApi.normalizeTeacherStatus(row.status, row.active);
    const id       = esc(row.teacher_id);
    const emailEsc = esc(row.email || "");
    const linked = Boolean(row.teacher_user_id);
    const allowAuthLinking = isAdmin();
    const linkBtn  = allowAuthLinking
      ? `<button class="btn" data-action="linkauth" data-id="${id}" data-email="${emailEsc}" title="Link auth account">${linked ? "Relink Auth" : "Link Auth"}</button>`
      : "";
    const unlinkBtn = allowAuthLinking && linked
      ? `<button class="btn danger" data-action="unlinkauth" data-id="${id}" title="Unlink auth account">Unlink Auth</button>`
      : "";
    const emailBtn = `<button class="btn" data-action="email" data-id="${id}">Email</button>`;

    if (normalized === "PENDING") {
      if (!isAdmin()) return `<div class="actions">${emailBtn}${linkBtn}${unlinkBtn}</div>`;
      return `<div class="actions">
        <button class="btn success" data-action="activate"   data-id="${id}">Approve</button>
        <button class="btn danger"  data-action="reject"     data-id="${id}">Reject</button>
        ${emailBtn}
        ${linkBtn}
        ${unlinkBtn}
      </div>`;
    }

    if (normalized === "ACTIVE") {
      const suspendBtn = isAdmin()
        ? `<button class="btn" data-action="suspend" data-id="${id}">Suspend</button>`
        : "";
      const inactivateBtn = isAdmin()
        ? `<button class="btn danger" data-action="inactivate" data-id="${id}">Inactivate</button>`
        : "";
      return `<div class="actions">${suspendBtn}${inactivateBtn}${emailBtn}${linkBtn}${unlinkBtn}</div>`;
    }

    if (normalized === "SUSPENDED") {
      const activateBtn = isAdmin()
        ? `<button class="btn success" data-action="unsuspend" data-id="${id}">Activate</button>`
        : "";
      const inactivateBtn = isAdmin()
        ? `<button class="btn danger" data-action="inactivate" data-id="${id}">Inactivate</button>`
        : "";
      return `<div class="actions">${activateBtn}${inactivateBtn}${emailBtn}${linkBtn}${unlinkBtn}</div>`;
    }

    if (normalized === "INACTIVE") {
      const activateBtn = isAdmin()
        ? `<button class="btn success" data-action="activate" data-id="${id}">Activate</button>`
        : "";
      const suspendBtn = isAdmin()
        ? `<button class="btn" data-action="suspend" data-id="${id}">Suspend</button>`
        : "";
      return `<div class="actions">${activateBtn}${suspendBtn}${emailBtn}${linkBtn}${unlinkBtn}</div>`;
    }

    return `<div class="actions">${emailBtn}${linkBtn}${unlinkBtn}</div>`;
  }

  async function openLinkAuthModal(teacherId) {
    const row = state.teachers.find((t) => String(t.teacher_id) === String(teacherId));
    if (!row) return;
    state.linkTargetTeacherId = String(row.teacher_id);
    $("linkTeacherIdInput").value = String(row.teacher_id || "");
    $("linkTeacherEmailInput").value = String(row.email || "");
    $("linkAuthUserIdInput").value = "";
    $("allowRelinkInput").checked = false;
    global.FSModal?.open?.($("linkAuthModal"));
  }

  async function submitLinkAuthModal() {
    const teacherId = String(state.linkTargetTeacherId || "").trim();
    const authUserId = String($("linkAuthUserIdInput")?.value || "").trim();
    const allowRelink = $("allowRelinkInput")?.checked === true;
    if (!teacherId) { notify("Teacher ID is missing.", "error"); return; }
    if (!authUserId) { notify("Auth user id is required.", "error"); return; }
    const btn = $("confirmLinkAuthBtn");
    const prevLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Linking...";
    try {
      const rpcRes = await global.supabase.rpc("link_teacher_to_auth_user", {
        p_teacher_id: teacherId,
        p_auth_user_id: authUserId,
        p_actor_email: state.profile?.email || null,
        p_allow_relink: allowRelink,
      });
      const data = assertRpcOk(rpcRes, "Link request failed.");
      notify(data?.previous_teacher_user_id ? "Teacher auth link updated safely." : "Teacher auth link created.", "success");
      global.FSModal?.close?.($("linkAuthModal"));
      await loadTeachers();
    } catch (err) {
      notify(FSAdminApi.normalizeError(err), "error");
    } finally {
      btn.disabled = false;
      btn.textContent = prevLabel || "Link Auth User";
    }
  }

  async function openUnlinkAuthModal(teacherId) {
    const row = state.teachers.find((t) => String(t.teacher_id) === String(teacherId));
    if (!row) return;
    state.unlinkTargetTeacherId = String(row.teacher_id);
    $("unlinkReasonInput").value = "";
    $("unlinkAuthModalDesc").textContent = `Unlink auth user from ${row.full_name || "this teacher"} (${row.email || "no-email"})?`;
    global.FSModal?.open?.($("unlinkAuthModal"));
  }

  async function submitUnlinkAuthModal() {
    const teacherId = String(state.unlinkTargetTeacherId || "").trim();
    const reason = String($("unlinkReasonInput")?.value || "").trim() || null;
    if (!teacherId) { notify("Teacher ID is missing.", "error"); return; }
    const btn = $("confirmUnlinkAuthBtn");
    const prevLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Unlinking...";
    try {
      const rpcRes = await global.supabase.rpc("unlink_teacher_from_auth_user", {
        p_teacher_id: teacherId,
        p_actor_email: state.profile?.email || null,
        p_reason: reason,
      });
      assertRpcOk(rpcRes, "Unlink request failed.");
      notify("Teacher auth link removed.", "success");
      global.FSModal?.close?.($("unlinkAuthModal"));
      await loadTeachers();
    } catch (err) {
      notify(FSAdminApi.normalizeError(err), "error");
    } finally {
      btn.disabled = false;
      btn.textContent = prevLabel || "Unlink";
    }
  }

  // ── Safe DOM row builders ──────────────────────────────────────────────────
  function buildTeacherRow(row) {
    const normalized = FSAdminApi.normalizeTeacherStatus(row.status, row.active);
    const classId = state.classMap.get(String(row.teacher_id)) || "—";
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    const strong = document.createElement("strong");
    strong.textContent = row.full_name || "—";
    nameTd.appendChild(strong);
    tr.appendChild(nameTd);

    const addText = (text, style) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (style) Object.assign(td.style, style);
      tr.appendChild(td);
    };
    const addHtml = (html) => {
      const td = document.createElement("td");
      td.innerHTML = html;
      tr.appendChild(td);
    };

    addText(row.email || "—");
    addText(row.fellowship_code || row.group_id || "—");
    addText(row.subgroup_id || "—");
    addHtml(statusChip(normalized));
    addText(classId, { fontSize: "12px", color: "var(--muted)" });
    addText(fmtDate(row.created_at));
    addHtml(actionButtons(row));
    return tr;
  }

  function buildTeacherCard(row) {
    const normalized = FSAdminApi.normalizeTeacherStatus(row.status, row.active);
    const article = document.createElement("article");
    article.className = "teacher-card";

    const h3 = document.createElement("h3");
    h3.textContent = row.full_name || "—";

    const p1 = document.createElement("p");
    p1.textContent = row.email || "—";

    const p2 = document.createElement("p");
    p2.textContent = `Fellowship: ${row.fellowship_code || row.group_id || "—"} | Subgroup: ${row.subgroup_id || "—"}`;

    const p3 = document.createElement("p");
    p3.innerHTML = statusChip(normalized);

    const actionsDiv = document.createElement("div");
    actionsDiv.className = "actions";
    actionsDiv.innerHTML = actionButtons(row);

    article.append(h3, p1, p2, p3, actionsDiv);
    return article;
  }

  // ── Filters + render ───────────────────────────────────────────────────────
  function applyFilters() {
    const q        = String($("searchInput").value || "").trim().toLowerCase();
    const group    = String($("groupFilter").value || "").trim().toLowerCase();
    const subgroup = String($("subgroupFilter").value || "").trim().toLowerCase();

    state.filtered = state.teachers.filter((row) => {
      const normalized = FSAdminApi.normalizeTeacherStatus(row.status, row.active);
      if (state.activeTab !== "ALL" && normalized !== state.activeTab) return false;
      const blob = [row.full_name, row.email, row.fellowship_code, row.group_id, row.subgroup_id, normalized].join(" ").toLowerCase();
      if (q        && !blob.includes(q))                                             return false;
      if (group    && !String(row.group_id    || "").toLowerCase().includes(group))  return false;
      if (subgroup && !String(row.subgroup_id || "").toLowerCase().includes(subgroup)) return false;
      return true;
    });

    renderRows();
  }

  function renderRows() {
    if (!state.filtered.length) {
      setState("No teachers match the current filters.");
      $("countLabel").textContent = "0 teachers";
      return;
    }

    $("rows").replaceChildren(...state.filtered.map(buildTeacherRow));
    $("mobileCards").replaceChildren(...state.filtered.map(buildTeacherCard));
    $("countLabel").textContent = `${state.filtered.length} teacher${state.filtered.length === 1 ? "" : "s"}`;
    showData();
  }

  // ── Load data ──────────────────────────────────────────────────────────────
  async function loadTeachers() {
    state.loading = true;
    setState("Loading teachers…");

    try {
      const rows = await FSAdminApi.listTeachers(global.supabase, { status: "ALL" });
      state.teachers = rows.map((row) => ({
        ...row,
        status: FSAdminApi.normalizeTeacherStatus(row.status, row.active),
      }));

      // Load class assignments from teacher_availability
      const teacherIds = state.teachers.map((t) => t.teacher_id).filter(Boolean);
      if (teacherIds.length) {
        const { data: avail } = await global.supabase
          .from("teacher_availability")
          .select("teacher_id,class_option_id")
          .in("teacher_id", teacherIds)
          .eq("status", "Confirmed")
          .limit(500);
        state.classMap.clear();
        for (const a of avail || []) {
          if (a.class_option_id) state.classMap.set(String(a.teacher_id), String(a.class_option_id));
        }
      }

      applyFilters();
    } catch (error) {
      if (isMissingTable(error)) {
        setState("Teachers table is missing. Run migrations before using Teacher Management.");
      } else {
        setState(`Could not load teachers: ${FSAdminApi.normalizeError(error)}`);
      }
    } finally {
      state.loading = false;
    }
  }

  // ── Side-effect helpers ────────────────────────────────────────────────────
  async function updateProfile(teacherUserId, patch) {
    if (!teacherUserId) return;
    await global.supabase.from("profiles").update(patch).eq("user_id", teacherUserId);
    // non-fatal: profile row may not exist yet
  }

  async function queueEmail(templateKey, subject, row, extraPayload) {
    if (!row.email) return;
    const firstName = String(row.full_name || "Teacher").split(/\s+/)[0];
    await global.supabase.from("email_queue").insert({
      recipient_email: row.email,
      recipient_name: row.full_name || "",
      template_key: templateKey,
      subject,
      status: "Pending",
      payload: { first_name: firstName, full_name: row.full_name, email: row.email, ...extraPayload },
    });
  }

  // ── Core action executor ───────────────────────────────────────────────────
  async function performAction(action, row, reason) {
    const nowIso    = new Date().toISOString();
    const teacherId = row.teacher_id;
    const actorEmail = state.profile?.email || "";

    let teachersPatch = {};
    let profilePatch  = null;
    let suspendAvailability = false;
    let emailKey, emailSubject, emailExtra;
    let eventType;

    switch (action) {
      case "suspend":
        eventType      = "TEACHER_SUSPENDED";
        teachersPatch  = { status: "SUSPENDED", active: false, suspended_at: nowIso, suspended_by: actorEmail, suspended_reason: reason, updated_at: nowIso };
        profilePatch   = { is_active: false };
        suspendAvailability = true;
        emailKey       = "teacher_suspended";
        emailSubject   = "Your Foundation School teacher account has been suspended";
        emailExtra     = { reason };
        break;
      case "unsuspend":
        eventType      = "TEACHER_REACTIVATED";
        teachersPatch  = { status: "ACTIVE", active: true, activated_at: nowIso, activated_by: actorEmail, suspended_reason: null, updated_at: nowIso };
        profilePatch   = { is_active: true };
        emailKey       = "teacher_reactivated";
        emailSubject   = "Your Foundation School teacher account is active again";
        emailExtra     = {};
        break;
      case "deactivate":
        eventType      = "TEACHER_DEACTIVATED";
        teachersPatch  = { status: "INACTIVE", active: false, deactivated_at: nowIso, deactivated_by: actorEmail, deactivated_reason: reason, updated_at: nowIso };
        profilePatch   = { role: "pending", is_active: false };
        break;
      case "inactivate":
        eventType      = "TEACHER_INACTIVATED";
        teachersPatch  = { status: "INACTIVE", active: false, deactivated_at: nowIso, deactivated_by: actorEmail, deactivated_reason: reason || null, updated_at: nowIso };
        profilePatch   = { is_active: false };
        break;
      case "activate":
        eventType      = "TEACHER_APPROVED";
        teachersPatch  = { status: "ACTIVE", active: true, activated_at: nowIso, activated_by: actorEmail, rejected_at: null, suspended_at: null, suspended_reason: null, updated_at: nowIso };
        profilePatch   = { role: "teacher", is_active: true };
        emailKey       = "teacher_approved";
        emailSubject   = "Your Foundation School teacher application has been approved";
        emailExtra     = {};
        break;
      case "reject":
        eventType      = "TEACHER_REJECTED";
        teachersPatch  = { status: "INACTIVE", active: false, rejected_at: nowIso, rejected_by: actorEmail, rejected_reason: reason, updated_at: nowIso };
        profilePatch   = { is_active: false };
        emailKey       = "teacher_rejected";
        emailSubject   = "Update on your Foundation School teacher application";
        emailExtra     = { reason: reason || "" };
        break;
      default:
        return;
    }

    // 1. Update teachers
    const { error: teacherErr } = await global.supabase
      .from("teachers")
      .update(teachersPatch)
      .eq("teacher_id", teacherId);
    if (teacherErr) throw teacherErr;

    // 2. Update profiles
    if (profilePatch && row.teacher_user_id) {
      await updateProfile(row.teacher_user_id, profilePatch);
    }

    // 3. Suspend Tentative availability slots
    if (suspendAvailability) {
      await global.supabase
        .from("teacher_availability")
        .update({ status: "Suspended" })
        .eq("teacher_id", teacherId)
        .eq("status", "Tentative");
    }

    // 4. Queue email
    if (emailKey) {
      await queueEmail(emailKey, emailSubject, row, emailExtra);
    }

    // 5. Audit log
    await FSAdminApi.logTeacherAudit(
      global.supabase,
      eventType,
      teacherId,
      {
        from_status: FSAdminApi.normalizeTeacherStatus(row.status, row.active),
        to_status: teachersPatch.status,
        reason: reason || null,
        teacher_name: row.full_name || "",
        teacher_email: row.email || "",
        actor_email: actorEmail,
      },
      actorEmail,
    );

    // 6. In-app notification for approve
    if (action === "activate") {
      global.supabase.from("in_app_notifications").insert({
        recipient_role: "admin",
        title: "Teacher approved",
        body: `${row.full_name || "Teacher"} has been approved and can now access the portal.`,
        type: "success",
        created_at: nowIso,
      }).then(() => {}).catch(() => {});
    }
  }

  // ── Action dispatcher ──────────────────────────────────────────────────────
  async function handleLifecycleAction(action, teacherId, emailHint) {
    if (action === "email") {
      const row = state.teachers.find((t) => String(t.teacher_id) === String(teacherId));
      if (!row?.email) { notify("No email on file for this teacher.", "error"); return; }
      if (!global.FSDirectEmail?.open) { notify("Direct email modal is not available.", "error"); return; }
      global.FSDirectEmail.open({ email: row.email, name: row.full_name || "" });
      return;
    }

    if (action === "linkauth") {
      if (!isAdmin()) {
        notify("Only admins can manage auth linking.", "error");
        return;
      }
      await openLinkAuthModal(teacherId);
      return;
    }

    if (action === "unlinkauth") {
      if (!isAdmin()) {
        notify("Only admins can manage auth linking.", "error");
        return;
      }
      await openUnlinkAuthModal(teacherId);
      return;
    }

    const row = state.teachers.find((t) => String(t.teacher_id) === String(teacherId));
    if (!row) return;

    // Role guards
    if ((action === "suspend" || action === "inactivate" || action === "deactivate") && !isAdmin()) {
      notify("Only admins can suspend or inactivate teachers.", "error");
      return;
    }
    if ((action === "activate" || action === "unsuspend") && !isAdmin()) {
      notify("Only admins can approve or reactivate teachers.", "error");
      return;
    }

    let reason = null;

    if (action === "suspend") {
      reason = await askReason({
        title: "Suspend Teacher",
        description: `Suspending ${row.full_name}. This will disable portal access and suspend their pending availability slots.`,
        minLength: 10,
      });
      if (reason === null) return;
    } else if (action === "inactivate") {
      reason = await askReason({
        title: "Inactivate Teacher",
        description: `Inactivating ${row.full_name}. This disables teacher access until they are activated again.`,
        minLength: 5,
      });
      if (reason === null) return;
    } else if (action === "deactivate") {
      reason = await askReason({
        title: "Deactivate Teacher",
        description: `Permanently deactivating ${row.full_name}. Their profile role will be reset to pending.`,
        minLength: 10,
      });
      if (reason === null) return;
    } else if (action === "reject") {
      reason = await askReason({
        title: "Reject Application",
        description: `Rejecting ${row.full_name}'s teacher application.`,
        minLength: 5,
      });
      if (reason === null) return;
    } else if (action === "unsuspend") {
      if (!global.confirm(`Reactivate ${row.full_name}? This will restore portal access.`)) return;
    } else if (action === "activate") {
      if (!global.confirm(`Approve ${row.full_name} as an active teacher?`)) return;
    }

    try {
      await performAction(action, row, reason);
      const labels = { suspend: "suspended", unsuspend: "activated", deactivate: "deactivated", inactivate: "inactivated", activate: "activated", reject: "rejected" };
      notify(`${row.full_name || "Teacher"} ${labels[action] || action}.`, "success");
      await loadTeachers();
    } catch (err) {
      notify(FSAdminApi.normalizeError(err), "error");
    }
  }

  // ── Event bindings ─────────────────────────────────────────────────────────
  function bindEvents() {
    $("refreshBtn").addEventListener("click", () => loadTeachers());
    $("searchInput").addEventListener("input",  applyFilters);
    $("groupFilter").addEventListener("input",  applyFilters);
    $("subgroupFilter").addEventListener("input", applyFilters);

    $("statusTabs").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-status]");
      if (!btn) return;
      state.activeTab = String(btn.dataset.status || "ALL").toUpperCase();
      renderTabs();
      applyFilters();
    });

    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action][data-id]");
      if (!btn) return;
      handleLifecycleAction(btn.dataset.action, btn.dataset.id, btn.dataset.email);
    });

    $("cancelLinkAuthBtn")?.addEventListener("click", () => global.FSModal?.close?.($("linkAuthModal")));
    $("confirmLinkAuthBtn")?.addEventListener("click", submitLinkAuthModal);
    $("cancelUnlinkAuthBtn")?.addEventListener("click", () => global.FSModal?.close?.($("unlinkAuthModal")));
    $("confirmUnlinkAuthBtn")?.addEventListener("click", submitUnlinkAuthModal);
    global.FSModal?.bindBackdropClose?.($("linkAuthModal"));
    global.FSModal?.bindBackdropClose?.($("unlinkAuthModal"));
  }

  // ── Add Teacher modal (unchanged) ──────────────────────────────────────────
  function wireAddTeacherModal() {
    const addTeacherBtn   = $("addTeacherBtn");
    const modalEl         = $("addTeacherModal");
    const formEl          = $("addTeacherForm");
    const cancelBtn       = $("cancelAddTeacherBtn");
    const submitBtn       = $("submitAddTeacherBtn");
    const togglePasswordBtn = $("toggleTempPasswordBtn");
    const passwordInput   = $("addTeacherTempPassword");
    const resultEl        = $("addTeacherResult");
    const resultEmailEl   = $("addTeacherResultEmail");
    const resultPasswordEl = $("addTeacherResultPassword");

    if (!addTeacherBtn || !modalEl || !formEl) return;

    const resetModal = () => {
      formEl.reset();
      resultEl.classList.add("hidden");
      resultEmailEl.textContent  = "";
      resultPasswordEl.textContent = "";
      submitBtn.disabled         = false;
      submitBtn.textContent      = "Create Teacher";
      passwordInput.type         = "password";
      togglePasswordBtn.textContent = "Show";
    };

    const closeModal = () => { global.FSModal?.close?.(modalEl); resetModal(); };

    addTeacherBtn.addEventListener("click", () => { resetModal(); global.FSModal?.open?.(modalEl); $("addTeacherFullName")?.focus(); });
    cancelBtn.addEventListener("click", closeModal);
    global.FSModal?.bindBackdropClose?.(modalEl);
    modalEl.addEventListener("click", (e) => { if (e.target === modalEl) closeModal(); });

    togglePasswordBtn.addEventListener("click", () => {
      const next = passwordInput.type === "password" ? "text" : "password";
      passwordInput.type = next;
      togglePasswordBtn.textContent = next === "password" ? "Show" : "Hide";
    });

    formEl.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fullName      = String($("addTeacherFullName")?.value || "").trim();
      const email         = String($("addTeacherEmail")?.value || "").trim();
      const tempPassword  = String(passwordInput.value || "");
      const phone         = String($("addTeacherPhone")?.value || "").trim();
      const groupId       = String($("addTeacherGroupId")?.value || "").trim();
      const subgroupId    = String($("addTeacherSubgroupId")?.value || "").trim();
      const fellowshipCode = String($("addTeacherFellowshipCode")?.value || "").trim().toUpperCase();
      const notes         = String($("addTeacherNotes")?.value || "").trim();

      if (!fullName)                   { notify("Full name is required", "error"); return; }
      if (!email || !email.includes("@")) { notify("A valid email is required", "error"); return; }
      if (tempPassword.length < 8)     { notify("Temporary password must be at least 8 characters", "error"); return; }

      submitBtn.disabled    = true;
      submitBtn.textContent = "Creating…";

      try {
        const result = await global.FSApi.invokeEdge("teacher-portal-api", {
          action: "createTeacherDirect",
          params: { full_name: fullName, email, temp_password: tempPassword, phone, group_id: groupId, subgroup_id: subgroupId, fellowship_code: fellowshipCode || null, notes },
        });

        if (!result?.ok) {
          notify(result?.error || "Failed", "error");
          submitBtn.disabled    = false;
          submitBtn.textContent = "Create Teacher";
          return;
        }

        resultEmailEl.textContent   = String(result.email || email);
        resultPasswordEl.textContent = String(result.temp_password || tempPassword);
        resultEl.classList.remove("hidden");
        submitBtn.textContent = "Done ✓";
        submitBtn.disabled    = true;
        await loadTeachers();
        notify("Teacher account created — share the credentials", "success");
      } catch (err) {
        notify(err?.message || "Failed", "error");
        submitBtn.disabled    = false;
        submitBtn.textContent = "Create Teacher";
      }
    });
  }

  // ── Auth check ─────────────────────────────────────────────────────────────
  async function ensureAccess() {
    const sessionRes = await global.supabase.auth.getSession();
    if (!sessionRes?.data?.session) { global.location.href = "login.html"; return false; }

    const profile = await global.getCurrentProfile();
    if (!profile) {
      setState("Access denied for this account.");
      return false;
    }

    state.profile = profile;
    if (!isOperationalRole()) {
      setState("Access denied for this account.");
      return false;
    }
    return true;
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    try {
      const { supabase, getCurrentProfile } = await import("../auth/auth-client.js");
      global.supabase          = supabase;
      global.getCurrentProfile = getCurrentProfile;
      global.FSAdminShell?.mount({ active: "", pageTitle: "Teacher Management" });

      renderTabs();
      bindEvents();
      wireAddTeacherModal();

      const allowed = await ensureAccess();
      if (!allowed) return;

      global.FSDirectEmail?.init({ supabase, senderEmail: state.profile?.email || "" });

      await loadTeachers();
    } catch (error) {
      setState(`Failed to initialize Teacher Management: ${FSAdminApi.normalizeError(error)}`);
    }
  }

  init();
})(window);
