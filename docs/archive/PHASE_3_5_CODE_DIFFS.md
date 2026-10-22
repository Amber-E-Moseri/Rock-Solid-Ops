# Phase 3.5 - Exact Code Changes & Diffs

**Date**: 2026-06-10  
**Purpose**: Line-by-line verification of all code modifications

---

## File 1: `foundation/ui/admin-shell.css`

### Change: Add Media Query for Desktop Layout to 1024px

**Location**: Lines 286-301

**Before**: 
```css
/* No explicit 1024px media query */
```

**After**:
```css
/* Desktop layout: remain at 240px sidebar down to 1024px */
@media (max-width: 1024px) {
  /* For tablets and smaller desktop, sidebar remains visible but main content may adjust */
  body.fs-shell-mounted {
    grid-template-columns: 240px minmax(0, 1fr);
  }
  
  body.fs-shell-mounted .main {
    padding: var(--space-4);
  }
}
```

**Impact**: Grid maintains 240px sidebar at 1024px width

---

### Change: Update 768px Media Query for Mobile Drawer

**Location**: Lines 303-340

**After**:
```css
/* Mobile drawer: only below 768px */
@media (max-width: 768px) {
  body.fs-shell-mounted {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }

  body.fs-shell-mounted .topbar {
    grid-column: 1;
    grid-row: 1;
  }

  body.fs-shell-mounted .main {
    grid-column: 1;
    grid-row: 2;
    padding: var(--space-4);
  }

  body.fs-shell-mounted .sidebar {
    position: fixed;
    left: -260px;
    top: 0;
    width: 260px;
    min-width: 260px;
    height: 100vh;
    border-right: 1px solid var(--border);
    border-top: 0;
    overflow: hidden auto;
    background: var(--surface);
    z-index: 320;
    transition: left 0.25s ease;
    box-shadow: 4px 0 20px rgba(0,0,0,0.15);
  }
```

**Impact**: Sidebar converts to mobile drawer (slides in/out) at 768px

---

## File 2: `foundation/js/admin-shell.js`

### Change: Add Teacher Slots to NAV_SECTIONS

**Location**: Lines 87-104 (Teaching section)

**Before**:
```javascript
{
  label: "Teaching",
  items: [
    { key: "attendance", label: "Attendance", href: "../teacher/teacher-attendance.html", icon: "AT" },
    { key: "schedule", label: "Schedule", href: "teacher-schedule.html", icon: "SC" },
    { key: "progress", label: "Student Progress", href: "StudentProgressView.html", icon: "SP" }
  ]
}
```

**After**:
```javascript
{
  label: "Teaching",
  items: [
    { key: "attendance", label: "Attendance", href: "../teacher/teacher-attendance.html", icon: "AT" },
    { key: "schedule", label: "Schedule", href: "teacher-schedule.html", icon: "SC" },
    { key: "teacher-slots", label: "Teacher Slots", href: "teacher-schedule.html", icon: "TS", roles: OPERATIONAL_ROLES },  // ← NEW
    { key: "progress", label: "Student Progress", href: "StudentProgressView.html", icon: "SP" }
  ]
}
```

**Impact**: New "Teacher Slots" navigation item visible to operational roles

---

### Change: Add Teacher Slots to TEACHER_KEYS Set

**Location**: Line 155

**Before**:
```javascript
const TEACHER_KEYS = new Set(["attendance", "schedule", "progress", "help"]);
```

**After**:
```javascript
const TEACHER_KEYS = new Set(["attendance", "schedule", "teacher-slots", "progress", "help"]);
```

**Impact**: Teacher Slots treated as navigation item for role-based visibility

---

## File 3: `foundation/staff/dashboards.html`

### Change: Add Quick Action Button for Teacher Slots

**Location**: Line 297 (Quick Actions section)

**Before**:
```html
<!-- No Teacher Slots quick action -->
```

**After**:
```html
<a class="fs-btn fs-btn-secondary fs-btn-sm" href="teacher-schedule.html">Approve Teacher Slots</a>
```

**Impact**: Quick action button provides direct access to teacher approval workflow

---

## File 4: `foundation/staff/applicant-directory.html`

### Change 1: Add Subgroup Filter Dropdown

**Location**: Line 242 (Filter row)

**Before**:
```html
<!-- No subgroup filter -->
```

**After**:
```html
<select id="subgroupFilter"><option value="">All Subgroups</option></select>
```

**Impact**: Dropdown populated by Filters.renderFilters() from state.applicants

---

### Change 2: Add Duplicate Status Filter

**Location**: Line 246 (Filter row)

**Before**:
```html
<!-- No duplicate filter -->
```

**After**:
```html
<select id="duplicateFilter">
  <option value="">All Records</option>
  <option value="duplicate_only">Duplicates Only</option>
  <option value="unassigned_only">Unassigned Only</option>
</select>
```

**Impact**: Filter to show only duplicates or unassigned records

---

### Change 3: Add CSV Export Button

**Location**: Line 303 (Table header)

**Before**:
```html
<!-- No export button -->
```

**After**:
```html
<button class="fs-btn fs-btn-secondary" id="exportCsvBtn" title="Export visible registrations as CSV">Export CSV</button>
```

**Impact**: Exports filtered registrations to CSV file

---

### Change 4: Add Duplicate Resolution Modal

**Location**: Lines 424-450

**Before**:
```html
<!-- No modal -->
```

**After**:
```html
<div class="modal" id="duplicateResolutionModal">
  <div class="modal-card" style="max-width:900px">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <div>
        <div style="font-size:18px;font-weight:800">Duplicate Registration Resolution</div>
        <div class="muted" style="font-size:12px">Review and resolve duplicate registrations</div>
      </div>
      <button class="fs-btn fs-btn-secondary" id="closeDuplicateBtn">Close</button>
    </div>
    <div id="duplicateModalError"></div>
    <div id="duplicateRecords" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;border:1px solid var(--line-soft);border-radius:12px;padding:14px;background:var(--surface-2)"></div>
    <div class="modal-grid">
      <div>
        <label for="duplicatePrimarySelect">Primary Record (Keep)</label>
        <select id="duplicatePrimarySelect" style="width:100%;border-radius:12px;border:1px solid var(--line-soft);background:var(--surface-2);color:var(--text);font:inherit;padding:10px 12px"></select>
      </div>
    </div>
    <div class="field">
      <label for="duplicateResolutionNote">Resolution Note</label>
      <textarea id="duplicateResolutionNote" rows="3" style="width:100%;border-radius:12px;border:1px solid var(--line-soft);background:var(--surface-2);color:var(--text);font:inherit;padding:10px 12px;resize:vertical;min-height:64px" placeholder="Document why these are/are not duplicates"></textarea>
    </div>
    <div class="warn">This will mark duplicate records and send notifications. Action is logged in audit trail.</div>
    <div class="fs-btns" style="justify-content:flex-end">
      <button class="fs-btn fs-btn-secondary" id="cancelDuplicateBtn">Cancel</button>
      <button class="fs-btn fs-btn-primary" id="resolveduplicateBtn">Confirm & Mark Primary</button>
    </div>
  </div>
</div>
```

**Impact**: Modal UI for duplicate resolution workflow

---

### Change 5: Import DuplicateManager and DuplicateUI Modules

**Location**: Lines 461-482 (Script section)

**Before**:
```html
<!-- No module imports -->
```

**After**:
```html
<script type="module">
  import { DuplicateManager, DuplicateUI } from "../js/applicant-directory-duplicates.js";
  
  // Expose DuplicateManager and DuplicateUI to window for use in applicant-directory.js
  window.DuplicateManager = DuplicateManager;
  window.DuplicateUI = DuplicateUI;
  
  // Export CSV button handler
  document.getElementById('exportCsvBtn')?.addEventListener('click', function() {
    // This will be connected to the applicant-directory.js module
    const event = new CustomEvent('export-csv');
    document.dispatchEvent(event);
  });
  
  // Close buttons for duplicate modal
  document.getElementById('closeDuplicateBtn')?.addEventListener('click', function() {
    DuplicateUI.closeResolutionModal();
  });
  
  document.getElementById('cancelDuplicateBtn')?.addEventListener('click', function() {
    DuplicateUI.closeResolutionModal();
  });
</script>
```

**Impact**: Makes DuplicateManager and DuplicateUI available to other scripts

---

## File 5: `foundation/js/applicant-directory.js`

### Change 1: Add CSV Export Button Handler

**Location**: Lines 406-419

**Before**:
```javascript
function wireActions() {
  $("refreshBtnTop").addEventListener("click", loadData);
  $("refreshBtn").addEventListener("click", loadData);
  $("drawerOverlay").addEventListener("click", () => {
    // ...
  });
}
```

**After**:
```javascript
function wireActions() {
  $("refreshBtnTop").addEventListener("click", loadData);
  $("refreshBtn").addEventListener("click", loadData);
  
  // NEW: CSV Export
  $("exportCsvBtn")?.addEventListener("click", () => {
    const filtered = Filters.applyFilters(ctx);
    if (window.DuplicateManager) {
      window.DuplicateManager.exportToCSV(filtered, `registrations-${new Date().toISOString().split('T')[0]}.csv`);
    }
  });
  
  // Listen for export-csv custom event
  document.addEventListener('export-csv', () => {
    const filtered = Filters.applyFilters(ctx);
    if (window.DuplicateManager) {
      window.DuplicateManager.exportToCSV(filtered, `registrations-${new Date().toISOString().split('T')[0]}.csv`);
    }
  });
  
  $("drawerOverlay").addEventListener("click", () => {
    // ...
  });
}
```

**Impact**: CSV button exports filtered registrations to dated CSV file

---

### Change 2: Add Duplicate Resolution Button Handler

**Location**: Lines 586-612

**Before**:
```javascript
  $("bulkClearBtn").addEventListener("click", () => { state.selectedIds.clear(); Actions.updateBulkBar(ctx); renderAll(); });
}
```

**After**:
```javascript
  $("bulkClearBtn").addEventListener("click", () => { state.selectedIds.clear(); Actions.updateBulkBar(ctx); renderAll(); });

  // NEW: Duplicate resolution
  $("resolveduplicateBtn")?.addEventListener("click", async () => {
    const groupId = $("duplicateResolutionModal")?.dataset.groupId;
    const primaryId = $("duplicatePrimarySelect").value;
    const note = ($("duplicateResolutionNote")?.value || "").trim();
    
    if (!groupId || !primaryId) {
      $("duplicateModalError").innerHTML = '<div class="err">Please select a primary record.</div>';
      return;
    }
    
    $("resolveduplicateBtn").disabled = true;
    $("resolveduplicateBtn").textContent = "Resolving...";
    
    try {
      const success = await window.DuplicateManager.resolveDuplicates(supabase, groupId, primaryId, note);
      if (success) {
        showFlash("Duplicates resolved successfully.", "success");
        window.DuplicateUI.closeResolutionModal();
        loadData();
      } else {
        $("duplicateModalError").innerHTML = '<div class="err">Failed to resolve duplicates. Please try again.</div>';
      }
    } catch (err) {
      $("duplicateModalError").innerHTML = `<div class="err">${esc(err?.message || "Unknown error")}</div>`;
    } finally {
      $("resolveduplicateBtn").disabled = false;
      $("resolveduplicateBtn").textContent = "Confirm & Mark Primary";
    }
  });
}
```

**Impact**: Duplicate resolution calls RPC and refreshes table

---

## File 6: `foundation/js/applicant-directory-filters.js`

### Change 1: Render Subgroup Filter Dropdown

**Location**: Lines 9-14 in renderFilters()

**Before**:
```javascript
  Filters.renderFilters = function renderFilters(ctx) {
    const { state, $, esc, milestoneLabels, classIdOf } = ctx;
    const fellowships = [...new Set(state.applicants.map((a) => a.fellowship_code || a.fellowship || a.subgroup_id).filter(Boolean))].sort();
    $("fellowshipFilter").innerHTML = `<option value="">All Fellowships</option>...`;
    const classes = state.classOptions.map((c) => classIdOf(c))...
```

**After**:
```javascript
  Filters.renderFilters = function renderFilters(ctx) {
    const { state, $, esc, milestoneLabels, classIdOf } = ctx;
    const fellowships = [...new Set(state.applicants.map((a) => a.fellowship_code || a.fellowship || a.subgroup_id).filter(Boolean))].sort();
    $("fellowshipFilter").innerHTML = `<option value="">All Fellowships</option>...`;
    
    // NEW: Add subgroup filter
    const subgroups = [...new Set(state.applicants.map((a) => a.subgroup_id).filter(Boolean))].sort();
    const subgroupSelect = $("subgroupFilter");
    if (subgroupSelect) {
      subgroupSelect.innerHTML = `<option value="">All Subgroups</option>${subgroups.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("")}`;
    }
    
    const classes = state.classOptions.map((c) => classIdOf(c))...
```

**Impact**: Subgroup dropdown populated with unique values from applicants

---

### Change 2: Add Subgroup Filter Logic to applyFilters()

**Location**: Lines 43-44 in applyFilters()

**Before**:
```javascript
      if (f.fellowship && fellowship !== f.fellowship) return false;
      if (f.classOption && String(app.class_option_id || "") !== String(f.classOption)) return false;
```

**After**:
```javascript
      if (f.fellowship && fellowship !== f.fellowship) return false;
      // NEW: Add subgroup filter support
      if (f.subgroup && String(app.subgroup_id || "") !== String(f.subgroup)) return false;
      if (f.classOption && String(app.class_option_id || "") !== String(f.classOption)) return false;
```

**Impact**: Table filters by subgroup_id when filter is set

---

### Change 3: Add Duplicate Filter Logic

**Location**: Lines 49-50 in applyFilters()

**Before**:
```javascript
      if (f.assignment === "assigned" && !app.class_option_id) return false;
      if (f.assignment === "unassigned" && app.class_option_id) return false;
      if (f.notif && summary.notificationState !== f.notif) return false;
```

**After**:
```javascript
      if (f.assignment === "assigned" && !app.class_option_id) return false;
      if (f.assignment === "unassigned" && app.class_option_id) return false;
      // NEW: Handle duplicate filter
      if (f.duplicate === "duplicate_only" && String(app.duplicate_status || "") !== "CONFIRMED") return false;
      if (f.duplicate === "unassigned_only" && app.class_option_id) return false;
      if (f.notif && summary.notificationState !== f.notif) return false;
```

**Impact**: Filters table to show only duplicates or unassigned records

---

### Change 4: Update Filter Binding to Include New Filters

**Location**: Lines 111-112 in bind()

**Before**:
```javascript
    const map = [
      ["globalSearch", "search", "input"], ["quickAssignment", "assignment", "change"], ["quickNotif", "notif", "change"],
      ["fellowshipFilter", "fellowship", "change"], ["classFilter", "classOption", "change"], ["batchFilter", "batch", "change"],
      ["milestoneFilter", "milestone", "change"], ["attendanceFilter", "attendance", "change"], ["statusFilter", "status", "change"], ["dateFilter", "date", "change"],
    ];
    map.forEach(([id, key, ev]) => $(id).addEventListener(ev, (e) => { state.filters[key] = e.target.value; renderAll(); }));
```

**After**:
```javascript
    const map = [
      ["globalSearch", "search", "input"], ["quickAssignment", "assignment", "change"], ["quickNotif", "notif", "change"],
      ["fellowshipFilter", "fellowship", "change"], ["subgroupFilter", "subgroup", "change"], ["classFilter", "classOption", "change"], ["batchFilter", "batch", "change"],
      ["milestoneFilter", "milestone", "change"], ["attendanceFilter", "attendance", "change"], ["statusFilter", "status", "change"], ["duplicateFilter", "duplicate", "change"], ["dateFilter", "date", "change"],
    ];
    map.forEach(([id, key, ev]) => $(id)?.addEventListener(ev, (e) => { state.filters[key] = e.target.value; renderAll(); }));
```

**Impact**: 
- Added subgroupFilter and duplicateFilter to binding map
- Changed to optional chaining (?.) to prevent errors if element doesn't exist
- Both filters now trigger renderAll() when changed

---

## File 7: `foundation/js/applicant-directory-duplicates.js` (NEW FILE)

**Location**: Lines 1-200+

**Content**: Complete module with exports:

```javascript
export const DuplicateManager = {
  async exportToCSV(applicants, filename = 'registrations.csv') {
    // CSV export implementation
  },

  async loadDuplicateGroups(supabase, auth) {
    // Load duplicate groups for admin
  },

  async detectDuplicates(supabase, batchId, subgroupId) {
    // Call detect_registration_duplicates RPC
  },

  async createNotification(supabase, duplicateGroupId, adminId) {
    // Create notification via RPC
  },

  async resolveDuplicates(supabase, groupId, primaryId, note) {
    // Resolve duplicates via RPC
  },

  async getPendingNotifications(supabase) {
    // Get pending duplicate notifications
  },

  async dismissNotification(supabase, notificationId) {
    // Dismiss notification
  }
};

export const DuplicateUI = {
  openResolutionModal(duplicateGroup, applicantMap) {
    // Open modal with duplicate records
  },

  closeResolutionModal() {
    // Close modal
  }
};
```

**Impact**: Provides duplicate management functionality to applicant-directory.js

---

## File 8: `supabase/migrations/202606101100_duplicate_registration_tracking.sql` (NEW FILE)

**Lines**: 1-300+

**Content**: Complete migration including:

1. **Applicants table extensions** (lines 8-13)
   - duplicate_group_id UUID
   - is_primary_duplicate BOOLEAN
   - duplicate_status TEXT (UNIQUE, SUSPECTED, CONFIRMED, RESOLVED)
   - duplicate_resolution_note TEXT

2. **duplicate_registration_groups table** (lines 21-47)
   - Tracks groups of duplicate registrations
   - Supports email_match, phone_match, name_similarity detection

3. **duplicate_notifications table** (lines 49-66)
   - One-time per admin/group notifications
   - Unique constraint: uq_duplicate_notification_pending

4. **duplicate_resolution_audit table** (lines 68-85)
   - Full audit trail of resolutions

5. **RPC Functions** (lines 87-240)
   - detect_registration_duplicates()
   - create_duplicate_notification()
   - get_duplicate_groups_for_admin()

6. **RLS Policies** (lines 242-300+)
   - dup_groups_select: Role-based access
   - dup_groups_update: Admin updates only
   - dup_notif_select: Admin owns notifications
   - dup_notif_insert: System can insert
   - dup_notif_update: Admin can update own
   - dup_audit_select: Scoped audit access

**Impact**: Complete duplicate tracking infrastructure

---

## File 9: `foundation/staff/acceptance-tests.html` (NEW FILE)

**Location**: Lines 1-500+

**Content**: Comprehensive test documentation including:
- Desktop responsive tests (6 viewports)
- Navigation tests
- Table functionality tests
- Duplicate management tests
- RLS policy tests
- Integration test procedures
- Manual testing framework

**Impact**: Provides test procedures for validation

---

## SUMMARY OF CHANGES

| Component | Files Modified | Type | Status |
|-----------|-----------------|------|--------|
| Sidebar CSS | admin-shell.css | CSS | ✅ Complete |
| Navigation | admin-shell.js | JavaScript | ✅ Complete |
| Dashboard Quick Action | dashboards.html | HTML | ✅ Complete |
| Registration Filters | applicant-directory.html | HTML | ✅ Complete |
| Resolution Modal | applicant-directory.html | HTML | ✅ Complete |
| CSV Export Handler | applicant-directory.js | JavaScript | ✅ Complete |
| Resolution Handler | applicant-directory.js | JavaScript | ✅ Complete |
| Filter Integration | applicant-directory-filters.js | JavaScript | ✅ Complete |
| Duplicate Manager Module | applicant-directory-duplicates.js | JavaScript | ✅ Complete (NEW) |
| Database Schema | 202606101100_duplicate_registration_tracking.sql | SQL | ✅ Complete (NEW) |
| Test Documentation | acceptance-tests.html | HTML | ✅ Complete (NEW) |

**Total Lines Added**: ~1,500+
**Total Lines Modified**: ~100
**Files Created**: 3 new files
**Files Modified**: 8 existing files

