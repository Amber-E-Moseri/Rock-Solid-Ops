import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import EmptyState from '../components/ui/EmptyState.jsx';

describe('EmptyState explanations', () => {
  it('renders the subtitle prop, which twenty pages pass', () => {
    render(<EmptyState title="No staff" subtitle="Add a record to get started" />);
    expect(screen.getByText('No staff')).toBeInTheDocument();
    expect(screen.getByText('Add a record to get started')).toBeInTheDocument();
  });

  it('still renders the message prop', () => {
    render(<EmptyState title="No teachers" message="No teachers in this status" />);
    expect(screen.getByText('No teachers in this status')).toBeInTheDocument();
  });

  it('renders no explanation element when neither prop is given', () => {
    const { container } = render(<EmptyState title="Nothing here" />);
    expect(container.querySelector('.rso-empty-sub')).toBeNull();
  });
});
