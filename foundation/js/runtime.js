/**
 * FSRuntime — centralized runtime reliability and auth consistency helpers.
 *
 * Loaded as a plain <script> before any module scripts so it is available
 * globally as window.FSRuntime. Compatible with both script-tag pages and
 * ES-module pages that import from auth-client.js.
 *
 * Usage:
 *   <script src="../js/runtime.js"></script>
 *
 * Then in any inline or module script:
 *   const session = await FSRuntime.requireAuth(supabase);
 *   await FSRuntime.withLoading(setLoadingFn, () => fetchData());
 *   FSRuntime.renderEmptyState(document.getElementById('list'), 'applicants');
 */
(function () {
  const RT = (window.FSRuntime = window.FSRuntime || {});

  const QUERY_TIMEOUT_MS = 15_000;
  const DEFAULT_REDIRECT = 'login.html';
  RT.resolveAppPath = function (relativePath) {
    const clean = String(relativePath || "").replace(/^\/+/, "");
    const p = window.location.pathname || "";
    if (p.includes("/foundation/")) return `/foundation/${clean}`;
    return `/${clean}`;
  };
  RT.resolveLoginUrl = function () {
    const p = window.location.pathname || "";
    if (p.includes("/staff/") || p.includes("/auth/") || p.includes("/teacher/")) {
      return RT.resolveAppPath("auth/login.html");
    }
    return DEFAULT_REDIRECT;
  };

  // ─── Timeout wrapper ────────────────────────────────────────────────────────
  // Races a promise against a hard timeout so queries can never hang forever.
  RT.withTimeout = function (promise, ms, label) {
    ms = ms !== undefined ? ms : QUERY_TIMEOUT_MS;
    label = label || 'Request';
    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () {
        reject(new Error(label + ' timed out after ' + Math.round(ms / 1000) + 's'));
      }, ms);
      promise.then(
        function (v) { clearTimeout(timer); resolve(v); },
        function (e) { clearTimeout(timer); reject(e); }
      );
    });
  };

  // ─── Loading wrapper ─────────────────────────────────────────────────────────
  // Guarantees setFn(false) runs in finally even when asyncFn throws or times out.
  RT.withLoading = async function (setFn, asyncFn) {
    try {
      setFn(true);
      return await asyncFn();
    } finally {
      setFn(false);
    }
  };

  // ─── Error classification ────────────────────────────────────────────────────
  RT.classifyError = function (err) {
    const msg = String(err?.message || err?.error_description || err?.error || err || '');
    const code = String(err?.code || err?.status || '');
    const lower = msg.toLowerCase();
    const isAuth =
      code === '401' ||
      code === 'PGRST301' ||
      lower.includes('jwt') ||
      lower.includes('not authenticated') ||
      lower.includes('token is expired') ||
      lower.includes('invalid session') ||
      lower.includes('session_not_found');
    const isNetwork =
      lower.includes('failed to fetch') ||
      lower.includes('networkerror') ||
      lower.includes('network request failed');
    const isTimeout = lower.includes('timed out');
    const isMissing =
      code === '42P01' ||
      lower.includes('does not exist') ||
      lower.includes('relation');
    return {
      message: msg || 'Unexpected error',
      isAuth,
      isNetwork,
      isTimeout,
      isMissing,
    };
  };

  // ─── Auth expiration handler ─────────────────────────────────────────────────
  RT.handleAuthExpiration = function (redirectUrl) {
    redirectUrl = redirectUrl || RT.resolveLoginUrl();
    if (window.FSToast?.show) {
      window.FSToast.show('Your session has expired. Redirecting to sign-in…', 'error', 4000);
    }
    setTimeout(function () { window.location.href = redirectUrl; }, 1500);
  };

  // ─── Supabase error handler ──────────────────────────────────────────────────
  // Classifies the error, shows a toast, and auto-redirects on auth expiry.
  RT.handleSupabaseError = function (err, context) {
    const info = RT.classifyError(err);
    const prefix = context ? '[' + context + '] ' : '';
    console.error(prefix + 'Supabase error:', err);
    if (info.isAuth) {
      RT.handleAuthExpiration();
      return info;
    }
    if (window.FSToast?.show) {
      const type = info.isNetwork || info.isTimeout ? 'warning' : 'error';
      window.FSToast.show(prefix + info.message, type, 4500);
    }
    return info;
  };

  // ─── Safe async ──────────────────────────────────────────────────────────────
  // opts: { timeout, label, onError, rethrow }
  // Returns null on error unless rethrow:true.
  RT.safeAsync = async function (fn, opts) {
    opts = opts || {};
    const ms = opts.timeout !== undefined ? opts.timeout : QUERY_TIMEOUT_MS;
    const label = opts.label || 'Operation';
    try {
      return await RT.withTimeout(fn(), ms, label);
    } catch (err) {
      if (typeof opts.onError === 'function') {
        opts.onError(err);
      } else {
        RT.handleSupabaseError(err, label);
      }
      if (opts.rethrow) throw err;
      return null;
    }
  };

  // ─── requireAuth ─────────────────────────────────────────────────────────────
  // Reads the current session. Returns the session object or redirects to login.
  RT.requireAuth = async function (supabaseClient, redirectUrl) {
    redirectUrl = redirectUrl || RT.resolveLoginUrl();
    try {
      const { data, error } = await RT.withTimeout(
        supabaseClient.auth.getSession(),
        8000,
        'Auth session'
      );
      if (error || !data?.session) {
        window.location.href = redirectUrl;
        return null;
      }
      return data.session;
    } catch (err) {
      console.error('[FSRuntime.requireAuth]', err);
      window.location.href = redirectUrl;
      return null;
    }
  };

  // ─── requireRole ─────────────────────────────────────────────────────────────
  // allowed: Set | string[] | string
  // opts: { redirectUrl, containerEl, message }
  // Returns true if role passes; false and renders unauthorized state otherwise.
  RT.requireRole = function (profile, allowed, opts) {
    opts = opts || {};
    const roles =
      allowed instanceof Set
        ? allowed
        : new Set(Array.isArray(allowed) ? allowed : [allowed]);
    if (!profile || !roles.has(String(profile.role || ''))) {
      if (opts.containerEl) {
        opts.containerEl.innerHTML = RT._unauthorizedHtml(opts.message);
      } else if (opts.redirectUrl) {
        window.location.href = opts.redirectUrl;
      }
      return false;
    }
    return true;
  };

  RT._unauthorizedHtml = function (msg) {
    const loginHref = RT.resolveLoginUrl();
    return (
      '<div style="display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;min-height:280px;gap:16px;padding:48px 24px;text-align:center;">' +
      '<div style="font-size:40px;">🔒</div>' +
      '<h2 style="margin:0;font-size:20px;font-weight:800;color:var(--text,#261f35)">Access Denied</h2>' +
      '<p style="margin:0;color:var(--muted,#6f6881);max-width:320px;line-height:1.6;">' +
      (msg || 'Your account does not have permission to view this page.') +
      '</p>' +
      '<a href="' + loginHref + '" style="display:inline-flex;align-items:center;gap:6px;padding:10px 20px;' +
      'border-radius:12px;background:var(--brand,#5b3fa5);color:#fff;font-weight:700;' +
      'font-size:14px;text-decoration:none;">Sign in with a different account</a>' +
      '</div>'
    );
  };

  // ─── Empty state configs ─────────────────────────────────────────────────────
  const EMPTY_CONFIGS = {
    batches:      { emoji: '🌱', title: 'No batches yet',          body: 'Create your first batch to start coordinating registrations.' },
    applicants:   { emoji: '🎓', title: 'No applicants found',     body: 'Try adjusting your filters, or no applications have been submitted yet.' },
    notifications:{ emoji: '🔔', title: 'No notifications',        body: 'Notification queue is empty — nothing pending or failed.' },
    'audit-logs': { emoji: '📋', title: 'No audit activity',       body: 'No logged events match the current filters.' },
    'failed-syncs':{ emoji: '✅', title: 'All caught up',          body: 'All queues are healthy — no pending failures to retry.' },
    attendance:   { emoji: '📅', title: 'No attendance records',   body: 'No attendance data found for this selection.' },
    schedules:    { emoji: '🗓️', title: 'No schedules found',      body: 'No schedule entries available for the current filters.' },
    generic:      { emoji: '📭', title: 'Nothing here',            body: 'No records match the current criteria.' },
  };

  // Returns an HTML string for an empty state panel.
  // opts: { emoji, title, body, actionLabel, actionId }
  RT.emptyState = function (type, opts) {
    opts = opts || {};
    const cfg = EMPTY_CONFIGS[type] || EMPTY_CONFIGS.generic;
    const emoji = opts.emoji || cfg.emoji;
    const title = opts.title || cfg.title;
    const body  = opts.body  || cfg.body;
    const action = opts.actionLabel
      ? '<button class="btn btn-primary"' +
        (opts.actionId ? ' id="' + opts.actionId + '"' : '') +
        ' style="margin-top:4px;">' + opts.actionLabel + '</button>'
      : '';
    return (
      '<div class="fs-empty-state" style="padding:44px 16px;text-align:center;' +
      'color:var(--muted,#6f6881);">' +
      '<div style="font-size:38px;margin-bottom:8px;">' + emoji + '</div>' +
      '<h3 style="margin:0 0 6px;font-size:16px;font-weight:700;' +
      'color:var(--text,#261f35);">' + title + '</h3>' +
      '<p style="margin:0 0 14px;font-size:13px;line-height:1.6;">' + body + '</p>' +
      action +
      '</div>'
    );
  };

  // Renders an empty state directly into el.
  RT.renderEmptyState = function (el, type, opts) {
    if (!el) return;
    el.innerHTML = RT.emptyState(type, opts);
    el.style.display = '';
  };

  // ─── Query error state renderer ──────────────────────────────────────────────
  // Renders a user-visible error panel into el.
  // opts: { title, body, onRetry }
  RT.showQueryError = function (el, err, opts) {
    opts = opts || {};
    if (!el) return;
    const info = RT.classifyError(err);
    const icon  = info.isNetwork || info.isTimeout ? '📡' : '⚠️';
    const title = opts.title || (info.isTimeout ? 'Request Timed Out' : info.isNetwork ? 'Connection Problem' : 'Failed to Load');
    const body  = opts.body  || info.message;
    const retryBtn = opts.onRetry
      ? '<button class="btn btn-ghost" data-fs-retry style="margin-top:8px;">Try Again</button>'
      : '';
    el.innerHTML = (
      '<div class="fs-error-state" style="padding:36px 16px;text-align:center;' +
      'color:var(--muted,#6f6881);">' +
      '<div style="font-size:32px;margin-bottom:8px;">' + icon + '</div>' +
      '<h3 style="margin:0 0 6px;font-size:15px;font-weight:700;' +
      'color:var(--bad-fg,#991b1b);">' + title + '</h3>' +
      '<p style="margin:0 0 10px;font-size:13px;line-height:1.5;">' + body + '</p>' +
      retryBtn +
      '</div>'
    );
    el.style.display = '';
    if (opts.onRetry) {
      const btn = el.querySelector('[data-fs-retry]');
      if (btn) btn.addEventListener('click', opts.onRetry);
    }
  };

  // ─── Skeleton loader ─────────────────────────────────────────────────────────
  // Injects shimmer skeleton rows into el while real data loads.
  RT.showSkeleton = function (el, count, height) {
    if (!el) return;
    height = height || '70px';
    // Inject keyframes once
    if (!document.getElementById('fs-shimmer-style')) {
      const s = document.createElement('style');
      s.id = 'fs-shimmer-style';
      s.textContent =
        '@keyframes fs-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}';
      document.head.appendChild(s);
    }
    const items = Array.from({ length: count || 3 }, function () {
      return (
        '<div style="height:' + height + ';border-radius:12px;' +
        'background:linear-gradient(100deg,transparent 30%,' +
        'color-mix(in srgb,var(--brand,#5b3fa5),transparent 88%) 50%,' +
        'transparent 70%) var(--surface-2,#faf7f2);' +
        'background-size:220% 100%;animation:fs-shimmer 1.1s infinite;' +
        'margin-bottom:10px;border:1px solid var(--border,#e8dfd0)"></div>'
      );
    }).join('');
    el.innerHTML = items;
    el.style.display = '';
  };

  // ─── Toast convenience shims ─────────────────────────────────────────────────
  // Thin wrappers so callers don't need to check FSToast existence each time.
  RT.toast = {
    info:    function (msg, ttl) { window.FSToast?.show(msg, 'info',    ttl || 3200); },
    success: function (msg, ttl) { window.FSToast?.show(msg, 'success', ttl || 3200); },
    warning: function (msg, ttl) { window.FSToast?.show(msg, 'warning', ttl || 4000); },
    error:   function (msg, ttl) { window.FSToast?.show(msg, 'error',   ttl || 4500); },
  };

  // Global production-safe runtime handlers so pages fail visibly instead of silently.
  // Benign browser/extension noise that should never surface a toast.
  const BENIGN_ERROR_RX = /ResizeObserver loop|ResizeObserver undelivered|^Script error\.?$|extension context invalidated/i;
  window.addEventListener("error", function (event) {
    const err = event?.error || event?.message || "Unknown runtime error";
    if (BENIGN_ERROR_RX.test(String(event?.message || err))) return;
    console.error("[FSRuntime.global.error]", err);
    // Defer so page-level handlers registered after this one can claim the
    // event via preventDefault() and show their own UI instead.
    setTimeout(function () {
      if (event.defaultPrevented) return;
      RT.toast?.error?.("A runtime error occurred. Please refresh the page.");
    }, 0);
  });
  window.addEventListener("unhandledrejection", function (event) {
    const reason = event?.reason || "Unhandled promise rejection";
    console.error("[FSRuntime.global.unhandledrejection]", reason);
    setTimeout(function () {
      if (event.defaultPrevented) return;
      RT.toast?.error?.("A background request failed. Please retry.");
    }, 0);
  });
})();
