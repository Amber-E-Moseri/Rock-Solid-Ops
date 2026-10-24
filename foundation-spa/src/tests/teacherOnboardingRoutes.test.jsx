import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { makeClient } from './teacherOnboardingHarness.js';

const mock = vi.hoisted(() => ({ client: null }));
vi.mock('../supabase.js', () => ({ get supabase() { return mock.client; } }));

import { teacherOnboardingRoutes, TEACHER_ONBOARDING_PATHS, ResetPasswordRoute } from '../features/teacher-onboarding/routes.jsx';
import { AUTH_REDIRECT_PATHS } from '../features/teacher-onboarding/lib/redirects.js';

function mountAt(path) {
  mock.client = makeClient();
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {teacherOnboardingRoutes}
        <Route path="/auth/reset-password" element={<ResetPasswordRoute />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('teacher onboarding routes', () => {
  it('mounts each public screen at its path', async () => {
    mountAt(TEACHER_ONBOARDING_PATHS.register);
    expect(await screen.findByRole('heading', { name: 'Apply to teach' })).toBeInTheDocument();
  });

  it('mounts the forgot-password screen', async () => {
    mountAt(TEACHER_ONBOARDING_PATHS.forgotPassword);
    expect(await screen.findByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
  });

  it('keeps every onboarding path outside the teacher and staff portals', () => {
    for (const path of Object.values(TEACHER_ONBOARDING_PATHS)) {
      expect(path.startsWith('/teacher') || path.startsWith('/staff')).toBe(false);
      expect(path.startsWith('/auth/')).toBe(true);
    }
  });

  it('only redirects email links to allowlisted auth paths', () => {
    expect(Object.values(AUTH_REDIRECT_PATHS).sort()).toEqual(['/auth/reset-password', '/auth/teacher/confirm']);
  });

  it('exports the same route count as the integration document expects', () => {
    expect(teacherOnboardingRoutes).toHaveLength(5);
    expect(teacherOnboardingRoutes.every((element) => element.type === Route)).toBe(true);
  });
});

describe('responsive stylesheet', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/features/teacher-onboarding/teacherOnboarding.css'), 'utf8');

  it('defines a phone breakpoint with full-width actions', () => {
    expect(css).toMatch(/@media \(max-width: 640px\)/);
    expect(css).toMatch(/\.to-actions \.rso-btn\s*\{\s*width: 100%/);
  });

  it('uses 16px form controls on phones to prevent focus zoom', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 640px)'));
    expect(phone).toMatch(/\.rso-input,\s*\.to-card \.rso-select,\s*\.to-card \.rso-textarea \{\s*font-size: 16px/);
  });

  it('keeps cards inside the viewport', () => {
    expect(css).toMatch(/\.to-card \{[^}]*max-width: 520px/s);
    expect(css).toMatch(/\.to-card \{[^}]*min-width: 0/s);
  });

  it('uses shared tokens rather than hard-coded colours', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});
