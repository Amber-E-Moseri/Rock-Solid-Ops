(function () {
  const Shell = (window.FSTeacherShell = window.FSTeacherShell || {});
  let mounted = false;

  function pageHref(key) {
    const map = {
      classes: "../teacher/index.html",
      availability: "../teacher/teacher-availability.html",
      progress: "../teacher/teacher-progress.html",
      attendance: "../teacher/teacher-attendance.html",
    };
    return map[key] || "../teacher/index.html";
  }

  function activeKeyFromPath() {
    const path = String(window.location.pathname || "").toLowerCase();
    if (path.includes("teacher-availability")) return "availability";
    if (path.includes("teacher-progress")) return "progress";
    return "classes";
  }

  async function resolveIdentity() {
    try {
      const auth = await import("../auth/auth-client.js");
      const session = await auth.getSessionOrNull();
      const profile = await auth.getCurrentProfile();
      const email = String(profile?.email || session?.user?.email || "").trim();
      const uid = String(profile?.user_id || session?.user?.id || "").trim();

      let teacherName = "";
      if (uid || email) {
        let q = auth.supabase
          .from("teachers")
          .select("full_name,email")
          .is("deleted_at", null)
          .limit(1);
        if (uid) q = q.eq("teacher_user_id", uid);
        else q = q.eq("email", email);
        const { data } = await q.maybeSingle();
        teacherName = String(data?.full_name || "").trim();
      }

      const fullName =
        teacherName ||
        String(profile?.full_name || "").trim() ||
        String(session?.user?.user_metadata?.full_name || "").trim() ||
        email ||
        "Teacher";
      return { fullName, email, supabase: auth.supabase };
    } catch (_) {
      return { fullName: "Teacher", email: "", supabase: null };
    }
  }

  function injectStyles() {
    if (document.getElementById("fs-teacher-shell-styles")) return;
    const style = document.createElement("style");
    style.id = "fs-teacher-shell-styles";
    style.textContent = `
      :root {
        --tp-bg:#f6f3ff;
        --tp-surface:#ffffff;
        --tp-border:#e6def8;
        --tp-text:#16122b;
        --tp-muted:#6f688b;
        --tp-primary:#5631a7;
        --tp-primary-2:#6c46c8;
        --tp-green:#16a34a;
        --tp-green-bg:#e9f8ef;
        --tp-orange:#d97706;
        --tp-orange-bg:#fff2d9;
        --tp-red:#ef4444;
        --tp-red-bg:#feecec;
        --tp-shadow:0 16px 40px rgba(78, 48, 150, .08);
      }
      body.fs-teacher-shell-body {
        margin:0;
        background:var(--tp-bg);
        color:var(--tp-text);
        font-family:"Manrope",system-ui,-apple-system,sans-serif;
      }
      .fs-teacher-shell {
        position:sticky;
        top:0;
        z-index:200;
        background:rgba(255,255,255,.96);
        backdrop-filter:blur(12px);
        border-bottom:1px solid var(--tp-border);
      }
      .fs-teacher-shell__top,
      .fs-teacher-shell__nav {
        max-width:1360px;
        margin:0 auto;
        padding:16px 28px 0;
      }
      .fs-teacher-shell__top {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:16px;
        padding-bottom:12px;
      }
      .fs-teacher-shell__brand {
        display:flex;
        align-items:center;
        gap:16px;
        min-width:0;
      }
      .fs-teacher-shell__logo {
        width:44px;
        height:44px;
        border-radius:14px;
        display:grid;
        place-items:center;
        background:linear-gradient(135deg,var(--tp-primary-2),var(--tp-primary));
        color:#fff;
        font-weight:800;
        box-shadow:0 12px 24px rgba(86,49,167,.22);
        flex:0 0 auto;
      }
      .fs-teacher-shell__title {
        font-size:17px;
        font-weight:800;
      }
      .fs-teacher-shell__badge {
        margin-left:10px;
        display:inline-flex;
        align-items:center;
        padding:6px 11px;
        border-radius:999px;
        background:#efe8ff;
        color:var(--tp-primary);
        font-size:12px;
        font-weight:800;
        letter-spacing:.04em;
      }
      .fs-teacher-shell__actions {
        display:flex;
        align-items:center;
        gap:14px;
        flex:0 0 auto;
      }
      .fs-teacher-shell__admin {
        min-height:44px;
        padding:0 18px;
        border-radius:16px;
        border:1px solid var(--tp-border);
        background:#fff;
        color:var(--tp-text);
        font:700 14px/1 "Manrope",sans-serif;
        cursor:pointer;
      }
      .fs-teacher-shell__avatar {
        width:46px;
        height:46px;
        border-radius:50%;
        background:#e9edff;
        color:#4e5fc5;
        display:grid;
        place-items:center;
        font-weight:800;
      }
      .fs-teacher-shell__nav {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:16px;
        padding-top:0;
      }
      .fs-teacher-shell__links {
        display:flex;
        align-items:center;
        gap:6px;
      }
      .fs-teacher-shell__link {
        position:relative;
        display:inline-flex;
        align-items:center;
        gap:10px;
        min-height:52px;
        padding:0 18px;
        color:var(--tp-muted);
        text-decoration:none;
        font-weight:700;
        font-size:15px;
      }
      .fs-teacher-shell__link.active {
        color:var(--tp-primary);
      }
      .fs-teacher-shell__link.active::after {
        content:"";
        position:absolute;
        left:0;
        right:0;
        bottom:0;
        height:3px;
        border-radius:999px 999px 0 0;
        background:var(--tp-primary);
      }
      .fs-teacher-shell__icon {
        width:18px;
        text-align:center;
        opacity:.8;
      }
      .fs-teacher-shell__close {
        width:62px;
        height:62px;
        border:none;
        border-radius:50%;
        background:#66656d;
        color:#fff;
        font-size:36px;
        line-height:1;
        cursor:pointer;
        flex:0 0 auto;
      }
      .fs-teacher-shell__close:hover { background:#56545d; }
      .fs-teacher-page {
        max-width:1360px;
        margin:0 auto;
        padding:38px 28px 56px;
      }
      @media (max-width: 900px) {
        .fs-teacher-shell__top,
        .fs-teacher-shell__nav,
        .fs-teacher-page { padding-left:16px; padding-right:16px; }
        .fs-teacher-shell__nav { flex-direction:column; align-items:flex-start; }
        .fs-teacher-shell__actions { gap:10px; }
      }
      @media (max-width: 720px) {
        .fs-teacher-shell__top { flex-wrap:wrap; }
        .fs-teacher-shell__links { width:100%; overflow:auto; }
        .fs-teacher-shell__link { padding:0 14px; font-size:14px; }
        .fs-teacher-shell__close { width:52px; height:52px; font-size:30px; }
      }
    `;
    document.head.appendChild(style);
  }

  Shell.mount = function mount(opts) {
    if (mounted) return;
    opts = opts || {};
    const active = opts.active || activeKeyFromPath();
    injectStyles();
    document.body.classList.add("fs-teacher-shell-body");

    const shell = document.createElement("header");
    shell.className = "fs-teacher-shell";
    shell.innerHTML = `
      <div class="fs-teacher-shell__top">
        <div class="fs-teacher-shell__brand">
          <div class="fs-teacher-shell__logo">R</div>
          <div>
            <div class="fs-teacher-shell__title">RockSolid OPS <span class="fs-teacher-shell__badge">TEACHER</span></div>
          </div>
        </div>
        <button class="fs-teacher-shell__close" type="button" aria-label="Close">×</button>
        <div class="fs-teacher-shell__actions">
          <button class="fs-teacher-shell__admin" type="button">Admin view →</button>
          <div class="fs-teacher-shell__avatar" id="fsTeacherAvatar">T</div>
        </div>
      </div>
      <div class="fs-teacher-shell__nav">
        <nav class="fs-teacher-shell__links">
          <a class="fs-teacher-shell__link ${active === "classes" ? "active" : ""}" href="${pageHref("classes")}"><span class="fs-teacher-shell__icon">▣</span><span>My classes</span></a>
          <a class="fs-teacher-shell__link ${active === "availability" ? "active" : ""}" href="${pageHref("availability")}"><span class="fs-teacher-shell__icon">◔</span><span>My availability</span></a>
          <a class="fs-teacher-shell__link ${active === "progress" ? "active" : ""}" href="${pageHref("progress")}"><span class="fs-teacher-shell__icon">▥</span><span>Student progress</span></a>
        </nav>
      </div>
    `;
    document.body.prepend(shell);

    shell.querySelector(".fs-teacher-shell__close")?.addEventListener("click", () => {
      history.back();
    });
    shell.querySelector(".fs-teacher-shell__admin")?.addEventListener("click", () => {
      window.location.href = "../staff/dashboards.html";
    });

    resolveIdentity().then(({ fullName, supabase }) => {
      const avatar = document.getElementById("fsTeacherAvatar");
      if (avatar) {
        const initials = String(fullName || "Teacher")
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase() || "")
          .join("") || "T";
        avatar.textContent = initials;
      }
      window.FSTeacherShell.identity = { fullName };
      window.FSTeacherShell.signOut = async function signOut() {
        try { await supabase?.auth?.signOut(); } catch (_) {}
        window.location.href = "../auth/login.html";
      };
    });

    shell.querySelectorAll(".fs-teacher-shell__link").forEach((link) => {
      link.addEventListener("click", () => {
        document.body.style.opacity = "0.985";
      });
    });
    mounted = true;
  };
})();
