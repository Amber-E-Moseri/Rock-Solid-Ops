import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Only the auth hook is replaced. Each test sets the signed-in profile before rendering.
const state = vi.hoisted(() => ({ profile: null }));

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ profile: state.profile, signOut: vi.fn() }),
}));

vi.mock('../components/pwa/PushToggle.jsx', () => ({
  PushToggle: () => null,
}));

import Shell from '../components/layout/Shell.jsx';

const TEACHER = { role: 'teacher', full_name: 'RSO Test Teacher', email: 'teacher@example.test' };
const ADMIN = { role: 'admin', full_name: 'RSO Test Staff', email: 'admin@example.test' };

function renderShell(profile) {
  state.profile = profile;
  return render(
    <MemoryRouter initialEntries={['/teacher/index']}>
      <Shell pageTitle="Teacher Portal"><p>content</p></Shell>
    </MemoryRouter>
  );
}

describe('teacher navigation', () => {
  it('points Schedule and Student Progress at teacher routes', () => {
    renderShell(TEACHER);
    expect(screen.getByRole('link', { name: 'Schedule' }).getAttribute('href')).toBe('/teacher/index');
    expect(screen.getByRole('link', { name: 'Student Progress' }).getAttribute('href')).toBe('/teacher/progress');
  });

  it('links a teacher only to routes a teacher may open', () => {
    renderShell(TEACHER);
    const navHrefs = ['Attendance', 'Schedule', 'Student Progress', 'Help Guide']
      .map((name) => screen.getByRole('link', { name }).getAttribute('href'));
    // /staff/help-guide admits teachers (App.jsx and routeRoles.js). No other staff route is linked.
    expect(navHrefs).toEqual(['/teacher/attendance', '/teacher/index', '/teacher/progress', '/staff/help-guide']);
  });

  it('labels the teacher sidebar and breadcrumb as Teacher, not Admin', () => {
    const { container } = renderShell(TEACHER);
    expect(container.querySelector('.sb-sub').textContent).toBe('Teacher Portal');
    expect(container.querySelector('.topbar-breadcrumb span').textContent).toBe('Teacher');
  });
});

describe('admin navigation is unchanged', () => {
  it('keeps the staff routes for Schedule and Student Progress', () => {
    renderShell(ADMIN);
    expect(screen.getByRole('link', { name: 'Schedule' }).getAttribute('href')).toBe('/staff/teacher-schedule');
    expect(screen.getByRole('link', { name: 'Student Progress' }).getAttribute('href')).toBe('/staff/student-progress');
  });

  it('keeps the Admin labels', () => {
    const { container } = renderShell(ADMIN);
    expect(container.querySelector('.sb-sub').textContent).toBe('Admin Portal');
    expect(container.querySelector('.topbar-breadcrumb span').textContent).toBe('Admin');
  });
});
