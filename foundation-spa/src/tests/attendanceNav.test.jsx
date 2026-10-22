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
const REGIONAL = { role: 'regional_secretary', full_name: 'Regional Secretary', email: 'rs@example.test' };

function renderShell(profile) {
  state.profile = profile;
  return render(
    <MemoryRouter initialEntries={['/staff/dashboards']}>
      <Shell pageTitle="Dashboard"><p>content</p></Shell>
    </MemoryRouter>
  );
}

describe('attendance navigation by role', () => {
  it('sends an admin to the staff attendance view, and not to the teacher page', () => {
    renderShell(ADMIN);
    expect(screen.getByRole('link', { name: 'Attendance' }).getAttribute('href')).toBe('/staff/attendance');
  });

  it('sends a regional secretary to the staff attendance view', () => {
    renderShell(REGIONAL);
    expect(screen.getByRole('link', { name: 'Attendance' }).getAttribute('href')).toBe('/staff/attendance');
  });

  it('keeps a teacher on the teacher attendance page', () => {
    renderShell(TEACHER);
    expect(screen.getByRole('link', { name: 'Attendance' }).getAttribute('href')).toBe('/teacher/attendance');
  });
});
