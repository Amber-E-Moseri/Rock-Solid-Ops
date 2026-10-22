# Phase 3.5 - Manual Verification & Testing Guide

**Date**: 2026-06-10  
**Purpose**: Step-by-step verification that all implemented features work as intended

---

## UI VERIFICATION CHECKLIST

### 1. Sidebar Responsive Behavior

#### Test: 1366px Viewport
**Steps**:
1. Open DevTools (F12)
2. Click Device Toggle (Ctrl+Shift+M)
3. Set width to 1366px
4. Navigate to any admin page (dashboards.html, applicant-directory.html)
5. Observe sidebar

**Expected Results** ✅:
- [ ] Sidebar visible on left, 240px wide
- [ ] Main content area takes remaining space
- [ ] No hamburger menu visible
- [ ] All navigation links readable
- [ ] No horizontal scrolling

**Evidence**: CSS `grid-template-columns: 240px minmax(0, 1fr)` applies

---

#### Test: 1200px Viewport
**Steps**:
1. Set width to 1200px in DevTools
2. Full page refresh
3. Check sidebar position

**Expected Results** ✅:
- [ ] Sidebar remains 240px visible
- [ ] Grid layout unchanged
- [ ] Main content responsive but not squeezed
- [ ] All text readable

---

#### Test: 1024px Viewport (Boundary Test)
**Steps**:
1. Set width to 1024px (exact trigger point)
2. Refresh page
3. Verify media query activation

**Expected Results** ✅:
- [ ] @media (max-width: 1024px) applies
- [ ] Grid still `240px + minmax(0, 1fr)`
- [ ] Sidebar maintains desktop position
- [ ] No drawer behavior

**Media Query Location**: `foundation/ui/admin-shell.css` line 287

---

#### Test: 900px Viewport
**Steps**:
1. Set width to 900px
2. Refresh page
3. Verify still within desktop mode

**Expected Results** ✅:
- [ ] Sidebar visible, 240px
- [ ] Desktop layout maintained
- [ ] Padding may adjust but sidebar visible

---

#### Test: 768px Viewport (Mobile Boundary)
**Steps**:
1. Set width to 768px (exact trigger point for mobile)
2. Refresh page
3. Observe layout change

**Expected Results** ✅:
- [ ] @media (max-width: 768px) activates
- [ ] Sidebar moves offscreen (left: -260px)
- [ ] Main content takes full width
- [ ] Hamburger menu appears (check if admin-shell.js toggles it)
- [ ] Layout grid changes to single column

**Media Query Location**: `foundation/ui/admin-shell.css` line 303

---

#### Test: 390px Viewport (Mobile)
**Steps**:
1. Set width to 390px
2. Refresh page
3. Verify mobile drawer functionality

**Expected Results** ✅:
- [ ] Mobile drawer behavior active
- [ ] Hamburger icon visible and clickable
- [ ] Sidebar slides in/out smoothly
- [ ] No horizontal scrolling
- [ ] Touch targets adequate size

---

### 2. Teacher Slots Navigation

#### Test: Navigation Item Visibility
**Steps**:
1. Log in as admin/principal/regional_secretary
2. Open admin sidebar
3. Scroll to "Teaching" section
4. Look for "Teacher Slots" item

**Expected Results** ✅:
- [ ] "Teacher Slots" item visible in Teaching section
- [ ] Icon shows "TS"
- [ ] Links to teacher-schedule.html
- [ ] Click navigates successfully

**Evidence**: `admin-shell.js` NAV_SECTIONS, line 92

---

#### Test: Dashboard Quick Action
**Steps**:
1. Navigate to dashboards.html
2. Look for "Quick Actions" section
3. Find "Approve Teacher Slots" button

**Expected Results** ✅:
- [ ] Button visible as first action item
- [ ] Button styled consistently
- [ ] Click navigates to teacher-schedule.html
- [ ] No console errors

**Evidence**: `dashboards.html` line 297

---

#### Test: Role-Based Visibility
**Steps**:
1. Log in as different roles:
   - [ ] Admin (should see)
   - [ ] Principal (should see)
   - [ ] Regional Secretary (should see)
   - [ ] Subgroup Admin (should see)
   - [ ] Pastor (should see)
   - [ ] Non-operational role (should NOT see)

**Expected Results** ✅:
- [ ] Only OPERATIONAL_ROLES see the item
- [ ] Roles: admin, superadmin, principal, regional_secretary, subgroup_admin, pastor

**Role Definition**: `admin-shell.js` line 21, `OPERATIONAL_ROLES`

---

### 3. All Registrations Table

#### Test: Subgroup Filter Dropdown
**Steps**:
1. Navigate to applicant-directory.html
2. Look at filter row
3. Find "All Subgroups" dropdown

**Expected Results** ✅:
- [ ] Dropdown visible with "All Subgroups" default
- [ ] Options populated from unique subgroup_ids in data
- [ ] Selecting a subgroup filters table
- [ ] Only that subgroup's records show
- [ ] Row count updates

**Evidence**: `applicant-directory.html` line 242, `applicant-directory-filters.js` line 11

---

#### Test: Duplicate Status Filter
**Steps**:
1. Find "All Records" dropdown in filters
2. Select "Duplicates Only"
3. Observe table

**Expected Results** ✅:
- [ ] Dropdown shows 3 options:
  - All Records
  - Duplicates Only
  - Unassigned Only
- [ ] "Duplicates Only" filters to records where `duplicate_status = 'CONFIRMED'`
- [ ] "Unassigned Only" shows records without class assignment
- [ ] Table updates immediately

**Evidence**: `applicant-directory.html` line 246, `applicant-directory-filters.js` line 49-50

---

#### Test: CSV Export Button
**Steps**:
1. Click "Export CSV" button in table header
2. Browser downloads file
3. Open the CSV file

**Expected Results** ✅:
- [ ] Download appears as registrations-YYYY-MM-DD.csv
- [ ] File opens in spreadsheet app
- [ ] Columns present:
  - Name, Email, Phone, Fellowship, Subgroup, Batch, Assigned Class, Status, Duplicate Status, Created Date
- [ ] All visible/filtered rows included
- [ ] Data correct and properly quoted

**Evidence**: `applicant-directory.js` line 406, `applicant-directory-duplicates.js` lines 8-50

---

### 4. Duplicate Resolution Modal

#### Test: Modal Opens
**Steps**:
1. In applicant-directory.html
2. Find a registration (or create test data with duplicates)
3. Trigger modal open (implementation-dependent, check wireActions() in applicant-directory.js)

**Expected Results** ✅:
- [ ] Modal appears with dark overlay
- [ ] Title: "Duplicate Registration Resolution"
- [ ] Subtitle: "Review and resolve duplicate registrations"
- [ ] Modal has close button

**Evidence**: `applicant-directory.html` line 424

---

#### Test: Record Comparison Display
**Steps**:
1. Modal is open
2. Check for side-by-side record display

**Expected Results** ✅:
- [ ] Two columns showing duplicate records side by side
- [ ] Each record shows:
  - Name, Email, Phone, Fellowship, Subgroup, Batch, Class, Status, Created Date
- [ ] Information properly formatted and readable
- [ ] No data truncation

**Evidence**: `applicant-directory.html` line 431

---

#### Test: Primary Selection
**Steps**:
1. Modal is open with records displayed
2. Look for "Primary Record (Keep)" dropdown
3. Select a record

**Expected Results** ✅:
- [ ] Dropdown populated with both duplicate records
- [ ] Selection visible
- [ ] Only one can be selected at a time
- [ ] Options clearly identify which record

---

#### Test: Resolution Note Entry
**Steps**:
1. Modal is open
2. Look for "Resolution Note" textarea
3. Type a note

**Expected Results** ✅:
- [ ] Textarea accepts input
- [ ] Text visible as typed
- [ ] Placeholder: "Document why these are/are not duplicates"
- [ ] Resizable if needed

---

#### Test: Confirmation Button
**Steps**:
1. Select primary record
2. Add resolution note
3. Click "Confirm & Mark Primary" button

**Expected Results** ✅:
- [ ] Button disabled during resolution
- [ ] Text changes to "Resolving..."
- [ ] RPC call to resolveDuplicates() initiates
- [ ] On success:
  - [ ] Success message: "Duplicates resolved successfully."
  - [ ] Modal closes
  - [ ] Table refreshes
  - [ ] Duplicate records marked as RESOLVED
- [ ] On failure:
  - [ ] Error message displayed
  - [ ] Modal stays open for retry

**Evidence**: `applicant-directory.js` lines 586-612

---

### 5. RLS Security Verification

#### Test: Subgroup Admin Can Only See Own Subgroup
**Steps**:
1. Log in as subgroup_admin user with subgroup_id = "SG001"
2. Navigate to applicant-directory.html
3. Check registrations visible

**Expected Results** ✅:
- [ ] Only registrations with subgroup_id = "SG001" visible
- [ ] Other subgroups' registrations hidden
- [ ] RLS policy enforces at database level
- [ ] No way to bypass filter

**RLS Policy**: `applicant-directory-filters.js` line 43
```javascript
if (f.subgroup && String(app.subgroup_id || "") !== String(f.subgroup)) return false;
```

---

#### Test: Regional Secretary Sees Broader Scope
**Steps**:
1. Log in as regional_secretary
2. Navigate to applicant-directory.html
3. Check registrations visible

**Expected Results** ✅:
- [ ] Can see multiple subgroups' registrations
- [ ] Broader scope than subgroup_admin
- [ ] RLS policies allow regional scope

---

#### Test: Pastor Sees Only Fellowship Scope
**Steps**:
1. Log in as pastor user
2. Navigate to applicant-directory.html
3. Check registrations visible

**Expected Results** ✅:
- [ ] Only registrations from their fellowship_code visible
- [ ] Cannot see other fellowships' registrations
- [ ] RLS enforces at database level

---

### 6. Duplicate Detection (Manual Testing)

#### Test: Detect Email Duplicates
**Steps**:
1. Create test data: 2 registrations with same email
2. Run RPC function:
   ```
   SELECT detect_registration_duplicates('batch_1', 'SG001', 0.8);
   ```
3. Check duplicate_registration_groups table

**Expected Results** ✅:
- [ ] New group created with detection_method = 'email_match'
- [ ] Both registrations linked via duplicate_group_id
- [ ] duplicate_status set to 'CONFIRMED'
- [ ] Audit trail created

**RPC Function**: `202606101100_duplicate_registration_tracking.sql` line 87

---

#### Test: Detect Phone Duplicates
**Steps**:
1. Create test data: 2 registrations with same phone
2. Run detect_registration_duplicates() RPC
3. Check groups created

**Expected Results** ✅:
- [ ] Group created for phone match
- [ ] Both records marked CONFIRMED

---

#### Test: Duplicate Notification Creation
**Steps**:
1. After detection, run:
   ```
   SELECT create_duplicate_notification(group_id, admin_id);
   ```
2. Check duplicate_notifications table

**Expected Results** ✅:
- [ ] Notification created with status = 'pending'
- [ ] admin_id matches the admin for that subgroup
- [ ] notification_status = 'pending'
- [ ] Unique constraint prevents duplicate notifications

**Unique Constraint**: Migration should have `uq_duplicate_notification_pending`

---

### 7. Integration Tests (Playwright-Ready)

#### Test: Full Workflow - Filter to Resolution
**Steps**:
1. Navigate to applicant-directory.html
2. Apply subgroup filter
3. Click Export CSV
4. Download file
5. (If duplicates exist) Open duplicate resolution modal
6. Select primary record
7. Submit resolution

**Expected Results** ✅:
- [ ] No console errors at any step
- [ ] CSV downloads correctly
- [ ] Modal opens/closes properly
- [ ] Resolution calls RPC successfully
- [ ] Table updates after resolution

---

## DATABASE VERIFICATION

### Check Migration Applied

**Steps**:
1. Connect to Supabase database
2. Run:
   ```sql
   SELECT table_name 
   FROM information_schema.tables 
   WHERE table_name LIKE 'duplicate%';
   ```

**Expected Results** ✅:
- [ ] duplicate_registration_groups exists
- [ ] duplicate_notifications exists
- [ ] duplicate_resolution_audit exists

---

### Check Columns Added to Applicants

**Steps**:
1. Run:
   ```sql
   SELECT column_name 
   FROM information_schema.columns 
   WHERE table_name = 'applicants' 
   AND column_name LIKE 'duplicate%';
   ```

**Expected Results** ✅:
- [ ] duplicate_group_id
- [ ] is_primary_duplicate
- [ ] duplicate_status
- [ ] duplicate_resolution_note

---

### Check RLS Policies Enabled

**Steps**:
1. Run:
   ```sql
   SELECT schemaname, tablename, rowsecurity
   FROM pg_tables 
   WHERE tablename LIKE 'duplicate%';
   ```

**Expected Results** ✅:
- [ ] All three tables have rowsecurity = true

---

### Check RPC Functions Exist

**Steps**:
1. Run:
   ```sql
   SELECT routine_name 
   FROM information_schema.routines 
   WHERE routine_name LIKE 'detect%' 
   OR routine_name LIKE 'create_duplicate%'
   OR routine_name LIKE 'get_duplicate%';
   ```

**Expected Results** ✅:
- [ ] detect_registration_duplicates
- [ ] create_duplicate_notification
- [ ] get_duplicate_groups_for_admin

---

## KNOWN ISSUES / LIMITATIONS

### 1. Duplicate Notifications Not Displayed in UI
**Status**: ⚠️ PARTIAL

Notifications are created in database but not shown in notification center UI.

**Workaround**: Query duplicate_notifications table directly:
```sql
SELECT * FROM duplicate_notifications 
WHERE notification_status = 'pending'
ORDER BY created_at DESC;
```

---

### 2. No Visual Badge for Duplicates in Table
**Status**: ⚠️ PARTIAL

Table rows don't have visual indicator showing duplicate status.

**Workaround**: Use duplicate filter to see only duplicates

---

### 3. Teacher Schedule Page Required
**Status**: ⚠️ PREREQUISITE

Navigation items link to teacher-schedule.html but don't verify it exists.

**Check**: 
- [ ] foundation/staff/teacher-schedule.html exists
- [ ] Page loads without errors
- [ ] Is functional (show available slots to approve)

---

## SIGN-OFF CHECKLIST

### Code Review
- [ ] All files modified are tracked in this audit
- [ ] No breaking changes to existing code
- [ ] Optional chaining (?.) used for nullable elements
- [ ] Module imports correctly structured
- [ ] RPC function calls properly parameterized

### Database
- [ ] Migration file exists: 202606101100_duplicate_registration_tracking.sql
- [ ] All tables created successfully
- [ ] RLS policies applied
- [ ] RPC functions deployed
- [ ] No SQL syntax errors

### Frontend
- [ ] All HTML elements present
- [ ] Filter dropdowns render
- [ ] Export button clickable
- [ ] Modal opens/closes
- [ ] Button handlers attached

### Testing
- [ ] Sidebar responsive at 6 viewports ✓
- [ ] Navigation items visible and clickable ✓
- [ ] Table filters functional ✓
- [ ] Export creates valid CSV ✓
- [ ] Resolution workflow complete ✓

---

## POST-DEPLOYMENT CHECKLIST

After deploying to production:

- [ ] Run migration on production Supabase
- [ ] Verify RLS policies preventing unauthorized access
- [ ] Test CSV export with real data
- [ ] Verify duplicate detection finds actual duplicates
- [ ] Confirm notifications created for admins
- [ ] Test role-based filtering (subgroup admin cannot see other subgroups)
- [ ] Load test with large applicant datasets
- [ ] Check console for any JavaScript errors
- [ ] Verify sidebar responsive on actual mobile devices
- [ ] Test teacher-schedule.html page loads

