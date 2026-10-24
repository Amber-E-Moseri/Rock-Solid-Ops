// Route definitions for the teacher onboarding screens. App.jsx registers the public onboarding routes
// only while TEACHER_ONBOARDING_CERTIFIED is true (src/releaseHolds.js). The reset-password route is an
// existing public path, so it always uses the hardened page. Pages load lazily, so an unreleased
// feature costs nothing on the first load.
import { lazy, Suspense } from 'react';
import { Route } from 'react-router-dom';
import './teacherOnboarding.css';

const TeacherRegisterPage = lazy(() => import('./pages/TeacherRegisterPage.jsx'));
const CheckEmailPage = lazy(() => import('./pages/CheckEmailPage.jsx'));
const ConfirmEmailPage = lazy(() => import('./pages/ConfirmEmailPage.jsx'));
const ApplicationPage = lazy(() => import('./pages/ApplicationPage.jsx'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage.jsx'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage.jsx'));

export const TEACHER_ONBOARDING_PATHS = Object.freeze({
  register: '/auth/teacher/register',
  checkEmail: '/auth/teacher/check-email',
  confirm: '/auth/teacher/confirm',
  application: '/auth/teacher/application',
  forgotPassword: '/auth/forgot-password',
  resetPassword: '/auth/reset-password',
});

function Lazy({ children }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}

// New public entry points. Registered by App.jsx only when the feature is certified.
export const teacherOnboardingRoutes = [
  <Route key="teacher-register" path={TEACHER_ONBOARDING_PATHS.register} element={<Lazy><TeacherRegisterPage /></Lazy>} />,
  <Route key="teacher-check-email" path={TEACHER_ONBOARDING_PATHS.checkEmail} element={<Lazy><CheckEmailPage /></Lazy>} />,
  <Route key="teacher-confirm" path={TEACHER_ONBOARDING_PATHS.confirm} element={<Lazy><ConfirmEmailPage /></Lazy>} />,
  <Route key="teacher-application" path={TEACHER_ONBOARDING_PATHS.application} element={<Lazy><ApplicationPage /></Lazy>} />,
  <Route key="forgot-password" path={TEACHER_ONBOARDING_PATHS.forgotPassword} element={<Lazy><ForgotPasswordPage /></Lazy>} />,
];

// Element for the existing "/auth/reset-password" route.
export function ResetPasswordRoute() {
  return <Lazy><ResetPasswordPage /></Lazy>;
}
