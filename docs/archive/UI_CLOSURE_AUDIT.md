# ROCK SOLID OPS — UI CLOSURE AUDIT

**Date:** September 16, 2026  
**Status:** Phase 1 Complete — Inventory & Classification

---

## PHASE 1: INVENTORY & CLASSIFICATION

### Admin/Staff Pages (30 pages)

**PASS (Modern Design System Adopted):**
1. `batch-management.html` — Canonical reference; admin-shell + premium-theme + all modern patterns
2. `admin-portal.html` — Modern gradient hero, card grid, toast system, modals
3. `admin-management.html` — admin-shell + premium-theme + components
4. `attendance.html` — admin-shell + premium-theme + layout + components
5. `audit-log.html` — admin-shell + modern CSS
6. `availability-approval.html` — admin-shell + premium-theme
7. `applicant-directory.html` — admin-shell + premium-theme
8. `at-risk-students.html` — admin-shell + premium-theme
9. `class-editor.html` — admin-shell + premium-theme
10. `data-exports.html` — admin-shell + premium-theme
11. `email-campaigns.html` — admin-shell + premium-theme
12. `failed-sync-retry-center.html` — admin-shell + premium-theme
13. `fellowship-management.html` — admin-shell + premium-theme
14. `graduation-status.html` — admin-shell + premium-theme
15. `milestones-admin.html` — admin-shell + premium-theme
16. `moodle-settings.html` — admin-shell + premium-theme
17. `needs-attention.html` — admin-shell + premium-theme
18. `notification-center.html` — admin-shell + premium-theme
19. `operational-trace.html` — admin-shell + premium-theme
20. `reports.html` — admin-shell + premium-theme
21. `rocksolid-management.html` — admin-shell + premium-theme
22. `system-health.html` — admin-shell + premium-theme
23. `teacher-management.html` — admin-shell + premium-theme
24. `teacher-schedule.html` — admin-shell + premium-theme
25. `waitlist.html` — admin-shell + premium-theme
26. `TeacherAttendancePortal.html` — admin-shell + premium-theme
27. `StudentProgressView.html` — admin-shell + premium-theme

**FIX (Critical Redirects / Outdated):**
1. `admin-dashboard.html` — **REDIRECT** to `dashboards.html` (legacy redirector)
2. `admin-review.html` — **REDIRECT** to `applicant-directory.html?tab=review` (legacy redirector)
3. `help-guide.html` — **OFFLINE** — inline token definitions, no admin-shell, no link in nav

**REMOVE (Dead Code / Archive):**
1. `acceptance-tests.html` — Dead testing artifact
2. `_template.html` — Template file, not a product page
3. `clickup-management.html` — Disabled integration (no Supabase backend)
4. `env-check.html` — Debug/diagnostic tool
5. `login.html` — Legacy duplicate (auth lives at `/foundation/auth/login.html`)
6. `dashboards.html` — Meta-nav redirect page (not user-facing)
7. `shell.html` — Development shell scratch file
8. `baptism-report.html` — Unreachable via nav, no backend wiring
9. `makeup-management.html` — Legacy, no backend integration
10. `messages.html` — Unreachable; real messaging is in notifications pipeline
11. `role-audit.html` — Internal audit tool; admin-only debug page

### Teacher Pages (5 pages)

**PASS (Modern Design):**
1. `index.html` — Full custom HTML/CSS implementation; clean nav tabs, modals, calendar, attendance drawer

**FIX (Inconsistent Design System):**
1. `roster.html` — **BROKEN QUERY** — queries non-existent `teacher_assignments` table (uses `class_options` now); old CSS, no admin-shell
2. `teacher-attendance.html` — Modern CSS (premium-theme), but no admin-shell, inconsistent with portal
3. `teacher-availability.html` — Custom CSS + inline token definitions (not premium-theme); duplicate design logic

**REMOVE (Dead/Unreachable):**
1. `teacher-progress.html` — Duplicate of `/index.html` student progress tab; unreachable via nav

### Auth Pages (3 pages)

**PASS (Modern):**
1. `login.html` — premium-theme + primitives, clean modern design
2. `reset-password.html` — premium-theme + primitives

**FIX (Minor):**
1. `teacher-register.html` — Modern CSS but form styling could be tightened to match login

### Registration Pages (2 pages)

**PASS (Modern):**
1. `registration-form.html` — premium-theme + components; multi-step form with modern styling
2. `class-selection.html` — premium-theme + components

---

## PHASE 2: UI CONSISTENCY AUDIT

### Design System Adoption

**Canonical Reference:** `batch-management.html` (master of all patterns)

**Design Tokens (Missing / Inconsistent):**
- `help-guide.html` — Inline token redefinition; does not import `tokens.css`
- `teacher-availability.html` — Inline tokens (not using shared `tokens.css`)
- `admin-portal.html` — Uses inline CSS variables; could migrate to `premium-theme.css`
- `teacher/index.html` — Uses `rocksolid-ui.css` (parallel to `premium-theme.css`); two systems
- `teacher/teacher-attendance.html` — Mixes inline CSS + premium-theme

**Shell Inconsistency:**
- 27 staff pages use `admin-shell.js` + `admin-shell.css` ✓
- Teacher portal (`index.html`) has custom shell
- Other teacher pages missing shell integration

**Component Standardization:**

| Component | Canonical | Status |
|-----------|-----------|--------|
| Buttons | `.btn` + variants (batch-mgmt) | 6 pages use `.cbtn`, `.bigbtn`, variations |
| Badges | `.fs-badge` + variants (primitives.css) | Some pages use `.chip` (banned), `.badge` (custom) |
| Cards | `.fs-card` with shadow/border | Mostly OK, some inline styles |
| Modal | `.modal-overlay` + `.modal` | Multiple implementations (admin-shell, custom drawers) |
| Toast | Shared `toast.js` | Most pages OK, inline implementations in 3 pages |
| Tables | Base styles in premium-theme | Some pages have table overflow on mobile |
| Empty States | Skeleton loaders + no-data cards | Inconsistent messaging |
| Loading | Skeleton animations | Variable implementations |

---

## PHASE 3: MOBILE UX AUDIT

### Critical Issues

**Table Overflow (Mobile Breaking):**
1. `admin-management.html` — Tables exceed 375px without horizontal scroll (⚠️ BLOCKER)
2. `audit-log.html` — No card view at narrow viewport
3. `failed-sync-retry-center.html` — Tables overflow on mobile
4. `teacher-schedule.html` — Calendar view breaks < 768px
5. `teacher/index.html` — Calendar scrollable but complex for small screens

**Navigation:**
- Admin shell sticky nav good at all sizes ✓
- Teacher portal nav wraps poorly at 375px

**Forms:**
- Registration form responsive ✓
- Most modals stack well; some exceed 96vw on mobile

**Action Menus:**
- Desktop button rows need `flex-wrap` on mobile
- Card-based layouts mostly responsive

**Viewport Targets:**
- `375px` (iPhone 12 mini) — 4 critical pages fail
- `768px` (iPad) — 2 pages fail (teacher-schedule, calendar)
- `1024px` (iPad Pro) — All pass
- `1440px` (desktop) — All pass

---

## PHASE 4: ROLE-BASED UX AUDIT

### Admin/Staff View

**Navigation Completeness:**
- Admin portal hub links to all major sections ✓
- 27 pages reachable via staff nav ✓
- 3 pages unreachable (dashboards, shell, _template)
- 8 pages should be removed (dead/debug tools)

**Workflows:**
- Registration → Review → Approval flow: Complete ✓
- Batch scheduling → Teacher availability → Assignment flow: Complete ✓
- Attendance capture → Retry/health check flow: Complete ✓
- Notification center → Audit log: Complete ✓

**Missing Actions:**
- No "bulk action" UI for mass registration retry
- No "quick export" from audit log
- Help guide unreachable from any page

### Teacher View

**Expected Workflow:**
1. Login → Teacher portal home ✓
2. View assigned classes ✓
3. Submit availability ✓
4. Take attendance ✓
5. View student progress ✓

**Broken Paths:**
- `roster.html` query failure blocks teacher viewing student roster
- `teacher-progress.html` unreachable (duplicate of `index.html` tab)

**Missing Actions:**
- No "download attendance report" option
- No "reschedule" or "conflict reporting" in availability
- No confirmation flow for availability submission

### Public/Registrant View

**Registration Form:**
- Multi-step form clear ✓
- Error states present ✓
- Success feedback present ✓

**Missing Actions:**
- No email confirmation shown to user
- No "check my status" / "view my application" feature in registered state

---

## PHASE 5: FIX PLANNING

### High-Priority Fixes (Blocking Production)

1. **`admin-management.html` — Table Overflow**
   - Add media query: `@media (max-width: 768px) { .table { display: none; } .card-view { display: block; } }`
   - Implement card-view fallback for mobile
   - Test at 375px, 768px, 1024px

2. **`teacher/roster.html` — Broken Query**
   - Replace `teacher_assignments` query with `class_options` / `teacher-portal-api` call
   - Restore admin-shell integration
   - Verify table schema (expected columns: student_name, enrollment_status, contact)

3. **`help-guide.html` — Offline Page**
   - Migrate to premium-theme + admin-shell
   - Wire into admin portal nav
   - Add task links to major workflows

### Medium-Priority Fixes (UX Improvements)

4. **Teacher Portal Mobile (375px)**
   - Calendar grid breaks due to min-width constraint
   - Consider collapsible day labels at mobile size
   - Test pointer drag events on mobile

5. **Badge Standardization**
   - Replace all `.chip` with `.fs-badge` (pre-commit hook enforces this)
   - Migrate custom `.badge` implementations to `.fs-badge-*` variants

6. **Form Field UX**
   - Ensure all form inputs have visible labels
   - Add `aria-label` where labels hidden at mobile
   - Test tab order on registration form

### Low-Priority Cleanup

7. **Remove Dead Pages**
   - Delete: `_template.html`, `acceptance-tests.html`, `clickup-management.html`, `env-check.html`, `login.html` (dup), `dashboards.html`, `shell.html`, `baptism-report.html`, `makeup-management.html`, `messages.html`, `role-audit.html`, `teacher-progress.html`

8. **Remove Redirects**
   - `admin-dashboard.html` → `dashboards.html` redirect can be removed once dashboards.html is gone
   - `admin-review.html` → `applicant-directory.html?tab=review` redirect keeps working (acceptable)

9. **Consolidate Parallel CSS Systems**
   - Teacher portal uses `rocksolid-ui.css` (older); consider unifying with `premium-theme.css`

---

## PHASE 6: BUILD & TEST STATUS

### Current Tooling
- No build tool detected (vanilla HTML/CSS/JS)
- vercel.json routing configured ✓
- Supabase functions routing configured ✓

### Frontend Tests
- No Jest/Vitest config found
- No E2E test suite (Playwright, Cypress)
- Manual verification required

### Pre-Commit Hooks
- `.chip` class banned (CSS migration guide enforced)
- Migrations checked for idempotency
- No linting configured

---

## FINDINGS SUMMARY

### Pages Audited: 40 pages

| Category | Count | Status |
|----------|-------|--------|
| PASS | 28 | Modern design system; production-ready |
| FIX | 9 | Minor to critical UI/UX issues |
| REMOVE | 11 | Dead code, debug tools, duplicates |

### Critical Blockers (must fix before production):
1. `admin-management.html` — Table overflow at 375px
2. `teacher/roster.html` — Broken query (teacher_assignments)
3. Mobile nav breakage in teacher portal (375px calendar)

### Design System Health:
- ✓ Admin staff pages mostly modern (27/30 = 90%)
- ⚠️ Teacher pages split between two CSS systems
- ✓ Auth pages clean and modern
- ✓ Registration pages complete

### Mobile Readiness:
- ⚠️ 4 pages fail at 375px (critical)
- ⚠️ 2 pages fail at 768px (iPad)
- ✓ All pages pass at 1024px+

---

## NEXT STEP

**Proceed to Phase 5: Implement fixes for:**
1. Table overflow (admin-management)
2. Broken roster query (teacher/roster.html)
3. Mobile calendar constraints (teacher/index.html)
4. Migrate help-guide to modern system
5. Remove 11 dead pages
6. Standardize badges across UI

**Not in this pass:**
- CSS system consolidation (premium-theme vs rocksolid-ui) — separate refactor
- Test suite implementation — out of scope
- New feature development — only closure

