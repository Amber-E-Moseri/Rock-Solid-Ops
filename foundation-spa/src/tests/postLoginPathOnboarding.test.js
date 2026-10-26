import { describe, it, expect } from 'vitest';
import { postLoginPath, TEACHER_APPLICATION_PATH } from '../features/auth/postLoginPath.js';

describe('postLoginPath with the onboarding gate', () => {
  it('sends a pending applicant to their application when onboarding is released', () => {
    expect(postLoginPath({ role: 'pending', teacherOnboardingEnabled: true })).toBe(TEACHER_APPLICATION_PATH);
  });

  it('overrides a portal next target for a pending applicant', () => {
    expect(postLoginPath({ role: 'pending', next: '/teacher/index', teacherOnboardingEnabled: true })).toBe(TEACHER_APPLICATION_PATH);
  });

  it('keeps the existing staff landing for pending accounts while onboarding is off', () => {
    expect(postLoginPath({ role: 'pending' })).toBe('/staff/dashboards');
    expect(postLoginPath({ role: 'pending', teacherOnboardingEnabled: false })).toBe('/staff/dashboards');
  });

  it('never routes elevated or teacher roles to the applicant page', () => {
    for (const role of ['teacher', 'admin', 'superadmin', 'principal']) {
      expect(postLoginPath({ role, teacherOnboardingEnabled: true })).not.toBe(TEACHER_APPLICATION_PATH);
    }
  });

  it('still refuses unsafe next targets', () => {
    expect(postLoginPath({ role: 'admin', next: '//evil.example', teacherOnboardingEnabled: true })).toBe('/staff/dashboards');
  });
});
