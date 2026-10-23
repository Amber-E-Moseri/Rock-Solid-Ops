// Shared role access matrix for SPA routes (ported from brief/teacher-portal-ux).
// Landing and nav decisions read from here. Entries mirror the guards that
// App.jsx enforces today. App.jsx route guards are NOT yet all driven from this
// table (for example /staff/data-exports, /staff/attendance and
// /staff/at-risk-students are only guarded in App.jsx). Changing an entry
// changes who can open a page, so treat edits here as permission changes.

export const ADMIN_ROLES = Object.freeze(['superadmin', 'admin', 'subgroup_admin', 'pastor', 'principal']);
export const OPERATIONAL_ROLES = Object.freeze([...ADMIN_ROLES, 'regional_secretary']);

const OPERATIONAL_AND_TEACHER = Object.freeze([...OPERATIONAL_ROLES, 'teacher']);
const SYSTEM_ADMIN = Object.freeze(['admin', 'superadmin']);

export const ROUTE_ACCESS = Object.freeze({
  // Overview
  '/staff/dashboards': OPERATIONAL_ROLES,
  '/staff/admin-portal': Object.freeze(['superadmin', 'admin', 'subgroup_admin', 'pastor', 'principal', 'regional_secretary']),

  // Operations
  '/staff/batch-management': OPERATIONAL_ROLES,
  '/staff/applicant-directory': Object.freeze(['admin', 'superadmin', 'principal', 'regional_secretary']),
  '/staff/waitlist': Object.freeze(['admin', 'superadmin', 'regional_secretary']),
  '/staff/class-editor': Object.freeze(['admin', 'superadmin', 'regional_secretary']),
  '/staff/milestones': Object.freeze(['admin', 'superadmin', 'regional_secretary']),

  // Reports
  '/staff/reports': Object.freeze(['superadmin', 'admin', 'subgroup_admin', 'pastor', 'principal', 'regional_secretary']),

  // Teaching (staff side)
  '/staff/teacher-schedule': OPERATIONAL_ROLES,
  '/staff/student-progress': OPERATIONAL_ROLES,

  // Comms
  '/staff/help-guide': OPERATIONAL_AND_TEACHER,
  '/staff/messages': OPERATIONAL_AND_TEACHER,
  '/staff/notification-center': SYSTEM_ADMIN,
  '/staff/email-campaigns': Object.freeze(['superadmin', 'admin']),

  // Admin tools
  '/staff/admin-activity': SYSTEM_ADMIN,
  '/staff/role-audit': Object.freeze(['superadmin']),
  '/staff/audit-log': Object.freeze(['superadmin']),

  // System
  '/staff/teacher-management': OPERATIONAL_ROLES,
  '/staff/operational-trace': Object.freeze(['admin', 'superadmin', 'regional_secretary']),
  '/staff/fellowship-management': SYSTEM_ADMIN,
  '/staff/nexus-management': SYSTEM_ADMIN,
  '/staff/failed-sync-retry-center': ADMIN_ROLES,
  '/staff/system-health': ADMIN_ROLES,
  '/staff/moodle-settings': ADMIN_ROLES,

  // Teacher portal
  '/teacher/index': OPERATIONAL_AND_TEACHER,
  // Teacher attendance is for teacher accounts only. Staff use /staff/attendance.
  '/teacher/attendance': Object.freeze(['teacher']),
  '/teacher/availability': OPERATIONAL_AND_TEACHER,
  '/teacher/progress': OPERATIONAL_AND_TEACHER,
});

export const TEACHER_LANDING = '/teacher/index';
export const STAFF_LANDING = '/staff/dashboards';

// Where a signed-in user with this (already canonical) role should land.
// Returns null when no route is open to the role, so the caller can send the
// user to login with an "unauthorized" notice instead of a redirect loop.
export function landingPathForRole(role) {
  if (role === 'teacher') return TEACHER_LANDING;
  if (OPERATIONAL_ROLES.includes(role)) return STAFF_LANDING;
  return null;
}
