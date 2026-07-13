(function () {
  const Shell = (window.FSAdminShell = window.FSAdminShell || {});
  if (window.self !== window.top) {
    Shell.mount = Shell.mount || (async function () {});
    Shell.setProfile = Shell.setProfile || function () {};
    Shell.setPageTitle = Shell.setPageTitle || function () {};
    Shell.setBadge = Shell.setBadge || function () {};
    return;
  }

  const BOOT_STYLE_ID = "fs-shell-boot-opacity-style";
  const existingBootStyle = document.getElementById(BOOT_STYLE_ID);
  if (!existingBootStyle) {
    const bootStyle = document.createElement("style");
    bootStyle.id = BOOT_STYLE_ID;
    bootStyle.textContent = "body:not(.fs-iframe-child) { opacity: 0; transition: opacity 150ms ease; }";
    const head = document.head || document.getElementsByTagName("head")[0];
    if (head) head.prepend(bootStyle);
  }
  const mountFailSafeTimer = window.setTimeout(function () {
    document.body.style.opacity = "1";
  }, 2000);

  const THEME_KEY = "fs_admin_theme";
  const COLLAPSE_KEY = "fs_admin_sidebar_collapsed";
  const REGIONAL_MODE_KEY = "fs_regional_secretary_mode";
  const TEACHER_MODE_ELIGIBLE_ROLES = new Set(["regional_secretary", "admin", "superadmin"]);
  const OPERATIONAL_ROLES = ["regional_secretary", "principal", "subgroup_admin", "pastor", "admin", "superadmin"];
  const SYSTEM_ADMIN_ROLES = ["admin", "superadmin"];

  /* SVG icon map — stroke-based 24×24 icons, one per nav key */
  const ICONS = {
    dashboard:          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
    portal:             `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    batch:              `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    applicants:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    waitlist:           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    classeditor:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>`,
    reports:            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
    attendance:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
    schedule:           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/></svg>`,
    "teacher-slots":    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    progress:           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
    help:               `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    messages:           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    notifications:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
    email:              `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
    adminactivity:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
    roleaudit:          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
    teachers:           `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    trace:              `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    fellowships:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    nexusmapping:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
    failedsyncs:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/></svg>`,
    health:             `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
    moodlesettings:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M4.93 19.07l1.41-1.41M19.07 19.07l-1.41-1.41M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>`,
    audit:              `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
    milestones:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  };

  /* Inject CSS for SVG icon sizing once */
  (function injectIconStyle() {
    if (document.getElementById("fs-sb-icon-style")) return;
    const s = document.createElement("style");
    s.id = "fs-sb-icon-style";
    s.textContent = `.sb-icon svg{width:16px;height:16px;display:block;flex-shrink:0}.user-info{display:flex;flex-direction:column;line-height:1.2}.user-role{font-size:10px;font-weight:600;opacity:.65;text-transform:capitalize}`;
    (document.head || document.body).appendChild(s);
  })();

  const NAV_SECTIONS = [
    {
      label: "Overview",
      items: [
        { key: "dashboard", label: "Dashboard", href: "dashboards.html", icon: "DB", roles: OPERATIONAL_ROLES },
        { key: "portal", label: "Admin Portal", href: "admin-portal.html", icon: "AP", roles: SYSTEM_ADMIN_ROLES }
      ]
    },
    {
      label: "Operations",
      items: [
        { key: "batch", label: "Batch Management", href: "batch-management.html", icon: "BM", roles: OPERATIONAL_ROLES },
        { key: "applicants", label: "Applicants", href: "applicant-directory.html", icon: "AD", roles: OPERATIONAL_ROLES },
        { key: "waitlist", label: "Waiting Students", href: "waitlist.html", icon: "WL", roles: OPERATIONAL_ROLES },
        { key: "classeditor", label: "Class Editor", href: "class-editor.html", icon: "CE", roles: OPERATIONAL_ROLES }
      ]
    },
    {
      label: "Reports & Exports",
      items: [
        {
          key: "reports",
          label: "Reports & Exports",
          href: "reports.html",
          icon: "RP",
          roles: OPERATIONAL_ROLES,
        },
      ]
    },
    {
      label: "Teaching",
      items: [
        { key: "attendance", label: "Attendance", href: "../teacher/teacher-attendance.html", icon: "AT" },
        { key: "schedule", label: "Schedule", href: "teacher-schedule.html", icon: "SC" },
        { key: "teacher-slots", label: "Teacher Slots", href: "teacher-schedule.html", icon: "TS", roles: OPERATIONAL_ROLES },
        { key: "progress", label: "Student Progress", href: "StudentProgressView.html", icon: "SP" }
      ]
    },
    {
      label: "Comms",
      items: [
        { key: "help", label: "Help Guide", href: "help-guide.html", icon: "?", roles: OPERATIONAL_ROLES },
        { key: "messages", label: "Messages", href: "messages.html", icon: "MS", roles: OPERATIONAL_ROLES },
        { key: "notifications", label: "Notifications", href: "notification-center.html", icon: "NT", roles: SYSTEM_ADMIN_ROLES },
        { key: "email", label: "Email Campaigns", href: "email-campaigns.html", icon: "EM", roles: SYSTEM_ADMIN_ROLES }
      ]
    },
    {
      label: "Admin Tools",
      items: [
        { key: "adminactivity", label: "Activity Log", href: "admin-activity.html", icon: "AL", roles: ["admin", "superadmin"] },
        { key: "roleaudit", label: "Role Audit", href: "role-audit.html", icon: "RA", roles: ["superadmin"] },
      ]
    },
    {
      label: "System",
      items: [
        { key: "teachers", label: "Teachers", href: "teacher-management.html", icon: "TM", roles: OPERATIONAL_ROLES },
        { key: "trace", label: "Operational Trace", href: "operational-trace.html", icon: "OT", roles: ["admin", "superadmin", "regional_secretary"] },
        { key: "fellowships", label: "Fellowships", href: "fellowship-management.html", icon: "FG", roles: SYSTEM_ADMIN_ROLES },
        { key: "nexusmapping", label: "Nexus Mapping", href: "rocksolid-management.html", icon: "NX", roles: SYSTEM_ADMIN_ROLES },
        { key: "failedsyncs", label: "Failed Syncs", href: "failed-sync-retry-center.html", icon: "FS", roles: SYSTEM_ADMIN_ROLES },
        { key: "health", label: "System Health", href: "system-health.html", icon: "SH", roles: SYSTEM_ADMIN_ROLES },
        { key: "moodlesettings", label: "Moodle Settings", href: "moodle-settings.html", icon: "MD", roles: SYSTEM_ADMIN_ROLES },
        { key: "audit", label: "Audit Log", href: "audit-log.html", icon: "LG", roles: ["superadmin"] },
        { key: "milestones", label: "Milestones", href: "milestones-admin.html", icon: "MS", roles: OPERATIONAL_ROLES }
      ]
    }
  ];

  const ADMIN_ONLY_KEYS = new Set([
    "dashboard",
    "portal",
    "batch",
    "applicants",
    "notifications",
    "email",
    "fellowships",
    "failedsyncs",
    "health",
    "moodlesettings",
    "audit",
    "milestones",
    "nexusmapping",
    "adminactivity",
    "roleaudit",
  ]);
  const TEACHER_KEYS = new Set(["attendance", "schedule", "teacher-slots", "progress", "help"]);

  function resolveLoginPath() {
    const p = window.location.pathname || "";
    return p.includes("/foundation/") ? "/foundation/auth/login.html" : "/auth/login.html";
  }

  function ensureProgressBar() {
    let bar = document.getElementById("fs-progress-bar");
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = "fs-progress-bar";
    bar.style.cssText = "position:fixed;top:0;left:0;height:3px;width:0%;background:#C8102E;z-index:9999;transition:width 0.3s ease,opacity 0.2s ease;border-radius:0 2px 2px 0;opacity:0;";
    document.body.appendChild(bar);
    return bar;
  }

  function completeProgressBar() {
    const bar = ensureProgressBar();
    bar.style.opacity = "1";
    bar.style.width = "100%";
    window.setTimeout(function () {
      bar.style.opacity = "0";
      window.setTimeout(function () {
        bar.style.width = "0%";
      }, 200);
      try { sessionStorage.removeItem("fs_nav_progress_pending"); } catch (_) {}
    }, 300);
  }

  function startShellTransition() {
    const main = document.querySelector(".fs-shell-main, .fs-content.main, main.main, main");
    if (main) {
      main.classList.add("fs-shell-main");
      main.classList.add("fs-loading");
    }
    document.body.classList.add("fs-nav-transitioning");
    const frame = document.querySelector(".fs-content-frame");
    if (frame) {
      frame.style.opacity = "0";
      frame.style.transition = "opacity 0.15s ease";
    }
    const bar = ensureProgressBar();
    bar.style.opacity = "1";
    bar.style.width = "70%";
    try { sessionStorage.setItem("fs_nav_progress_pending", "1"); } catch (_) {}
  }

  function applyTheme() {
    document.documentElement.setAttribute("data-theme", "light");
    document.documentElement.classList.remove("dark");
    document.body.classList.remove("dark");
    try {
      localStorage.setItem(THEME_KEY, "light");
      localStorage.setItem("fs_theme", "light");
      localStorage.setItem("fs_batch_theme", "light");
    } catch (_) {}
  }

  function initTheme() {
    try {
      localStorage.removeItem(THEME_KEY);
      localStorage.removeItem("fs_theme");
      localStorage.removeItem("fs_batch_theme");
    } catch (_) {}
    applyTheme();
  }

  function applyCollapsedState(collapsed) {
    if (window.innerWidth <= 768) {
      document.body.classList.remove("fs-shell-collapsed");
      return;
    }
    document.body.classList.toggle("fs-shell-collapsed", !!collapsed);
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch (_) {}
    const btn = document.getElementById("fs-collapse-btn");
    if (btn) {
      btn.setAttribute("aria-pressed", collapsed ? "true" : "false");
      btn.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
      btn.innerHTML = collapsed ? "&#8250;" : "&#8249;";
    }
    const railBtn = document.getElementById("fs-sidebar-toggle");
    if (railBtn) {
      railBtn.setAttribute("aria-pressed", collapsed ? "true" : "false");
      railBtn.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
      railBtn.innerHTML = collapsed ? "&#8250;" : "&#8249;";
    }
  }

  function getRegionalMode() {
    try {
      const saved = String(localStorage.getItem(REGIONAL_MODE_KEY) || "").toLowerCase();
      return saved === "teacher" ? "teacher" : "admin";
    } catch (_) {
      return "admin";
    }
  }

  function setRegionalMode(mode) {
    const normalized = String(mode || "").toLowerCase() === "teacher" ? "teacher" : "admin";
    try { localStorage.setItem(REGIONAL_MODE_KEY, normalized); } catch (_) {}
    return normalized;
  }

  function effectiveRoleFromMode(role, mode) {
    const raw = String(role || "").toLowerCase();
    if (TEACHER_MODE_ELIGIBLE_ROLES.has(raw) && String(mode || "").toLowerCase() === "teacher") return "teacher";
    return raw;
  }

  function clearRegionalTeacherScope() {
    try { sessionStorage.removeItem("fs_teacher_mode_scope"); } catch (_) {}
  }

  function setRegionalTeacherScope(scope) {
    try { sessionStorage.setItem("fs_teacher_mode_scope", JSON.stringify(scope || {})); } catch (_) {}
  }

  function initCollapsedState() {
    let collapsed = false;
    try {
      collapsed = localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch (_) {}
    applyCollapsedState(window.innerWidth <= 768 ? false : collapsed);
  }

  function inferActive() {
    const p = (window.location.pathname || "").toLowerCase();
    if (p.includes("admin-dashboard")) return "dashboard";
    if (p.includes("dashboards")) return "dashboard";
    if (p.includes("admin-portal")) return "portal";
    if (p.includes("batch-management")) return "batch";
    if (p.includes("applicant-directory")) return "applicants";
    if (p.includes("teacherattendanceportal")) return "attendance";
    if (p.includes("teacher-attendance")) return "attendance";
    if (p.includes("teacher-schedule")) return "schedule";
    if (p.includes("studentprogressview")) return "progress";
    if (p.includes("notification-center")) return "notifications";
    if (p.includes("help-guide")) return "help";
    if (p.includes("messages")) return "messages";
    if (p.includes("email-campaigns")) return "email";
    if (p.includes("failed-sync-retry-center")) return "failedsyncs";
    if (p.includes("system-health")) return "health";
    if (p.includes("moodle-settings")) return "moodlesettings";
    if (p.includes("audit-log")) return "audit";
    if (p.includes("milestones-admin")) return "milestones";
    if (p.includes("rocksolid-management")) return "nexusmapping";
    if (p.includes("clickup-management")) return "nexusmapping";
    if (p.includes("data-exports")) return "dataexports";
    if (p.includes("baptism-report")) return "baptismreport";
    if (p.includes("reports")) return "reports";
    if (p.includes("teacher-management")) return "teachers";
    if (p.includes("operational-trace")) return "trace";
    if (p.includes("admin-activity")) return "adminactivity";
    if (p.includes("role-audit")) return "roleaudit";
    if (p.includes("waitlist")) return "waitlist";
    if (p.includes("class-editor")) return "classeditor";
    if (p.includes("fellowship-management")) return "fellowships";
    return "";
  }

  function buildSidebarHTML(active, badgeCounts, role) {
    const bc = badgeCounts || {};
    const currentRole = String(role || "").toLowerCase();
    const isTeacher = currentRole === "teacher";
    let nav = "";
    NAV_SECTIONS.forEach(function (section) {
      const visibleItems = section.items.filter(function (item) {
        if (currentRole === "regional_secretary" && (item.key === "notifications" || item.key === "email")) {
          return false;
        }
        if (isTeacher) return TEACHER_KEYS.has(item.key);
        if (Array.isArray(item.roles) && item.roles.length) {
          return item.roles.includes(currentRole);
        }
        return true;
      });
      if (!visibleItems.length) return;
      nav += `<div class="sb-label">${section.label}</div>`;
      visibleItems.forEach(function (item) {
        const isActive = item.key === active;
        const badge = bc[item.key] ? `<span class="sb-badge" style="background:var(--amber)">${bc[item.key]}</span>` : "";
        const iconSvg = ICONS[item.key] || `<span style="font-size:11px;font-weight:800">${String(item.icon || item.label || "?").slice(0, 2).toUpperCase()}</span>`;
        nav += `<a class="sb-link${isActive ? " active" : ""}" href="${item.href}" data-key="${item.key}" title="${item.label}">
          <span class="sb-icon">${iconSvg}</span>
          <span>${item.label}</span>
          ${badge}
        </a>`;
      });
    });
    return nav;
  }

  function isTeacherBlockedPage(activeKey, role) {
    const isTeacher = String(role || "").toLowerCase() === "teacher";
    if (!isTeacher) return false;
    return ADMIN_ONLY_KEYS.has(activeKey);
  }

  function renderDenied() {
    document.body.innerHTML = `
      <main class="fs-page fs-wrap-narrow" style="padding:32px">
        <section class="card">
          <h2 style="margin:0 0 10px 0">Access Denied</h2>
          <p style="margin:0;color:var(--muted)">Teachers can only access Attendance, Scheduler, and Student Progress.</p>
        </section>
      </main>
    `;
  }

  Shell.mount = async function mount(options) {
    document.body.classList.add("fs-iframe-child");
    options = options || {};
    if (document.getElementById("fs-admin-sb")) {
      window.clearTimeout(mountFailSafeTimer);
      document.body.style.opacity = "1";
      return;
    }

    // Null-safe config guard: if FS_CONFIG is absent show "Not connected" rather than failing silently.
    if (!options.profileName && (!window.FS_CONFIG || !window.FS_CONFIG.SUPABASE_URL)) {
      options = Object.assign({}, options, { profileName: "Not connected" });
    }

    const active = options.active || inferActive();
    const profileName = options.profileName || "Admin";
    let role = String(options.role || "").toLowerCase();
    if (!role) {
      try {
        const auth = await import("../auth/auth-client.js");
        const profile = await auth.getCurrentProfile();
        role = String(profile?.role || "").toLowerCase();
      } catch (_) {}
    }
    const mode = TEACHER_MODE_ELIGIBLE_ROLES.has(role)
      ? setRegionalMode(options.mode || getRegionalMode())
      : "admin";
    const effectiveRole = effectiveRoleFromMode(role, mode);
    if (!TEACHER_MODE_ELIGIBLE_ROLES.has(role) || mode !== "teacher") clearRegionalTeacherScope();
    if (isTeacherBlockedPage(active, effectiveRole)) {
      if (TEACHER_MODE_ELIGIBLE_ROLES.has(role)) {
        setRegionalMode("admin");
        window.location.reload();
        return;
      }
      window.clearTimeout(mountFailSafeTimer);
      document.body.style.opacity = "1";
      renderDenied();
      return;
    }
    const safeProfileName = typeof profileName === "string"
      ? profileName
      : (profileName == null ? "" : String(profileName));
    const profileInitial = (safeProfileName || "A").trim().charAt(0).toUpperCase();
    const pageTitle = options.pageTitle || document.title || "Admin";
    const badgeCounts = options.badgeCounts || {};

    const sidebar = document.createElement("aside");
    sidebar.className = "fs-shell sidebar";
    sidebar.id = "fs-admin-sb";
    sidebar.innerHTML = `
      <div class="sb-logo">
        <div class="sb-mark">RS</div>
        <div>
          <div class="sb-name">Rock Solid</div>
          <div class="sb-sub">Admin Portal</div>
        </div>
        <button class="sb-collapse-btn" id="fs-sidebar-toggle" type="button" aria-label="Toggle sidebar width" aria-pressed="false">&#8249;</button>
      </div>
      <nav class="sb-nav" aria-label="Admin navigation">
        ${buildSidebarHTML(active, badgeCounts, effectiveRole)}
      </nav>
      <div class="sb-footer">
        <a class="sb-link" href="${resolveLoginPath()}" id="fs-admin-logout">
          <span class="sb-icon">-></span> Sign Out
        </a>
      </div>
    `;

    const topbar = document.createElement("div");
    topbar.className = "fs-topbar topbar";
    topbar.id = "fs-admin-topbar";
    topbar.innerHTML = `
      <div class="fs-topbar-left breadcrumb">
        <button id="fs-hamburger" aria-label="Open menu" style="display:none;background:none;border:none;cursor:pointer;padding:8px;color:#4C2A92;font-size:20px;min-height:44px;align-items:center;justify-content:center;">☰</button>
        <span>${mode === "teacher" ? "Teacher" : "Admin"}</span>
        <span class="bc-sep">/</span>
        <span class="bc-now" id="fs-bc-now">${pageTitle}</span>
      </div>
      <div class="fs-topbar-right topbar-r">
        ${TEACHER_MODE_ELIGIBLE_ROLES.has(role) ? `
          <div id="fs-mode-switch" style="display:inline-flex;gap:6px;align-items:center;padding:3px;border:1px solid var(--line);border-radius:999px;background:var(--surface-2)">
            <button class="btn-out" id="fs-mode-admin" type="button" style="min-width:88px;height:30px;${mode === "admin" ? "background:var(--brand);color:#fff;border-color:var(--brand);" : ""}">Admin Mode</button>
            <button class="btn-out" id="fs-mode-teacher" type="button" style="min-width:96px;height:30px;${mode === "teacher" ? "background:var(--brand);color:#fff;border-color:var(--brand);" : ""}">Teacher Mode</button>
          </div>
        ` : ""}
        <span class="user-chip">
          <span class="user-av" id="fs-user-av">${profileInitial}</span>
          <span class="user-info">
            <span id="fs-user-name">${safeProfileName}</span>
            <span id="fs-user-role" class="user-role">${role.replace(/_/g, " ") || ""}</span>
          </span>
        </span>
        <button class="btn-out" id="fs-collapse-btn" aria-label="Toggle sidebar width" aria-pressed="false"><</button>
        <button class="ham" id="fs-ham" aria-label="Menu" aria-expanded="false">&#9776;</button>
      </div>
    `;

    const overlay = document.createElement("div");
    overlay.className = "s-ov";
    overlay.id = "fs-s-ov";
    const mobileBackdrop = document.createElement("div");
    mobileBackdrop.className = "fs-sidebar-backdrop";
    mobileBackdrop.id = "fs-sidebar-backdrop";

    document.body.prepend(mobileBackdrop);
    document.body.prepend(overlay);
    document.body.prepend(topbar);
    document.body.prepend(sidebar);
    document.body.classList.add("fs-shell-mounted");
    document.body.classList.add("fs-force-light");
    document.body.setAttribute("data-admin-mode", mode);
    window.clearTimeout(mountFailSafeTimer);
    document.body.style.opacity = "1";

    const mainEl = document.querySelector("main") || document.querySelector("[role='main']") || document.querySelector("#app");
    if (mainEl) {
      if (!mainEl.classList.contains("main")) mainEl.classList.add("main");
      if (!mainEl.classList.contains("fs-content")) mainEl.classList.add("fs-content");
      if (!mainEl.classList.contains("fs-shell-main")) mainEl.classList.add("fs-shell-main");
      window.setTimeout(function () { mainEl.classList.remove("fs-loading"); }, 60);
    }
    document.body.classList.remove("fs-nav-transitioning");
    try {
      if (sessionStorage.getItem("fs_nav_progress_pending") === "1") {
        completeProgressBar();
      }
    } catch (_) {}

    initTheme();
    initCollapsedState();

    const themeBtn = document.getElementById("fs-theme-btn");
    themeBtn && themeBtn.remove();

    const hamBtn = document.getElementById("fs-ham");
    const hamburgerBtn = document.getElementById("fs-hamburger");
    const collapseBtn = document.getElementById("fs-collapse-btn");
    const sidebarToggleBtn = document.getElementById("fs-sidebar-toggle");
    const sb = document.getElementById("fs-admin-sb");
    const ov = document.getElementById("fs-s-ov");

    function openSidebar() {
      sb.classList.add("open");
      ov.classList.add("show");
      document.body.classList.add("fs-sidebar-open");
      hamBtn && hamBtn.setAttribute("aria-expanded", "true");
    }

    function closeSidebar() {
      sb.classList.remove("open");
      ov.classList.remove("show");
      document.body.classList.remove("fs-sidebar-open");
      hamBtn && hamBtn.setAttribute("aria-expanded", "false");
    }

    hamBtn && hamBtn.addEventListener("click", function () {
      sb.classList.contains("open") ? closeSidebar() : openSidebar();
    });
    hamburgerBtn && hamburgerBtn.addEventListener("click", function () {
      document.body.classList.contains("fs-sidebar-open") ? closeSidebar() : openSidebar();
    });
    ov.addEventListener("click", closeSidebar);
    mobileBackdrop.addEventListener("click", closeSidebar);

    collapseBtn && collapseBtn.addEventListener("click", function () {
      const next = !document.body.classList.contains("fs-shell-collapsed");
      applyCollapsedState(next);
    });
    sidebarToggleBtn && sidebarToggleBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      const next = !document.body.classList.contains("fs-shell-collapsed");
      applyCollapsedState(next);
    });

    // Fail-safe: allow expanding/collapsing from sidebar itself if topbar control is missed.
    const sidebarLogo = sidebar.querySelector(".sb-logo");
    const sidebarMark = sidebar.querySelector(".sb-mark");
    function toggleCollapsedState() {
      const next = !document.body.classList.contains("fs-shell-collapsed");
      applyCollapsedState(next);
    }
    sidebarLogo && sidebarLogo.addEventListener("click", toggleCollapsedState);
    sidebarMark && sidebarMark.addEventListener("click", toggleCollapsedState);
    sidebar.addEventListener("dblclick", function () {
      if (document.body.classList.contains("fs-shell-collapsed")) applyCollapsedState(false);
    });

    const modeAdminBtn = document.getElementById("fs-mode-admin");
    const modeTeacherBtn = document.getElementById("fs-mode-teacher");
    function applyRegionalMode(nextMode) {
      const normalized = setRegionalMode(nextMode);
      const nextEffectiveRole = effectiveRoleFromMode(role, normalized);
      if (isTeacherBlockedPage(active, nextEffectiveRole)) {
        const p = window.location.pathname || "";
        const attendancePath = p.includes("/foundation/") ? "/foundation/staff/TeacherAttendancePortal.html" : "/staff/TeacherAttendancePortal.html";
        window.location.href = attendancePath;
        return;
      }
      window.location.reload();
    }
    modeAdminBtn && modeAdminBtn.addEventListener("click", function () { applyRegionalMode("admin"); });
    modeTeacherBtn && modeTeacherBtn.addEventListener("click", function () { applyRegionalMode("teacher"); });

    let lastMobile = window.innerWidth <= 768;
    window.addEventListener("resize", function () {
      const isMobile = window.innerWidth <= 768;
      if (isMobile) {
        document.body.classList.remove("fs-shell-collapsed");
        closeSidebar();
      } else if (isMobile !== lastMobile) {
        initCollapsedState();
      }
      lastMobile = isMobile;
    });

    const logoutLink = document.getElementById("fs-admin-logout");
    logoutLink && logoutLink.addEventListener("click", async function (e) {
      e.preventDefault();
      if (typeof options.onLogout === "function") {
        await options.onLogout();
      } else if (window.supabase && window.supabase.auth) {
        try { await window.supabase.auth.signOut(); } catch (_) {}
        window.location.href = resolveLoginPath();
      } else {
        window.location.href = resolveLoginPath();
      }
    });
    const frame = document.getElementById("fs-content-frame");
    const iframeShell = frame instanceof HTMLIFrameElement;
    const navByKey = new Map();
    sidebar.querySelectorAll(".sb-link[data-key]").forEach((a) => {
      if (!(a instanceof HTMLAnchorElement)) return;
      const key = String(a.dataset.key || "").trim();
      const href = String(a.getAttribute("href") || "").trim();
      if (key && href) navByKey.set(key, href);
    });

    function updateActiveNav(key) {
      sidebar.querySelectorAll(".sb-link[data-key]").forEach((a) => {
        const isActive = String(a.getAttribute("data-key") || "") === String(key || "");
        a.classList.toggle("active", isActive);
      });
    }

    function navigateTo(url, key, replaceState) {
      if (key) {
        const urlObj = new URL(window.location.href);
        urlObj.searchParams.set("page", key);
        const method = replaceState ? "replaceState" : "pushState";
        history[method]({ key, url }, "", urlObj.toString());
      }

      if (!iframeShell || !frame) {
        startShellTransition();
        window.setTimeout(function () {
          window.location.href = url;
        }, 140);
        return;
      }

      const main = document.querySelector(".fs-shell-main, .fs-content.main, main.main, main");
      if (main) main.classList.add("fs-loading");
      document.body.classList.add("fs-nav-transitioning");
      const bar = ensureProgressBar();
      bar.style.opacity = "1";
      bar.style.width = "70%";
      try { sessionStorage.setItem("fs_nav_progress_pending", "1"); } catch (_) {}

      frame.style.transition = "opacity 0.12s ease";
      frame.style.opacity = "0";

      window.setTimeout(function () {
        frame.onload = function () {
          frame.onload = null;
          if (main) main.classList.remove("fs-loading");
          updateActiveNav(key);
          completeProgressBar();
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              frame.style.transition = "opacity 0.18s ease";
              frame.style.opacity = "1";
            });
          });
        };
        frame.src = url;
      }, 130);
    }

    sidebar.querySelectorAll(".sb-link").forEach(function (link) {
      link.addEventListener("click", function (e) {
        const target = e.currentTarget;
        if (!(target instanceof HTMLAnchorElement)) return;
        if (target.id === "fs-admin-logout") return;
        const href = String(target.getAttribute("href") || "");
        const key = String(target.dataset.key || "");
        if (!href || href.startsWith("#") || target.target === "_blank") return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigateTo(href, key, false);
      });
    });

    if (iframeShell && frame) {
      const params = new URLSearchParams(window.location.search);
      const pageKey = params.get("page") || active || "dashboard";
      const initialUrl = navByKey.get(pageKey) || navByKey.get("dashboard");
      if (initialUrl) navigateTo(initialUrl, pageKey, true);

      window.addEventListener("popstate", function (e) {
        const stateData = e.state || {};
        if (stateData.url && stateData.key) {
          navigateTo(String(stateData.url), String(stateData.key), true);
          return;
        }
        const p = new URLSearchParams(window.location.search).get("page");
        const url = p ? navByKey.get(p) : null;
        if (url) navigateTo(url, p, true);
      });

      window.addEventListener("message", function (ev) {
        const payload = ev.data || {};
        if (payload.type !== "navigate") return;
        const key = String(payload.key || "").trim();
        const url = key ? navByKey.get(key) : null;
        if (url) navigateTo(url, key, false);
      });
    }

    // Regional secretary teacher-mode scope: persist linked teacher identity for staff teacher pages.
    (async function () {
      try {
        if (!TEACHER_MODE_ELIGIBLE_ROLES.has(role) || mode !== "teacher") return;
        const { getCurrentProfile: getProf, getLinkedTeacherRecord } = await import("../auth/auth-client.js");
        const prof = await getProf();
        if (!prof?.email) return;
        const teacherRec = await getLinkedTeacherRecord(prof.email);
        if (!teacherRec) return;
        setRegionalTeacherScope({
          mode: "teacher",
          role,
          email: String(teacherRec.email || prof.email || "").trim().toLowerCase(),
          teacherId: String(teacherRec.teacher_id || "").trim(),
          fullName: String(teacherRec.full_name || "").trim(),
          ts: new Date().toISOString(),
        });
      } catch (_) {}
    })();

    // Notification bell — mounted after shell is in DOM
    (async function () {
      try {
        const [{ NotificationBell }, { supabase: sb, getCurrentProfile }] = await Promise.all([
          import("../ui/notification-bell.js"),
          import("../auth/auth-client.js"),
        ]);
        const profile = await getCurrentProfile();
        if (!profile) return;
        const topbarR = document.querySelector(".fs-topbar-right");
        if (!topbarR) return;
        const bellContainer = document.createElement("div");
        bellContainer.id = "fs-notif-bell";
        topbarR.insertBefore(bellContainer, topbarR.querySelector(".btn-out") || topbarR.firstChild);
        new NotificationBell({ supabase: sb, profile, container: bellContainer });
      } catch (_) {}
    })();

    // "Switch to Teacher Portal" link — only shown if the admin user has a linked teacher record
    (async function () {
      try {
        const { getLinkedTeacherRecord, getCurrentProfile: getProf } = await import("../auth/auth-client.js");
        const prof = await getProf();
        if (!prof?.email) return;
        if (String(prof?.role || "").toLowerCase() === "regional_secretary") return;
        const teacherRec = await getLinkedTeacherRecord(prof.email);
        if (!teacherRec) return;
        const p = window.location.pathname || "";
        const teacherPath = p.includes("/foundation/") ? "/foundation/teacher/index.html" : "/teacher/index.html";
        const sbFooter = document.querySelector("#fs-admin-sb .sb-footer");
        if (!sbFooter) return;
        const link = document.createElement("a");
        link.href = teacherPath;
        link.className = "sb-link";
        link.id = "fs-teacher-portal-link";
        link.title = "Teacher Mode";
        link.innerHTML = '<span class="sb-icon">T</span> Teacher Mode';
        const logoutLink = document.getElementById("fs-admin-logout");
        if (logoutLink) {
          sbFooter.insertBefore(link, logoutLink);
        } else {
          sbFooter.appendChild(link);
        }
      } catch (_) {}
    })();
  };

  Shell.setProfile = function (nameOrObj, initial) {
    const av   = document.getElementById("fs-user-av");
    const nm   = document.getElementById("fs-user-name");
    const rl   = document.getElementById("fs-user-role");
    const isObj = nameOrObj !== null && typeof nameOrObj === "object";
    const name  = isObj ? (nameOrObj.profileName || nameOrObj.name || "") : nameOrObj;
    const roleVal = isObj ? (nameOrObj.role || "") : "";
    const safeName = typeof name === "string" ? name : String(name ?? "");
    if (av) av.textContent = initial || (safeName || "?").charAt(0).toUpperCase();
    if (nm) nm.textContent = safeName;
    if (rl && roleVal) rl.textContent = String(roleVal).replace(/_/g, " ");
  };

  Shell.setPageTitle = function (title) {
    const el = document.getElementById("fs-bc-now");
    if (el) el.textContent = title || "";
  };

  Shell.setBadge = function (key, count) {
    const link = document.querySelector(`.sb-link[data-key="${key}"]`);
    if (!link) return;
    let badge = link.querySelector(".sb-badge");
    if (count) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "sb-badge";
        badge.style.background = "var(--amber)";
        link.appendChild(badge);
      }
      badge.textContent = count;
    } else if (badge) {
      badge.remove();
    }
  };
})();

