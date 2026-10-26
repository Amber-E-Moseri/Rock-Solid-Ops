/**
 * NotificationBell — in-app notification bell component.
 * Usage: new NotificationBell({ supabase, profile, container })
 */
export class NotificationBell {
  constructor({ supabase, profile, container }) {
    this._sb          = supabase;
    this._profile     = profile;
    this._notifications = [];
    this._unread      = 0;
    this._open        = false;
    this._container   = container;
    this._channel     = null;
    this._render();
    this._load();
    this._subscribe();
  }

  async _load() {
    const { data } = await this._sb
      .from("in_app_notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    this._notifications = data || [];
    this._unread = this._notifications.filter((n) => !n.read).length;
    this._render();
  }

  async _markAllRead() {
    const uid  = this._profile?.user_id;
    const role = this._profile?.role;
    if (!uid) return;
    await this._sb
      .from("in_app_notifications")
      .update({ read: true })
      .or(
        `recipient_user_id.eq.${uid},and(recipient_user_id.is.null,recipient_role.eq.${role})`,
      )
      .eq("read", false);
    this._notifications.forEach((n) => { n.read = true; });
    this._unread = 0;
    this._render();
  }

  _subscribe() {
    const uid  = this._profile?.user_id;
    const role = this._profile?.role;
    this._channel = this._sb
      .channel("nb_" + (uid || "anon"))
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "in_app_notifications" },
        (payload) => {
          const n = payload.new;
          const relevant =
            n.recipient_user_id === uid ||
            (n.recipient_user_id === null && n.recipient_role === role);
          if (!relevant) return;
          this._notifications.unshift(n);
          if (!n.read) this._unread++;
          this._render();
        },
      )
      .subscribe();
  }

  _timeAgo(iso) {
    const secs = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (secs < 60)    return "just now";
    if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    return `${Math.floor(secs / 86400)}d ago`;
  }

  _esc(v) {
    return String(v ?? "").replace(/[&<>'"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  }

  _typeColor(type) {
    return { info: "#3b82f6", success: "#22c55e", warning: "#f59e0b", error: "#ef4444" }[type] || "#3b82f6";
  }

  _render() {
    const badge = this._unread > 0
      ? `<span style="position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;background:#ef4444;color:#fff;border-radius:999px;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 4px;line-height:1;">${this._unread > 99 ? "99+" : this._unread}</span>`
      : "";

    const notifRows = this._notifications.map((n) => `
      <div ${n.action_url ? `data-nb-url="${this._esc(n.action_url)}"` : ""}
           style="padding:10px 14px;border-bottom:1px solid #f0f0f4;border-left:3px solid ${this._typeColor(n.type)};opacity:${n.read ? 0.6 : 1};cursor:${n.action_url ? "pointer" : "default"};">
        <div style="font-size:13px;font-weight:700;color:#1a1a2e;">${this._esc(n.title)}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:2px;">${this._esc(n.body)}</div>
        <div style="font-size:11px;color:#9ca3af;margin-top:3px;">${this._timeAgo(n.created_at)}</div>
      </div>
    `).join("");

    const empty = `<div style="padding:24px;text-align:center;color:#9ca3af;font-size:13px;">No notifications yet.</div>`;

    this._container.innerHTML = `
      <div style="position:relative;display:inline-flex;align-items:center;">
        <button id="nb-btn" aria-label="Notifications"
          style="position:relative;width:36px;height:36px;border-radius:10px;border:1px solid var(--color-border,#e2e8f0);background:var(--color-surface,#fff);cursor:pointer;display:grid;place-items:center;font-size:17px;padding:0;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path></svg>${badge}
        </button>
        <div id="nb-panel"
          style="display:${this._open ? "flex" : "none"};flex-direction:column;position:absolute;right:0;top:42px;width:320px;max-height:400px;background:var(--color-surface,#fff);border:1px solid var(--color-border,#e2e8f0);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.15);z-index:9999;overflow:hidden;">
          <div style="padding:10px 14px;border-bottom:1px solid var(--color-border,#e8e8f0);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
            <strong style="font-size:13px;color:#1a1a2e;">Notifications${this._unread > 0 ? ` (${this._unread})` : ""}</strong>
            <button id="nb-mark-read" style="font-size:12px;color:var(--color-primary,#4C2A92);background:none;border:none;cursor:pointer;font-weight:600;padding:0;">Mark all read</button>
          </div>
          <div style="overflow-y:auto;max-height:346px;">
            ${this._notifications.length ? notifRows : empty}
          </div>
        </div>
      </div>
    `;

    const btn       = this._container.querySelector("#nb-btn");
    const panel     = this._container.querySelector("#nb-panel");
    const markRead  = this._container.querySelector("#nb-mark-read");

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this._open = !this._open;
      panel.style.display = this._open ? "flex" : "none";
    });

    markRead?.addEventListener("click", (e) => {
      e.stopPropagation();
      this._markAllRead();
    });

    this._container.querySelectorAll("[data-nb-url]").forEach((el) => {
      el.addEventListener("click", () => {
        window.location.href = el.getAttribute("data-nb-url");
      });
    });

    // One-time outside-click handler; re-registered on each render.
    const onOutside = (e) => {
      if (!this._container.contains(e.target)) {
        this._open = false;
        if (panel) panel.style.display = "none";
      }
    };
    document.removeEventListener("click", this._outsideHandler);
    this._outsideHandler = onOutside;
    document.addEventListener("click", onOutside);
  }
}

if (typeof window !== "undefined") window.NotificationBell = NotificationBell;
