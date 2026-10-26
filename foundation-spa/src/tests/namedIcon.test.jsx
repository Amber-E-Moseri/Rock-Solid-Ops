import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import NamedIcon from '../components/ui/NamedIcon.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';

describe('NamedIcon', () => {
  it('renders a decorative line icon for a known name', () => {
    const html = renderToStaticMarkup(<NamedIcon name="inbox" />);
    expect(html).toContain('<svg');
    expect(html).toContain('aria-hidden="true"');
  });

  it('renders nothing for an unknown name', () => {
    expect(renderToStaticMarkup(<NamedIcon name="does-not-exist" />)).toBe('');
  });
});

describe('EmptyState', () => {
  it('uses a line icon and no emoji by default', () => {
    const html = renderToStaticMarkup(<EmptyState title="Nothing here" subtitle="Try again" />);
    expect(html).toContain('<svg');
    expect(html).toContain('Nothing here');
    expect(html).toContain('Try again');
  });
});
