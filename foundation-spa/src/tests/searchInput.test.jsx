import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SearchInput } from '../components/ui/Input.jsx';

describe('SearchInput', () => {
  it('keeps the left padding that clears the search icon when a caller passes its own style', () => {
    render(<SearchInput placeholder="Search…" style={{ flex: '1.2' }} />);
    const input = screen.getByPlaceholderText('Search…');

    expect(input.style.paddingLeft).toBe('34px');
    expect(input.style.flexGrow).toBe('1.2');
  });

  it('applies the default left padding when no style is passed', () => {
    render(<SearchInput placeholder="Find…" />);
    expect(screen.getByPlaceholderText('Find…').style.paddingLeft).toBe('34px');
  });
});
