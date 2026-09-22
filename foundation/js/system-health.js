    import { supabase, getCurrentProfile, getSessionOrNull, isAdmin } from "../auth/auth-client.js";
    import { initOperationalTrace } from "../js/operational-trace.js";

    const adminApi = window.FSAdminApi;
    const adminUi = window.FSAdminUi;
    const missingTables = new Set();

    const $ = (id) => document.getElementById(id);

    const state = {
      profile: null,
      checks: [],
      failures: []
    };

    function showBanner(kind, text) {
      ["errorBox", "okBox", "infoBox"].forEach((id) => $(id)?.classList.add("hidden"));
      const id = kind === "error" ? "errorBox" : kind === "ok" ? "okBox" : "infoBox";
      if ($(id)) {
        $(id).textContent = text;
        $(id).classList.remove("hidden");
      }
    }

    function isMissingTable(error) {
      const msg = String(error?.message || "").toLowerCase();
      return error?.code === "42P01" || msg.includes("does not exist") || msg.includes("relation");
    }

    async function withTimeout(label, promiseFactory, timeoutMs = 9000) {
      let timer;
      try {
        const timeoutPromise = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
        });
        return await Promise.race([promiseFactory(), timeoutPromise]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    function pushCheck(key, title, stateValue, detail) {
      state.checks.push({ key, title, state: stateValue, detail });
    }

    function checkChipClass(v) {
      if (v === "pass") return "pass";
      if (v === "warn") return "warn";
      return "fail";
    }

    function checkChipLabel(v) {
      return v === "pass" ? "PASS" : v === "warn" ? "WARN" : "FAIL";
    }

    function formatDateTime(v) {
      if (!v || v === "-") return "-";
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return String(v);
      return d.toLocaleString();
    }

    async function countTable(table, apply, optional = false) {
      try {
        const q0 = supabase.from(table).select("*", { count: "exact", head: true });
        const q = typeof apply === "function" ? apply(q0) : q0;
        const { count, error } = await withTimeout(`count ${table}`, () => q);
        if (error) {
          if (optional && isMissingTable(error)) {
            missingTables.add(table);
            return 0;
          }
          throw error;
        }
        return count || 0;
      } catch (e) {
        if (optional && isMissingTable(e)) {
          missingTables.add(table);
          return 0;
        }
        throw e;
      }
    }

    async function fetchRecentFailures() {
      const out = [];

      const load = async (table, apply, mapper, optional = true) => {
        try {
          const q0 = supabase.from(table).select("*").limit(20);
          const q = apply ? apply(q0) : q0;
          const { data, error } = await withTimeout(`recent ${table}`, () => q);
          if (error) {
            if (optional && isMissingTable(error)) {
              missingTables.add(table);
              return;
            }
            throw error;
          }
          (data || []).forEach((row) => out.push(mapper(row, table)));
        } catch (e) {
          if (optional && isMissingTable(e)) {
            missingTables.add(table);
            return;
          }
          throw e;
        }
      };

      await load(
        "failed_syncs",
        (q) => q.order("created_at", { ascending: false }),
        (r, t) => ({
          source: t,
          status: String(r.status || "FAILED"),
          target: String(r.source_table || r.sync_type || r.source_id || "-"),
          error: String(r.error_message || "-"),
          createdAt: r.created_at || "-",
          updatedAt: r.last_retry_at || r.updated_at || "-"
        })
      );

      await load(
        "email_queue",
        (q) => q.or("status.ilike.%fail%,status.ilike.%error%").order("updated_at", { ascending: false }),
        (r, t) => ({
          source: t,
          status: String(r.status || "FAILED"),
          target: String(r.recipient_email || r.recipient_name || "-"),
          error: String(r.error_message || r.last_error || "-"),
          createdAt: r.created_at || "-",
          updatedAt: r.updated_at || "-"
        })
      );

      await load(
        "scheduled_notifications",
        (q) => q.or("status.ilike.%fail%,status.ilike.%error%").order("updated_at", { ascending: false }),
        (r, t) => ({
          source: t,
          status: String(r.status || "FAILED"),
          target: String(r.recipient_email || r.event_type || "-"),
          error: String(r.error_message || r.last_error || "-"),
          createdAt: r.created_at || "-",
          updatedAt: r.updated_at || "-"
        })
      );

      await load(
        "audit_logs",
        (q) => q.or("status.ilike.%fail%,status.ilike.%error%").order("created_at", { ascending: false }),
        (r, t) => ({
          source: t,
          status: String(r.status || "-"),
          target: String(r.action || r.entity_type || "-"),
          error: String(r.details?.error || r.details?.message || "-"),
          createdAt: r.created_at || r.logged_at || "-",
          updatedAt: r.created_at || r.logged_at || "-"
        })
      );

      await load(
        "moodle_enrollment_sync",
        (q) => q.or("sync_status.ilike.%fail%,sync_status.ilike.%error%,last_error.not.is.null").order("updated_at", { ascending: false }),
        (r, t) => ({
          source: t,
          status: String(r.sync_status || "FAILED"),
          target: String(r.email || r.student_id || r.batch_id || "-"),
          error: String(r.last_error || "-"),
          createdAt: r.created_at || "-",
          updatedAt: r.updated_at || "-"
        })
      );

      return out.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()).slice(0, 60);
    }

    async function checkEdgeEndpoint(name) {
      const cfg = adminApi?.getConfig?.() || {};
      const supabaseUrl = String(window.FS_CONFIG?.SUPABASE_URL || cfg.url || "").trim();
      const anonKey = String(window.FS_CONFIG?.SUPABASE_ANON_KEY || cfg.anonKey || "").trim();
      if (!supabaseUrl || !anonKey) {
        return { state: "fail", detail: "Missing runtime config." };
      }

      const url = `${supabaseUrl}/functions/v1/${name}`;
      try {
        const res = await withTimeout(
          `edge ${name}`,
          () => fetch(url, {
            method: "OPTIONS",
            headers: {
              apikey: anonKey,
              Authorization: `Bearer ${anonKey}`,
              "Content-Type": "application/json"
            }
          }),
          8000
        );

        if (res.ok) return { state: "pass", detail: `Reachable (HTTP ${res.status}).` };
        if (res.status === 401 || res.status === 403) return { state: "warn", detail: `Reachable but auth-restricted (HTTP ${res.status}).` };
        return { state: "warn", detail: `Responded HTTP ${res.status}.` };
      } catch (e) {
        return { state: "fail", detail: adminApi.normalizeError(e) };
      }
    }

    function renderChecks() {
      const grid = $("checksGrid");
      grid.innerHTML = state.checks.map((c) => `
        <article class="health-card">
          <div class="health-head">
            <h3 class="health-title">${adminUi.esc(c.title)}</h3>
            <span class="health-chip ${checkChipClass(c.state)}">${checkChipLabel(c.state)}</span>
          </div>
          <div class="health-detail">${adminUi.esc(c.detail)}</div>
        </article>
      `).join("");

      $("checksState").classList.add("hidden");
      grid.classList.remove("hidden");
    }

    function renderFailureSummary() {
      const rows = $("failsRows");
      const mobile = $("failsMobile");

      if (!state.failures.length) {
        $("failsState").textContent = "No recent failures found across monitored tables.";
        $("failsState").classList.remove("hidden");
        $("failsTableWrap").classList.add("hidden");
        mobile.innerHTML = "";
        return;
      }

      rows.innerHTML = state.failures.map((f) => `
        <tr>
          <td>${adminUi.esc(f.source)}</td>
          <td>${adminUi.esc(f.status)}</td>
          <td>${adminUi.esc(f.target)}</td>
          <td class="muted-cell" title="${adminUi.esc(f.error)}">${adminUi.esc(f.error)}</td>
          <td>${adminUi.esc(formatDateTime(f.createdAt))}</td>
          <td>${adminUi.esc(formatDateTime(f.updatedAt))}</td>
        </tr>
      `).join("");

      mobile.innerHTML = state.failures.map((f) => `
        <article class="mobile-fail">
          <h4>${adminUi.esc(f.source)} ? ${adminUi.esc(f.status)}</h4>
          <p><strong>Target:</strong> ${adminUi.esc(f.target)}</p>
          <p><strong>Error:</strong> ${adminUi.esc(f.error)}</p>
          <p><strong>Created:</strong> ${adminUi.esc(formatDateTime(f.createdAt))}</p>
          <p><strong>Updated:</strong> ${adminUi.esc(formatDateTime(f.updatedAt))}</p>
        </article>
      `).join("");

      $("failsState").classList.add("hidden");
      $("failsTableWrap").classList.remove("hidden");
    }

    function renderNotes() {
      const notes = $("migrationNotes");
      if (!missingTables.size) {
        notes.innerHTML = "<li>No missing optional tables detected for health diagnostics.</li>";
        return;
      }
      notes.innerHTML = [...missingTables].map((t) => `<li>Optional table missing: ${adminUi.esc(t)}</li>`).join("");
    }

    async function ensureAccess() {
      const session = await getSessionOrNull();
      if (!session) {
        window.location.href = "login.html";
        return false;
      }

      const profile = await getCurrentProfile();
      if (!profile || !profile.is_active || !isAdmin(profile.role)) {
        showBanner("error", "Access denied. Admin privileges are required.");
        return false;
      }

      state.profile = profile;
      window.FSAdminShell?.mount({
        active: "health",
        title: "Rock Solid Admin",
        profileName: profile.full_name || profile.email || "Admin",
        role: profile.role,
        breadcrumbs: [{ label: "Admin", href: "dashboards.html" }, "System Health"]
      });
      return true;
    }

    async function runChecks() {
      state.checks = [];
      missingTables.clear();

      // 1. Session check
      try {
        const session = await withTimeout("auth session", () => supabase.auth.getSession());
        const hasSession = !!session.data?.session;
        pushCheck("session", "Auth / Session", hasSession ? "pass" : "warn", hasSession ? "Authenticated session present." : "No active session.");
        $("kSession").textContent = hasSession ? "PASS" : "WARN";
      } catch (e) {
        pushCheck("session", "Auth / Session", "fail", adminApi.normalizeError(e));
        $("kSession").textContent = "FAIL";
      }

      // 2. Supabase connectivity
      try {
        const { error } = await withTimeout(
          "supabase connectivity",
          () => supabase.from("batches").select("batch_id", { head: true, count: "exact" }).limit(1)
        );
        if (error) throw error;
        pushCheck("conn", "Supabase Connection", "pass", "Database reachable and responding.");
        $("kConnection").textContent = "PASS";
      } catch (e) {
        pushCheck("conn", "Supabase Connection", "fail", adminApi.normalizeError(e));
        $("kConnection").textContent = "FAIL";
      }

      // 3. Profile visibility check - profiles (canonical) then admin_users (legacy fallback)
      try {
        const userRes = await withTimeout("auth user", () => supabase.auth.getUser());
        const user = userRes.data?.user;
        if (!user) throw new Error("No authenticated user.");

        // Try profiles table first (canonical)
        let profileSource = null;
        const { data: profileRow, error: profileErr } = await withTimeout(
          "profiles visibility",
          () => supabase.from("profiles").select("user_id,email,role").eq("user_id", user.id).maybeSingle()
        );
        if (!profileErr && profileRow) {
          profileSource = "profiles";
          pushCheck("profiles", "Profile Visibility (profiles)", "pass", `Role: ${profileRow.role || "unknown"} - canonical table present.`);
        } else if (profileErr && isMissingTable(profileErr)) {
          missingTables.add("profiles");
          pushCheck("profiles", "Profile Visibility (profiles)", "warn", "profiles table not yet present; using admin_users fallback.");
        } else if (profileErr) {
          pushCheck("profiles", "Profile Visibility (profiles)", "warn", adminApi.normalizeError(profileErr));
        } else {
          pushCheck("profiles", "Profile Visibility (profiles)", "warn", "No profiles row found for current user.");
        }

        // Also check admin_users for fallback visibility
        if (!profileSource) {
          const { data, error } = await withTimeout(
            "admin_users visibility",
            () => supabase
              .from("admin_users")
              .select("auth_user_id,email,role,status,active")
              .or(`auth_user_id.eq.${user.id},email.eq.${user.email}`)
              .limit(1)
              .maybeSingle()
          );
          if (error && !isMissingTable(error)) throw error;
          if (error && isMissingTable(error)) {
            missingTables.add("admin_users");
            pushCheck("admin-users", "Admin Visibility (admin_users)", "warn", "admin_users table missing.");
          } else if (!data) {
            pushCheck("admin-users", "Admin Visibility (admin_users)", "warn", "No admin_users record for current user.");
          } else {
            pushCheck("admin-users", "Admin Visibility (admin_users)", "pass", `Role: ${data.role || "unknown"}; status: ${data.status || "n/a"}`);
          }
        }
      } catch (e) {
        pushCheck("profiles", "Profile Visibility", "fail", adminApi.normalizeError(e));
      }

      // 4. RLS/table accessibility checks (admin_users-first)
      const tableChecks = [
        ["email_queue", "Queue table access"],
        ["scheduled_notifications", "Scheduled notifications access"],
        ["audit_logs", "Audit logs access"],
        ["failed_syncs", "Failed syncs access"],
        ["moodle_enrollment_sync", "Moodle enrollment sync access"],
        ["batches", "Batches access"]
      ];

      for (const [table, label] of tableChecks) {
        try {
          const { error } = await withTimeout(label, () => supabase.from(table).select("*", { head: true, count: "exact" }).limit(1));
          if (error) {
            if (isMissingTable(error)) {
              missingTables.add(table);
              pushCheck(`tbl-${table}`, label, "warn", `${table} missing (optional in this environment).`);
            } else {
              throw error;
            }
          } else {
            pushCheck(`tbl-${table}`, label, "pass", `${table} readable.`);
          }
        } catch (e) {
          pushCheck(`tbl-${table}`, label, "fail", adminApi.normalizeError(e));
        }
      }

      // 5. Edge function availability checks (non-destructive OPTIONS probe)
      const edgeFunctions = ["retry-worker", "registration-processor", "moodle-sync", "notification-batch-processor", "notification-dispatcher"];
      for (const fn of edgeFunctions) {
        const result = await checkEdgeEndpoint(fn);
        pushCheck(`fn-${fn}`, `Edge Function: ${fn}`, result.state, result.detail);
      }

      try {
        const activeMappings = await countTable("batch_moodle_courses", (q) => q.eq("active", true), true);
        if (activeMappings > 0) {
          pushCheck("moodle-mapping", "Moodle Course Mapping", "pass", `${activeMappings} active mapping(s) available.`);
        } else {
          pushCheck(
            "moodle-mapping",
            "Moodle Course Mapping",
            "warn",
            "No active batch_moodle_courses mappings found. ASSIGNED students will fail Moodle sync until mappings are added.",
          );
        }
      } catch (e) {
        pushCheck("moodle-mapping", "Moodle Course Mapping", "warn", adminApi.normalizeError(e));
      }

      // Moodle API live connectivity check (core_webservice_get_site_info)
      // Routes through admin-api proxy for authenticated access.
      try {
        const cfg = adminApi?.getConfig?.() || {};
        const supabaseUrl = String(window.FS_CONFIG?.SUPABASE_URL || cfg.url || "").trim();
        const { data: sess } = await supabase.auth.getSession();
        const token = sess?.session?.access_token;

        if (!supabaseUrl || !token) {
          pushCheck("moodle-api", "Moodle API Connectivity", "warn", "Missing auth token or runtime config — cannot test Moodle connection.");
        } else {
          const moodleRes = await withTimeout(
            "moodle-api-test",
            () => fetch(`${supabaseUrl}/functions/v1/admin-api`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ action: "invoke-moodle-sync", moodle_action: "test" })
            }),
            10000
          );
          const moodleData = await moodleRes.json().catch(() => ({}));
          // Remap moodle_action response back to action for compatibility.
          if (moodleData.test === "moodle_connectivity") {
            moodleData.action = "test";
          }
          if (moodleData.ok) {
            const label = moodleData.sitename || moodleData.siteurl || moodleData.moodleUrl || "Moodle";
            pushCheck("moodle-api", "Moodle API Connectivity", "pass", `Connected — ${label}`);
          } else if (moodleData.code === "MOODLE_NOT_CONFIGURED") {
            pushCheck("moodle-api", "Moodle API Connectivity", "warn", "MOODLE_URL / MOODLE_TOKEN not configured in environment.");
          } else {
            const cause = moodleData.failure_reason ? ` (${moodleData.failure_reason})` : "";
            const url = moodleData.moodleUrl ? ` — ${moodleData.moodleUrl}` : "";
            pushCheck("moodle-api", "Moodle API Connectivity", "fail", `${moodleData.error || moodleData.code || "Unknown error"}${cause}${url}`);
          }
        }
      } catch (e) {
        pushCheck("moodle-api", "Moodle API Connectivity", "fail", adminApi.normalizeError(e));
      }
    }

    async function loadMetricsAndFailures() {
      // queue metrics
      let queuedEmail = 0;
      let failedEmail = 0;
      let scheduled = 0;
      let failedSync = 0;
      let moodleBacklog = 0;
      let activeBatch = 0;

      try {
        queuedEmail = await countTable("email_queue", (q) => q.or("status.ilike.%pending%,status.ilike.%queued%"), true);
      } catch (e) {
        showBanner("error", `Queued email count failed: ${adminApi.normalizeError(e)}`);
      }

      try {
        failedEmail = await countTable("email_queue", (q) => q.or("status.ilike.%fail%,status.ilike.%error%"), true);
      } catch (e) {
        showBanner("error", `Failed email count failed: ${adminApi.normalizeError(e)}`);
      }

      try {
        scheduled = await countTable("scheduled_notifications", (q) => q.or("status.ilike.%pending%,status.ilike.%queued%"), true);
      } catch (e) {
        showBanner("error", `Scheduled notification count failed: ${adminApi.normalizeError(e)}`);
      }

      try {
        failedSync = await countTable("failed_syncs", (q) => q.or("status.ilike.%fail%,status.ilike.%error%"), true);
      } catch (e) {
        showBanner("error", `Failed sync count failed: ${adminApi.normalizeError(e)}`);
      }

      try {
        moodleBacklog = await countTable("moodle_enrollment_sync", (q) => q.in("sync_status", ["PENDING", "RETRYING", "FAILED"]), true);
      } catch (e) {
        showBanner("error", `Moodle backlog count failed: ${adminApi.normalizeError(e)}`);
      }

      try {
        activeBatch = await countTable("batches", (q) => q.eq("active", true), true);
      } catch (e) {
        showBanner("error", `Active batch count failed: ${adminApi.normalizeError(e)}`);
      }

      $("kQueuedEmail").textContent = String(queuedEmail);
      $("kFailedEmail").textContent = String(failedEmail);
      $("kScheduled").textContent = String(scheduled);
      $("kFailedSync").textContent = String(failedSync);
      $("kActiveBatch").textContent = String(activeBatch);
      $("kRetryBacklog").textContent = String(failedSync + failedEmail + moodleBacklog);

      // recent failures
      try {
        state.failures = await fetchRecentFailures();
      } catch (e) {
        showBanner("error", `Recent failure summary failed: ${adminApi.normalizeError(e)}`);
        state.failures = [];
      }
    }

    async function refresh() {
      $("checksState").classList.remove("hidden");
      $("checksState").textContent = "Running checks...";
      $("checksGrid").classList.add("hidden");

      $("failsState").classList.remove("hidden");
      $("failsState").textContent = "Loading recent failures...";
      $("failsTableWrap").classList.add("hidden");
      $("failsMobile").innerHTML = "";

      try {
        await runChecks();
        await loadMetricsAndFailures();
        renderChecks();
        renderFailureSummary();
        renderNotes();
        showBanner("ok", "System health checks completed.");
      } catch (e) {
        showBanner("error", `Health refresh failed: ${adminApi.normalizeError(e)}`);
      } finally {
        // always terminate loaders
        if (!$("checksGrid").classList.contains("hidden")) {
          $("checksState").classList.add("hidden");
        }
        if (!$("failsTableWrap").classList.contains("hidden") || state.failures.length === 0) {
          // failure section renderer already controls visibility, this guards endless loading text
          if (state.failures.length === 0) {
            $("failsState").classList.remove("hidden");
          }
        }
      }
    }

    async function init() {
      window.FSAdminShell?.mount({ active: "health", pageTitle: "System Health" });
      if (!adminApi || !adminUi) {
        showBanner("error", "Shared admin modules failed to load.");
        return;
      }

      const allowed = await ensureAccess();
      if (!allowed) return;

      initOperationalTrace({
        supabase,
        adminApi,
        adminUi,
        isAdmin,
        getCurrentProfile,
        getSessionOrNull
      });

      $("refreshBtn").addEventListener("click", async () => {
        try {
          await refresh();
        } catch (e) {
          showBanner("error", adminApi.normalizeError(e));
        }
      });

      await refresh();
    }

    init();


