// Content ported verbatim from foundation/staff/help-guide.html
export const ROLES = {
  superadmin: { label: 'Superadmin', color: '#4C2A92', oneLine: 'Full system control', gs: ['Open staff login and click Sign In.', 'Dashboard loads first with system KPIs.', 'You can access every admin and system tool.', 'Key pages: Dashboard, Applicants, Batch Management, Class Editor, Teachers, Fellowships, System Health, Failed Syncs, Audit Log.'], tasks: [['add-new-admin', 'Add a new admin user', ['Open Teachers or user management.', 'Create user profile with correct email.', 'Set role to admin, principal, pastor, or subgroup_admin.', 'Save and confirm sign-in access.']], ['create-batch', 'Create a new batch', ['Open Batch Management.', 'Click Create Batch.', 'Enter batch ID, name, dates, and status.', 'Click Save and confirm listing.']], ['delete-batch', 'Delete a batch', ['Open Batch Management.', 'Confirm batch is safe to remove.', 'Click Delete Batch.', 'Approve confirmation prompt.']], ['manage-fellowships', 'Manage fellowships', ['Open Fellowship Management.', 'Create or edit code, group, and subgroup mapping.', 'Save changes.', 'Verify mapping resolution.']], ['view-system-health', 'View system health', ['Open System Health.', 'Review queue and sync summaries.', 'Inspect warnings.', 'Assign follow-up actions.']], ['retry-failed-syncs', 'Retry failed syncs', ['Open Failed Sync Retry Center.', 'Filter failed rows.', 'Trigger retry.', 'Recheck status.']], ['view-audit-logs', 'View audit logs', ['Open Audit Log.', 'Filter by action, actor, or date.', 'Inspect details.', 'Export when needed.']]] },
  admin: { label: 'Admin', color: '#C8102E', oneLine: 'Day-to-day operations', gs: ['Sign in through staff login.', 'Dashboard or Applicants opens first.', 'You manage registrations, classes, teachers, reports.', 'Key pages: Applicants, Batch Management, Waitlist, Class Editor, Dashboards, Reports, Teacher Schedule.'], tasks: [['review-new-registrations', 'Review new registrations', ['Open Applicants.', 'Switch to Review Queue.', 'Filter pending and review.', 'Open each applicant and decide.']], ['assign-student-class', 'Assign a student to a class', ['Open applicant profile.', 'Click Assign Class.', 'Select class with available capacity.', 'Save and verify ASSIGNED.']], ['promote-waitlist', 'Promote from waitlist', ['Open Waitlist.', 'Find candidate with open slot.', 'Run promote action.', 'Confirm assignment and notifications.']], ['send-email-student', 'Send an email to a student', ['Open applicant drawer.', 'Click Email.', 'Write your message.', 'Send and verify queue status.']], ['create-batch', 'Create a batch', ['Open Batch Management.', 'Click Create Batch.', 'Fill required fields.', 'Save and verify.']], ['edit-class-time', 'Edit a class time', ['Open Class Editor.', 'Find class option.', 'Update day or time.', 'Save and notify impacted students if needed.']], ['approve-availability', 'Approve teacher availability', ['Open availability review workflow.', 'Review submitted slots.', 'Approve or reject with reason.', 'Confirm updated status.']], ['view-dashboard', 'View the dashboard', ['Open Dashboards.', 'Select active batch.', 'Review KPIs and trends.', 'Export or share findings.']]] },
  regional_secretary: { label: 'Regional Secretary', color: '#1a3c5e', oneLine: 'Canada-wide oversight', gs: ['Sign in with regional secretary account.', 'Dashboard opens with Canada-wide summary.', 'You monitor registrations and outcomes across groups.', 'Key pages: Dashboards, Applicants, Reports, Batch tools, Teacher Mode switch.'], tasks: [['view-all-applicants-canada', 'View all applicants Canada-wide', ['Open Applicants.', 'Use broad filters or batch selector.', 'Review queue and status health.', 'Export when needed.']], ['review-registrations', 'Review registrations', ['Open review queue.', 'Inspect pending and review cases.', 'Set status decisions.', 'Capture notes in audit trail.']], ['send-announcements', 'Send announcements', ['Open messaging or campaign tools.', 'Choose recipient scope.', 'Write and review message.', 'Send and monitor queue.']], ['view-reports', 'View reports', ['Open Reports.', 'Set period and scope.', 'Generate output.', 'Download or share PDF.']], ['switch-admin-teacher-mode', 'Switch between Admin/Teacher mode', ['Use shell mode switch.', 'Select Teacher Mode to view teacher navigation.', 'Return to Admin Mode for operations.', 'Confirm scope context before actions.']]] },
  pastor: { label: 'Pastor', color: '#16a34a', oneLine: 'Fellowship management', gs: ['Sign in with pastor account.', 'You land on fellowship-scoped views.', 'You review registrations and class outcomes for your fellowship.', 'Key pages: Applicants, Dashboards, Reports, schedules.'], tasks: [['view-applicants-fellowship', 'View applicants in your fellowship', ['Open Applicants.', 'Filter by your fellowship.', 'Review statuses.', 'Follow up on review and waitlist.']], ['review-registrations', 'Review registrations', ['Open review queue.', 'Inspect each record.', 'Apply decisions.', 'Escalate unclear cases to admin.']], ['view-class-schedules', 'View class schedules', ['Open schedule views.', 'Filter by fellowship.', 'Confirm teacher and time coverage.', 'Report gaps to admin.']]] },
  subgroup_admin: { label: 'Subgroup Admin', color: '#d97706', oneLine: 'Subgroup coordination', gs: ['Sign in with subgroup admin account.', 'Dashboard shows subgroup-scoped operations.', 'You coordinate review and class readiness.', 'Key pages: Applicants, Dashboards, schedules, attendance views.'], tasks: [['view-applicants-subgroup', 'View applicants in your subgroup', ['Open Applicants.', 'Filter by subgroup.', 'Review status and assignment health.', 'Resolve review queue records.']], ['review-registrations', 'Review registrations', ['Open review queue.', 'Inspect each applicant.', 'Set status or assign class.', 'Save and verify updates.']], ['view-class-schedules', 'View class schedules', ['Open schedule page.', 'Filter subgroup classes.', 'Check teacher coverage.', 'Escalate missing coverage.']], ['view-attendance', 'View attendance', ['Open attendance views.', 'Review submission rates.', 'Follow up missing classes.', 'Coordinate with teachers.']]] },
  teacher: { label: 'Teacher', color: '#0891b2', oneLine: 'Class and attendance management', gs: ['Sign in through teacher login flow.', 'Teacher portal opens with dashboard, attendance, my class, and availability.', 'You manage roster, attendance submissions, and milestone updates.', 'Key pages: Teacher Dashboard, Attendance, My Class, Availability, Help.'], tasks: [['login-teacher-portal', 'Log in to teacher portal', ['Open teacher login page.', 'Enter credentials.', 'Click Sign In.', 'Confirm teacher navigation appears.']], ['submit-availability', 'Submit your availability', ['Open Availability.', 'Select available days and times.', 'Submit availability.', 'Check status after review.']], ['view-class-roster', 'View your class roster', ['Open My Class.', 'Select class.', 'Review student list and risk indicators.', 'Open profiles for details.']], ['submit-attendance', 'Submit attendance', ['Open Attendance.', 'Choose session and class.', 'Mark present or absent.', 'Click Save.']], ['update-student-milestones', 'Update student milestones', ['Open student details.', 'Select milestone updates.', 'Save changes.', 'Confirm persistence.']], ['view-student-profiles', 'View student profiles', ['Open My Class.', 'Click View Full Profile.', 'Review attendance and milestone details.', 'Return to roster.']], ['check-makeup-queue', 'Check makeup queue', ['Open makeup or follow-up list.', 'Review pending items.', 'Track completion updates.', 'Notify admin if issues persist.']]] },
};

export const TABS = [
  ['getting-started', 'Getting Started'],
  ['common-tasks', 'Common Tasks'],
  ['quick-reference', 'Quick Reference'],
  ['troubleshooting', 'Troubleshooting'],
];

export const TROUBLE = [
  ["Can't log in", 'You enter credentials and cannot sign in.', 'Wrong password, inactive account, or pending role.', ['Reset password.', 'Confirm role is active.', 'Try private browser.'], 'Platform admin or superadmin'],
  ['Page shows Access Denied', 'A page loads and shows Access Denied.', 'Role does not have permission for that page.', ['Check portal mode.', 'Open a page allowed for your role.', 'Ask admin to verify role mapping.'], 'Admin or superadmin'],
  ['Email not received', 'Student or staff did not receive expected email.', 'Queue delay, failed send, or bad recipient address.', ['Check queue status.', 'Retry failed email.', 'Confirm recipient address.'], 'Admin operations'],
  ['Student not showing in roster', 'Student should be assigned but is missing.', 'Assignment not completed or roster sync not updated.', ['Check applicant ASSIGNED.', 'Check class_roster entry.', 'Refresh class and retry sync.'], 'Admin or subgroup admin'],
  ["Attendance won't save", 'Submit action fails or data disappears.', 'Session mismatch, network issue, or permission scope.', ['Reload and select correct session.', 'Check network.', 'Retry and capture error text.'], 'Admin support'],
  ['Class not showing in dropdown', 'Expected class option is missing.', 'Class inactive, batch mismatch, or mapping gap.', ['Check active batch.', 'Verify class option is active.', 'Confirm subgroup or fellowship mapping.'], 'Scheduling admin'],
];

export const STATUS = [
  ['PENDING', 'New registration waiting for review or assignment.'],
  ['REVIEW', 'Needs manual decision because automation could not finalize placement.'],
  ['ASSIGNED', 'Assigned to a class and ready for downstream workflows.'],
  ['WAITLISTED', 'No slot available yet; waiting for a class opening.'],
  ['DUPLICATE', 'Duplicate registration detected and flagged for review.'],
];

export const MILESTONES = ['Born Again', 'Filled with Spirit', 'Partnership', 'Serving Team Interest', 'Foundation Completed'];

export const CONTACTS = [
  ['Login and role access', 'Admin or superadmin'],
  ['Class assignment issues', 'Admin or subgroup admin'],
  ['Attendance issues', 'Teacher lead or admin'],
  ['Email and notifications', 'Admin operations'],
  ['Moodle sync issues', 'System admin'],
];

// Which guides each signed-in role can see (legacy VISIBLE_ROLES; principal sees own + teacher
// but has no dedicated guide, so falls back to all like legacy's ROLES[principal] miss)
export const VISIBLE_ROLES = {
  superadmin: ['superadmin', 'teacher'],
  admin: ['admin', 'teacher'],
  regional_secretary: ['regional_secretary', 'teacher'],
  pastor: ['pastor', 'teacher'],
  subgroup_admin: ['subgroup_admin', 'teacher'],
  teacher: ['teacher'],
  principal: ['principal', 'teacher'],
};

export const CHECK_KEY = 'fs_help_guide_checks';
export const stepKey = (role, taskId, i) => `${role}::${taskId}::${i}`;

export function readChecks() {
  try { return JSON.parse(localStorage.getItem(CHECK_KEY) || '{}'); } catch { return {}; }
}
export function writeChecks(v) {
  localStorage.setItem(CHECK_KEY, JSON.stringify(v));
}

export function progressForRole(roleKey, checks) {
  const r = ROLES[roleKey];
  if (!r) return { done: 0, total: 0 };
  let done = 0;
  r.tasks.forEach((t) => { if (t[2].every((_, i) => checks[stepKey(roleKey, t[0], i)] === true)) done += 1; });
  return { done, total: r.tasks.length };
}

export function visibleRoleKeys(profileRole) {
  const allowed = VISIBLE_ROLES[String(profileRole || '').toLowerCase()];
  const keys = (allowed || Object.keys(ROLES)).filter((r) => ROLES[r]);
  return keys.length ? keys : Object.keys(ROLES);
}
