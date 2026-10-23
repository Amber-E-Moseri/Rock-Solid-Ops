import { describe, it, expect } from 'vitest';
import {
  resolveDevBypassRole,
  resolveFixturesEnabled,
  resolveFixtureAlias,
} from '../lib/devFlags.js';

// A production-shaped environment: every opt-in is set, but DEV is false.
const PROD_ENV = {
  DEV: false,
  PROD: true,
  MODE: 'production',
  VITE_ENABLE_DEV_BYPASS: 'true',
  VITE_BYPASS_ROLE: 'superadmin',
  VITE_PREVIEW_FIXTURES: 'true',
};

const DEV_ENV = { ...PROD_ENV, DEV: true, PROD: false, MODE: 'development' };

describe('production builds cannot enable development mechanisms', () => {
  it('ignores VITE_BYPASS_ROLE even with the opt-in and a local host', () => {
    expect(resolveDevBypassRole(PROD_ENV, 'localhost')).toBe('');
    expect(resolveDevBypassRole(PROD_ENV, '127.0.0.1')).toBe('');
  });

  it('does not enable the synthetic fixture client', () => {
    expect(resolveFixturesEnabled(PROD_ENV, 'localhost')).toBe(false);
  });

  it('gives the build no Supabase alias', () => {
    expect(resolveFixtureAlias({ command: 'build', env: PROD_ENV })).toBeNull();
  });
});

describe('development opt-ins stay narrow', () => {
  it('bypass needs DEV, the explicit flag, a role and a local host', () => {
    expect(resolveDevBypassRole(DEV_ENV, 'localhost')).toBe('superadmin');
    expect(resolveDevBypassRole({ ...DEV_ENV, VITE_ENABLE_DEV_BYPASS: undefined }, 'localhost')).toBe('');
    expect(resolveDevBypassRole(DEV_ENV, 'example.com')).toBe('');
    expect(resolveDevBypassRole({ ...DEV_ENV, MODE: 'test' }, 'localhost')).toBe('');
  });

  it('fixtures need DEV, the explicit flag and a local host', () => {
    expect(resolveFixturesEnabled(DEV_ENV, 'localhost')).toBe(true);
    expect(resolveFixturesEnabled(DEV_ENV, 'example.com')).toBe(false);
    expect(resolveFixturesEnabled({ ...DEV_ENV, VITE_PREVIEW_FIXTURES: 'false' }, 'localhost')).toBe(false);
  });

  it('alias applies only to the dev server with the opt-in', () => {
    expect(resolveFixtureAlias({ command: 'serve', env: DEV_ENV })).toBe('fixtures');
    expect(resolveFixtureAlias({ command: 'serve', env: { VITE_PREVIEW_FIXTURES: 'false' } })).toBeNull();
  });
});
