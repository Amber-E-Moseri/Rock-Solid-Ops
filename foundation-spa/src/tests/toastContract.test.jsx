import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, act } from '@testing-library/react';
import { ToastProvider, useToast } from '../context/ToastContext.jsx';

// useToast() returns the toast function itself. Pages that destructured
// `{ addToast }` from it threw "addToast is not a function" at runtime.
const PAGES_USING_TOAST = [
  '../features/admin-management/AdminManagementPage.jsx',
  '../features/batch-management/BatchManagementPage.jsx',
  '../features/fellowship-management/FellowshipManagementPage.jsx',
  '../features/makeup-management/MakeupManagementPage.jsx',
  '../features/needs-attention/NeedsAttentionPage.jsx',
  '../features/reports/ReportsPage.jsx',
  '../features/role-audit/RoleAuditPage.jsx',
  '../features/teacher-attendance/TeacherAttendancePage.jsx',
  '../features/teacher-management/TeacherManagementPage.jsx',
  '../features/teacher-portal/TeacherPortalPage.jsx',
  '../features/teacher-schedule/TeacherSchedulePage.jsx',
];

describe('useToast contract', () => {
  it('returns a callable toast function', () => {
    let received;
    function Probe() {
      received = useToast();
      return null;
    }
    render(<ToastProvider><Probe /></ToastProvider>);
    expect(typeof received).toBe('function');
    expect(() => act(() => received('Saved', 'success'))).not.toThrow();
  });

  it.each(PAGES_USING_TOAST)('%s binds the toast function directly', (relPath) => {
    const source = readFileSync(new URL(relPath, import.meta.url), 'utf8');
    expect(source).not.toMatch(/\{\s*addToast\s*\}\s*=\s*useToast\(\)/);
    expect(source).toMatch(/const addToast = useToast\(\);/);
  });
});
