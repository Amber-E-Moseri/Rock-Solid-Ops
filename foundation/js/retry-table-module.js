(function attachRetryTableModule(global) {
  /**
   * @typedef {{
   *   sources: Array<{ id: string, label: string, load: () => Promise<object[]> }>,
   *   columns: Array<{ key: string, label: string, render?: (val: any, row: object) => string }>,
   *   actions: {
   *     retry: (row: object) => Promise<void>,
   *     resolve: (row: object) => Promise<void>,
   *     bulk: (action: string, rows: object[]) => Promise<void>
   *   },
   *   filters: { status: boolean, type: boolean, date: boolean, search: boolean },
   *   statusClass: (status: string) => string,
   *   typeBadge: (type: string) => string,
   *   pageSize?: number,
   *   ids: Record<string, string>,
   *   renderSummary?: (state: object) => void,
   *   renderDetails?: (row: object|null) => void,
   *   onError?: (message: string) => void
   * }} RetryTableConfig
   */
  function initRetryTable(config) {
    const ui = global.FSAdminUi;
    const api = global.FSAdminApi;
    const state = {
      rows: [],
      filtered: [],
      selected: new Set(),
      page: 1,
      busy: false,
      detailsOpen: null,
      filters: { status: "", type: "", date: "", search: "" },
    };
    const pageSize = Number(config.pageSize || 25);
    const esc = (v) => (ui?.esc ? ui.esc(v) : String(v ?? ""));
    const $ = (k) => document.getElementById(config.ids[k] || k);

    function ymd(v) {
      if (!v) return "";
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return "";
      return d.toISOString().slice(0, 10);
    }

    function applyFilters() {
      const q = String(state.filters.search || "").trim().toLowerCase();
      state.filtered = state.rows.filter((r) => {
        if (config.filters.status && state.filters.status && String(r.status || "").toUpperCase() !== state.filters.status) return false;
        if (config.filters.type && state.filters.type && String(r.type || "").toLowerCase() !== state.filters.type) return false;
        if (config.filters.date && state.filters.date && ymd(r.created_at || r.createdAt || r.updated_at || r.lastAttemptedAt) !== state.filters.date) return false;
        if (config.filters.search && q) {
          const hay = JSON.stringify(r).toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      const max = Math.max(1, Math.ceil(state.filtered.length / pageSize));
      state.page = Math.min(state.page, max);
    }

    function renderTable() {
      const tbody = $("rows");
      if (!tbody) return;
      const start = (state.page - 1) * pageSize;
      const rows = state.filtered.slice(start, start + pageSize);
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="${config.columns.length + 2}" class="state-cell">No records found.</td></tr>`;
        return;
      }
      const readOnly = config.readOnly === true;
      tbody.innerHTML = rows.map((r) => {
        const key = `${r.source}:${r.id}`;
        const cells = config.columns.map((c) => {
          const raw = r[c.key];
          const val = typeof c.render === "function" ? c.render(raw, r) : esc(raw ?? "—");
          return `<td>${val}</td>`;
        }).join("");
        return `<tr>
          <td><input type="checkbox" data-key="${esc(key)}" ${state.selected.has(key) ? "checked" : ""}></td>
          ${cells}
          <td>
            <div class="actions">
              ${readOnly
                ? `<button class="btn btn-xs" data-act="details" data-source="${esc(r.source)}" data-id="${esc(r.id)}">Details</button>`
                : `<button class="btn btn-xs" data-act="retry" data-source="${esc(r.source)}" data-id="${esc(r.id)}">Retry</button>
                   ${r.source === "email_queue" ? "" : `<button class="btn btn-xs" data-act="resolve" data-source="${esc(r.source)}" data-id="${esc(r.id)}">Resolve</button>`}
                   <button class="btn btn-xs" data-act="details" data-source="${esc(r.source)}" data-id="${esc(r.id)}">Details</button>`}
            </div>
          </td>
        </tr>`;
      }).join("");
      const pageInfo = $("pageInfo");
      if (pageInfo) {
        const max = Math.max(1, Math.ceil(state.filtered.length / pageSize));
        pageInfo.textContent = `Page ${state.page} of ${max}`;
      }
      const rowCount = $("rowCount");
      if (rowCount) rowCount.textContent = `${state.filtered.length} rows`;
    }

    function renderAll() {
      applyFilters();
      renderTable();
      if (typeof config.renderSummary === "function") config.renderSummary(state);
      if (typeof config.renderDetails === "function") config.renderDetails(state.detailsOpen);
    }

    async function refresh() {
      try {
        state.busy = true;
        const parts = await Promise.all(config.sources.map((s) => s.load()));
        state.rows = parts.flat().sort((a, b) => new Date(b.created_at || b.createdAt || 0).getTime() - new Date(a.created_at || a.createdAt || 0).getTime());
        renderAll();
      } catch (e) {
        const msg = api?.normalizeError ? api.normalizeError(e) : String(e);
        if (typeof config.onError === "function") config.onError(msg);
      } finally {
        state.busy = false;
      }
    }

    function findRow(source, id) {
      return state.rows.find((r) => r.source === source && String(r.id) === String(id)) || null;
    }

    function wireEvents() {
      if (config.readOnly === true) {
        $("retrySelectedBtn")?.setAttribute("hidden", "hidden");
        $("resolveSelectedBtn")?.setAttribute("hidden", "hidden");
      }
      $("refreshBtn")?.addEventListener("click", refresh);
      $("statusFilter")?.addEventListener("change", (e) => { state.filters.status = e.target.value; state.page = 1; renderAll(); });
      $("typeFilter")?.addEventListener("change", (e) => { state.filters.type = String(e.target.value || "").toLowerCase(); state.page = 1; renderAll(); });
      $("dateFilter")?.addEventListener("change", (e) => { state.filters.date = e.target.value; state.page = 1; renderAll(); });
      $("searchInput")?.addEventListener("input", (e) => { state.filters.search = e.target.value; state.page = 1; renderAll(); });
      $("prevBtn")?.addEventListener("click", () => { state.page = Math.max(1, state.page - 1); renderTable(); });
      $("nextBtn")?.addEventListener("click", () => {
        const max = Math.max(1, Math.ceil(state.filtered.length / pageSize));
        state.page = Math.min(max, state.page + 1);
        renderTable();
      });
      $("rows")?.addEventListener("change", (e) => {
        if (!(e.target instanceof HTMLInputElement)) return;
        const key = e.target.getAttribute("data-key");
        if (!key) return;
        if (e.target.checked) state.selected.add(key);
        else state.selected.delete(key);
      });
      $("rows")?.addEventListener("click", async (e) => {
        const btn = e.target.closest("button[data-act]");
        if (!btn) return;
        const act = btn.getAttribute("data-act");
        const source = btn.getAttribute("data-source");
        const id = btn.getAttribute("data-id");
        if (!act || !source || !id) return;
        const row = findRow(source, id);
        if (!row) return;
        if (act === "details") {
          state.detailsOpen = row;
          if (typeof config.renderDetails === "function") config.renderDetails(row);
          return;
        }
        if (act === "retry") await config.actions.retry(row);
        if (act === "resolve") await config.actions.resolve(row);
        await refresh();
      });
      $("retrySelectedBtn")?.addEventListener("click", async () => {
        if (config.readOnly === true) return;
        const rows = [...state.selected].map((k) => {
          const [source, id] = k.split(":");
          return findRow(source, id);
        }).filter(Boolean);
        await config.actions.bulk("retry", rows);
        await refresh();
      });
      $("resolveSelectedBtn")?.addEventListener("click", async () => {
        if (config.readOnly === true) return;
        const rows = [...state.selected].map((k) => {
          const [source, id] = k.split(":");
          return findRow(source, id);
        }).filter(Boolean);
        await config.actions.bulk("resolve", rows);
        await refresh();
      });
    }

    wireEvents();
    return { refresh, getState: () => state };
  }

  global.FSRetryTableModule = { initRetryTable };
})(window);
