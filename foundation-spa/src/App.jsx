import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import ProtectedRoute from './components/layout/ProtectedRoute.jsx';
import Shell from './components/layout/Shell.jsx';
import { PWAInstallPrompt } from './components/pwa/PWAInstallPrompt.jsx';
import { OfflineIndicator } from './components/pwa/OfflineIndicator.jsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 * 2, retry: 1 },
  },
});

// Lazy page imports — expand as portals are migrated
const LoginPage          = lazy(() => import('./features/auth/LoginPage.jsx'));
const AuditLogPage       = lazy(() => import('./features/audit-log/AuditLogPage.jsx'));
const AdminActivityPage  = lazy(() => import('./features/admin-activity/AdminActivityPage.jsx'));
const RoleAuditPage      = lazy(() => import('./features/role-audit/RoleAuditPage.jsx'));
const AdminManagementPage = lazy(() => import('./features/admin-management/AdminManagementPage.jsx'));
const AdminPortalPage    = lazy(() => import('./features/admin-portal/AdminPortalPage.jsx'));
const ReportsPage        = lazy(() => import('./features/reports/ReportsPage.jsx'));
const DataExportsPage    = lazy(() => import('./features/data-exports/DataExportsPage.jsx'));
const NeedsAttentionPage = lazy(() => import('./features/needs-attention/NeedsAttentionPage.jsx'));
const OperationalTracePage = lazy(() => import('./features/operational-trace/OperationalTracePage.jsx'));
const ApplicantDirectoryPage = lazy(() => import('./features/applicant-directory/ApplicantDirectoryPage.jsx'));
const DashboardsPage     = lazy(() => import('./features/dashboards/DashboardsPage.jsx'));
const TeacherManagementPage = lazy(() => import('./features/teacher-management/TeacherManagementPage.jsx'));
const TeacherAttendancePage = lazy(() => import('./features/teacher-attendance/TeacherAttendancePage.jsx'));
const TeacherSchedulePage  = lazy(() => import('./features/teacher-schedule/TeacherSchedulePage.jsx'));
const BatchManagementPage = lazy(() => import('./features/batch-management/BatchManagementPage.jsx'));
const FellowshipManagementPage = lazy(() => import('./features/fellowship-management/FellowshipManagementPage.jsx'));
const MakeupManagementPage = lazy(() => import('./features/makeup-management/MakeupManagementPage.jsx'));
const SystemHealthPage   = lazy(() => import('./features/system-health/SystemHealthPage.jsx'));
const NotificationCenterPage = lazy(() => import('./features/notification-center/NotificationCenterPage.jsx'));
const FailedSyncRetryCenterPage = lazy(() => import('./features/failed-sync-retry-center/FailedSyncRetryCenterPage.jsx'));
const WaitlistPage = lazy(() => import('./features/waitlist/WaitlistPage.jsx'));
const MessagesPage = lazy(() => import('./features/messages/MessagesPage.jsx'));
const AtRiskStudentsPage = lazy(() => import('./features/at-risk-students/AtRiskStudentsPage.jsx'));
const EmailCampaignsPage = lazy(() => import('./features/email-campaigns/EmailCampaignsPage.jsx'));
const MilestonesAdminPage = lazy(() => import('./features/milestones-admin/MilestonesAdminPage.jsx'));
const ClassEditorPage = lazy(() => import('./features/class-editor/ClassEditorPage.jsx'));
const HelpGuidePage = lazy(() => import('./features/help-guide/HelpGuidePage.jsx'));
const MoodleSettingsPage = lazy(() => import('./features/moodle-settings/MoodleSettingsPage.jsx'));
const StudentProgressPage = lazy(() => import('./features/student-progress/StudentProgressPage.jsx'));
const AvailabilityApprovalPage = lazy(() => import('./features/availability-approval/AvailabilityApprovalPage.jsx'));
const AdminReviewPage = lazy(() => import('./features/admin-review/AdminReviewPage.jsx'));
const AttendancePage = lazy(() => import('./features/attendance/AttendancePage.jsx'));
const BaptismReportPage = lazy(() => import('./features/baptism-report/BaptismReportPage.jsx'));
const GraduationStatusPage = lazy(() => import('./features/graduation-status/GraduationStatusPage.jsx'));
const NexusManagementPage = lazy(() => import('./features/nexus-management/NexusManagementPage.jsx'));
const TeacherPortalPage  = lazy(() => import('./features/teacher-portal/TeacherPortalPage.jsx'));
const PlaceholderPage    = lazy(() => import('./features/placeholder/PlaceholderPage.jsx'));
const ShowcasePage       = lazy(() => import('./features/design-showcase/ShowcasePage.jsx'));

// Legacy auth-client.js role sets: isAdmin() = ADMIN_ROLES; several pages allow +regional_secretary
const ADMIN_ROLES = ['superadmin', 'admin', 'subgroup_admin', 'pastor', 'principal'];
const OPERATIONAL_ROLES = [...ADMIN_ROLES, 'regional_secretary'];

function PageLoader() {
  return (
    <div className="rso-spinner-wrap">
      <div className="rso-spinner" />
    </div>
  );
}

function StaffShell({ title, children }) {
  return <Shell pageTitle={title}>{children}</Shell>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <OfflineIndicator />
          <PWAInstallPrompt />
          <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* Public */}
              <Route path="/auth/login" element={<LoginPage />} />
              <Route path="/auth/*" element={<Navigate to="/auth/login" replace />} />

              {/* Design system showcase (dev only) */}
              <Route
                path="/dev/showcase"
                element={
                  <StaffShell title="Design Showcase">
                    <ShowcasePage />
                  </StaffShell>
                }
              />

              {/* Staff — audit log (Phase 2 pilot) */}
              <Route
                path="/staff/audit-log"
                element={
                  <ProtectedRoute roles={['superadmin']}>
                    <StaffShell title="Audit Log">
                      <AuditLogPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* Phase 3 — read-only portals */}
              <Route
                path="/staff/admin-activity"
                element={
                  <ProtectedRoute roles={['admin', 'superadmin']}>
                    <StaffShell title="Admin Activity">
                      <AdminActivityPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/staff/role-audit"
                element={
                  <ProtectedRoute roles={['superadmin']}>
                    <StaffShell title="Role Audit">
                      <RoleAuditPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* Phase 3 — core admin pages */}
              <Route
                path="/staff/admin-management"
                element={
                  <ProtectedRoute roles={['superadmin', 'admin', 'principal']}>
                    <StaffShell title="Admin Management">
                      <AdminManagementPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/staff/admin-portal"
                element={
                  <ProtectedRoute roles={['superadmin', 'admin', 'subgroup_admin', 'pastor', 'principal', 'regional_secretary']}>
                    <StaffShell title="Admin Portal">
                      <AdminPortalPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/staff/admin-dashboard"
                element={<Navigate to="/staff/dashboards" replace />}
              />
              <Route
                path="/staff/reports"
                element={
                  <ProtectedRoute roles={['superadmin', 'admin', 'subgroup_admin', 'pastor', 'principal', 'regional_secretary']}>
                    <StaffShell title="Reports">
                      <ReportsPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* Phase 3 — read-heavy portals */}
              <Route
                path="/staff/data-exports"
                element={
                  <ProtectedRoute roles={['teacher', 'principal', 'subgroup_admin', 'pastor', 'admin', 'superadmin', 'regional_secretary']}>
                    <StaffShell title="Data Exports">
                      <DataExportsPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/staff/needs-attention"
                element={
                  <ProtectedRoute roles={['admin', 'regional_secretary']}>
                    <StaffShell title="Needs Attention">
                      <NeedsAttentionPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/staff/operational-trace"
                element={
                  <ProtectedRoute roles={['admin', 'superadmin', 'regional_secretary']}>
                    <StaffShell title="Operational Trace">
                      <OperationalTracePage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* Phase 3 — operational dashboards (landing page) */}
              <Route
                path="/staff/dashboards"
                element={
                  <ProtectedRoute roles={OPERATIONAL_ROLES}>
                    <StaffShell title="Dashboards">
                      <DashboardsPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* Phase 3 — applicant directory */}
              <Route
                path="/staff/applicant-directory"
                element={
                  <ProtectedRoute roles={['admin', 'superadmin', 'principal', 'regional_secretary']}>
                    <StaffShell title="Applicants">
                      <ApplicantDirectoryPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* Phase 3 — teacher portals */}
              <Route
                path="/staff/teacher-management"
                element={
                  <ProtectedRoute roles={OPERATIONAL_ROLES}>
                    <StaffShell title="Teacher Management">
                      <TeacherManagementPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/teacher/attendance"
                element={
                  <ProtectedRoute roles={[...OPERATIONAL_ROLES, 'teacher']}>
                    <StaffShell title="Teacher Attendance">
                      <TeacherAttendancePage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/staff/teacher-schedule"
                element={
                  <ProtectedRoute roles={OPERATIONAL_ROLES}>
                    <StaffShell title="Teacher Schedule">
                      <TeacherSchedulePage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* Phase 3 — batch & fellowship management */}
              <Route
                path="/staff/batch-management"
                element={
                  <ProtectedRoute roles={OPERATIONAL_ROLES}>
                    <StaffShell title="Batch Management">
                      <BatchManagementPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/staff/fellowship-management"
                element={
                  <ProtectedRoute roles={['admin', 'superadmin']}>
                    <StaffShell title="Fellowship Management">
                      <FellowshipManagementPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/staff/makeup-management"
                element={
                  <ProtectedRoute roles={['admin', 'superadmin', 'principal', 'subgroup_admin', 'pastor', 'regional_secretary', 'teacher']}>
                    <StaffShell title="Makeup Management">
                      <MakeupManagementPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* Phase 3 — system health & notification center */}
              <Route
                path="/staff/system-health"
                element={
                  <ProtectedRoute roles={ADMIN_ROLES}>
                    <StaffShell title="System Health">
                      <SystemHealthPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/staff/notification-center"
                element={
                  <ProtectedRoute roles={['admin', 'superadmin']}>
                    <StaffShell title="Notification Center">
                      <NotificationCenterPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/staff/failed-sync-retry-center"
                element={
                  <ProtectedRoute roles={ADMIN_ROLES}>
                    <StaffShell title="Failed Sync Retry Center">
                      <FailedSyncRetryCenterPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              <Route
                path="/staff/waitlist"
                element={
                  <ProtectedRoute roles={['admin', 'superadmin', 'regional_secretary']}>
                    <StaffShell title="Waiting Students">
                      <WaitlistPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* Messages — server-side scope enforcement via messaging-api; all staff + teachers */}
              <Route
                path="/staff/messages"
                element={
                  <ProtectedRoute roles={[...OPERATIONAL_ROLES, 'teacher']}>
                    <StaffShell title="Messages">
                      <MessagesPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* At-risk students — legacy: 5 admin roles + regional_secretary */}
              <Route
                path="/staff/at-risk-students"
                element={
                  <ProtectedRoute roles={OPERATIONAL_ROLES}>
                    <StaffShell title="At Risk Students">
                      <AtRiskStudentsPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* Email campaigns — legacy: requireAuth superadmin/admin */}
              <Route
                path="/staff/email-campaigns"
                element={
                  <ProtectedRoute roles={['superadmin', 'admin']}>
                    <StaffShell title="Email Campaigns">
                      <EmailCampaignsPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* Milestones — legacy: admin/superadmin/regional_secretary */}
              <Route
                path="/staff/milestones"
                element={
                  <ProtectedRoute roles={['admin', 'superadmin', 'regional_secretary']}>
                    <StaffShell title="Milestones">
                      <MilestonesAdminPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* Class editor — legacy: admin/superadmin/regional_secretary */}
              <Route
                path="/staff/class-editor"
                element={
                  <ProtectedRoute roles={['admin', 'superadmin', 'regional_secretary']}>
                    <StaffShell title="Class Editor">
                      <ClassEditorPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* Help guide — all staff + teachers (legacy page had no auth gate) */}
              <Route
                path="/staff/help-guide"
                element={
                  <ProtectedRoute roles={[...OPERATIONAL_ROLES, 'teacher']}>
                    <StaffShell title="Help Guide">
                      <HelpGuidePage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* Moodle settings — legacy: isAdmin() = ADMIN_ROLES */}
              <Route
                path="/staff/moodle-settings"
                element={
                  <ProtectedRoute roles={ADMIN_ROLES}>
                    <StaffShell title="Moodle Settings">
                      <MoodleSettingsPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* Availability approval — legacy: requireAuth superadmin/admin/pastor/principal/regional_secretary */}
              <Route
                path="/staff/availability-approval"
                element={
                  <ProtectedRoute roles={OPERATIONAL_ROLES}>
                    <StaffShell title="Availability Approval">
                      <AvailabilityApprovalPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* Student progress — legacy: admin/superadmin + regional_secretary */}
              <Route
                path="/staff/student-progress"
                element={
                  <ProtectedRoute roles={OPERATIONAL_ROLES}>
                    <StaffShell title="Student Progress">
                      <StudentProgressPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* Admin review — redirect to applicant directory review tab */}
              <Route
                path="/staff/admin-review"
                element={
                  <ProtectedRoute roles={OPERATIONAL_ROLES}>
                    <AdminReviewPage />
                  </ProtectedRoute>
                }
              />

              {/* Attendance — staff-side attendance tracking */}
              <Route
                path="/staff/attendance"
                element={
                  <ProtectedRoute roles={OPERATIONAL_ROLES}>
                    <StaffShell title="Attendance">
                      <AttendancePage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* Baptism report — legacy: principal/subgroup_admin/pastor/admin/superadmin/regional_secretary */}
              <Route
                path="/staff/baptism-report"
                element={
                  <ProtectedRoute roles={OPERATIONAL_ROLES}>
                    <StaffShell title="Baptism Report">
                      <BaptismReportPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* Graduation status — legacy: admin/superadmin + teachers + regional_secretary */}
              <Route
                path="/staff/graduation-status"
                element={
                  <ProtectedRoute roles={[...OPERATIONAL_ROLES, 'teacher']}>
                    <StaffShell title="Graduation Status">
                      <GraduationStatusPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* Nexus management — legacy: admin/superadmin only */}
              <Route
                path="/staff/nexus-management"
                element={
                  <ProtectedRoute roles={['admin', 'superadmin']}>
                    <StaffShell title="Nexus Management">
                      <NexusManagementPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* Staff — all other portals (placeholder until migrated) */}
              <Route
                path="/staff/*"
                element={
                  <ProtectedRoute>
                    <StaffShell title="Portal">
                      <PlaceholderPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* Teacher portal — tabbed landing */}
              <Route
                path="/teacher/index"
                element={
                  <ProtectedRoute roles={[...OPERATIONAL_ROLES, 'teacher']}>
                    <StaffShell title="Teacher Portal">
                      <TeacherPortalPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />
              <Route path="/teacher/roster" element={<Navigate to="/teacher/index?section=my-class" replace />} />
              <Route
                path="/teacher/progress"
                element={
                  <ProtectedRoute roles={[...OPERATIONAL_ROLES, 'teacher']}>
                    <StaffShell title="Student Progress">
                      <TeacherPortalPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/teacher/availability"
                element={
                  <ProtectedRoute roles={[...OPERATIONAL_ROLES, 'teacher']}>
                    <StaffShell title="My Availability">
                      <TeacherPortalPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />
              {/* Teacher catchall */}
              <Route
                path="/teacher/*"
                element={
                  <ProtectedRoute roles={[...OPERATIONAL_ROLES, 'teacher']}>
                    <StaffShell title="Teacher Portal">
                      <TeacherPortalPage />
                    </StaffShell>
                  </ProtectedRoute>
                }
              />

              {/* Root redirect */}
              <Route path="/" element={<Navigate to="/staff/dashboards" replace />} />
              <Route path="*" element={<Navigate to="/staff/dashboards" replace />} />
            </Routes>
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
