import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Modal from '../components/ui/Modal.jsx';

// Regression guard: Modal must require `open` prop to render content.
// Callers that wrap Modal in `{condition && <Modal>}` WITHOUT `open` produce
// a permanently hidden modal because Modal's AnimatePresence checks `open`
// internally. This test suite locks that contract so the defect cannot silently
// return. Fixed in this session for NexusManagementPage, TeacherSchedulePage,
// and FellowshipManagementPage.

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }) => children,
  motion: {
    div: ({ children, ...props }) => <div {...props}>{children}</div>,
  },
}));

describe('Modal component — open prop contract', () => {
  it('renders nothing when open is undefined (missing prop)', () => {
    const { container } = render(
      <Modal onClose={() => {}} title="Test">
        <span>modal content</span>
      </Modal>
    );
    expect(screen.queryByText('modal content')).toBeNull();
    expect(container.querySelector('.rso-modal-overlay')).toBeNull();
  });

  it('renders nothing when open is false', () => {
    render(
      <Modal open={false} onClose={() => {}} title="Test">
        <span>hidden content</span>
      </Modal>
    );
    expect(screen.queryByText('hidden content')).toBeNull();
  });

  it('renders content when open is true', () => {
    render(
      <Modal open={true} onClose={() => {}} title="Test Dialog">
        <span>visible content</span>
      </Modal>
    );
    expect(screen.getByText('visible content')).toBeTruthy();
    expect(screen.getByText('Test Dialog')).toBeTruthy();
  });

  it('renders content when open is a truthy value (shorthand boolean prop)', () => {
    render(
      <Modal open onClose={() => {}} title="Test">
        <span>truthy content</span>
      </Modal>
    );
    expect(screen.getByText('truthy content')).toBeTruthy();
  });

  it('renders footer when provided and open', () => {
    render(
      <Modal open onClose={() => {}} title="Test" footer={<button>Save</button>}>
        content
      </Modal>
    );
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('does NOT render footer when open is false', () => {
    render(
      <Modal open={false} onClose={() => {}} title="Test" footer={<button>Save</button>}>
        content
      </Modal>
    );
    expect(screen.queryByText('Save')).toBeNull();
  });
});
