// Staff route for the teacher application review screen. App.jsx registers it inside the Routes block,
// wrapped by the same guard the rest of the staff area uses. The page itself also checks the role
// (supplementary), and the database reviewer gate is the enforcement point.
import { lazy, Suspense } from 'react';
import { Route } from 'react-router-dom';
import ProtectedRoute from '../../components/layout/ProtectedRoute.jsx';
import Shell from '../../components/layout/Shell.jsx';
import { REVIEWER_ROLES } from './lib/reviewApi.js';

const TeacherApplicationsPage = lazy(() => import('./TeacherApplicationsPage.jsx'));

export const TEACHER_APPLICATIONS_PATH = '/staff/teacher-applications';

export const teacherApplicationsRoute = (
  <Route
    key="teacher-applications"
    path={TEACHER_APPLICATIONS_PATH}
    element={
      <ProtectedRoute roles={REVIEWER_ROLES}>
        <Shell pageTitle="Teacher Applications">
          <Suspense fallback={null}>
            <TeacherApplicationsPage />
          </Suspense>
        </Shell>
      </ProtectedRoute>
    }
  />
);
