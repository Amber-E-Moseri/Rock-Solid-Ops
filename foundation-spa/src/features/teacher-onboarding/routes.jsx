// Route integration for the teacher onboarding screens. The SPA shell (App.jsx) imports this module
// and places the routes above its "/auth/*" catch-all. See docs/TEACHER_ONBOARDING_UI.md for the exact
// integration steps. This module does not modify any existing route.
import { Route } from 'react-router-dom';
import ApplicationPage from './pages/ApplicationPage.jsx';
import CheckEmailPage from './pages/CheckEmailPage.jsx';
import ConfirmEmailPage from './pages/ConfirmEmailPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import TeacherRegisterPage from './pages/TeacherRegisterPage.jsx';
import './teacherOnboarding.css';

export const TEACHER_ONBOARDING_PATHS = Object.freeze({
  register: '/auth/teacher/register',
  checkEmail: '/auth/teacher/check-email',
  confirm: '/auth/teacher/confirm',
  application: '/auth/teacher/application',
  forgotPassword: '/auth/forgot-password',
  resetPassword: '/auth/reset-password',
});

// Public routes: none of these sits under /teacher or /staff, so ProtectedRoute does not apply.
export const teacherOnboardingRoutes = [
  <Route key="teacher-register" path={TEACHER_ONBOARDING_PATHS.register} element={<TeacherRegisterPage />} />,
  <Route key="teacher-check-email" path={TEACHER_ONBOARDING_PATHS.checkEmail} element={<CheckEmailPage />} />,
  <Route key="teacher-confirm" path={TEACHER_ONBOARDING_PATHS.confirm} element={<ConfirmEmailPage />} />,
  <Route key="teacher-application" path={TEACHER_ONBOARDING_PATHS.application} element={<ApplicationPage />} />,
  <Route key="forgot-password" path={TEACHER_ONBOARDING_PATHS.forgotPassword} element={<ForgotPasswordPage />} />,
];

// Replaces the element on the existing "/auth/reset-password" route.
export { ResetPasswordPage };
