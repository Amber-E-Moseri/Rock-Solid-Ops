import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Decorative emoji were replaced with line icons (components/ui/NamedIcon.jsx) or removed.
// These symbols are deliberately kept because they carry meaning in text:
// check and cross marks (status text), the menu glyph, and sort arrows.
const ALLOWED = new Set([0x2713, 0x2717, 0x2630, 0x25b2, 0x25bc, 0x2195]);
const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Emoji_Presentation}/gu;
const SOURCE_EXT = /\.(jsx?|tsx?|html|css|mjs)$/;

function collect(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/^(node_modules|dist|archive|docs|tests)$/.test(entry.name)) continue;
      collect(full, out);
    } else if (SOURCE_EXT.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function decorativeEmojiIn(files) {
  const hits = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.match(PICTOGRAPH) || []) {
      if (!ALLOWED.has(match.codePointAt(0))) hits.push(`${file}: ${match}`);
    }
  }
  return hits;
}

describe('user-facing UI contains no decorative emoji', () => {
  it('SPA source', () => {
    expect(decorativeEmojiIn(collect(path.join(process.cwd(), 'src')))).toEqual([]);
  });

  it('legacy Foundation pages and scripts', () => {
    const root = path.resolve(process.cwd(), '..', 'foundation');
    expect(decorativeEmojiIn(collect(root))).toEqual([]);
  });
});
