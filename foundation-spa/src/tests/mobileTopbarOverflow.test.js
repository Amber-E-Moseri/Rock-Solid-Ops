import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// jsdom has no layout engine, so this cannot measure overflow. It pins the rules
// that keep the teacher top bar inside a 375px viewport. Browser measurement is
// recorded in docs/migration-log.md.
// Vitest runs from foundation-spa/, so resolve from there (jsdom has no file URLs).
const css = readFileSync(resolve(process.cwd(), 'src/styles/index.css'), 'utf8');

function mediaBlock(query) {
  const start = css.indexOf(`@media (max-width: ${query}px) {`);
  if (start === -1) return '';
  let depth = 0;
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') { depth--; if (depth === 0) return css.slice(start, i + 1); }
  }
  return '';
}

describe('mobile top bar fits a 375px viewport', () => {
  const tablet = mediaBlock(768);
  const phone = mediaBlock(480);

  it('lets the content column shrink below its min-content width', () => {
    expect(tablet).toMatch(/\.rso-content\s*\{[^}]*min-width:\s*0/);
  });

  it('truncates the breadcrumb instead of letting it set the top bar width', () => {
    expect(tablet).toMatch(/\.topbar-breadcrumb\s*\{[^}]*min-width:\s*0/);
    expect(tablet).toMatch(/\.topbar-breadcrumb\s*\{[^}]*overflow:\s*hidden/);
  });

  it('hides the user name and role text on phones so the chip stays small', () => {
    expect(phone).toMatch(/\.user-meta\s*\{[^}]*display:\s*none/);
  });
});
