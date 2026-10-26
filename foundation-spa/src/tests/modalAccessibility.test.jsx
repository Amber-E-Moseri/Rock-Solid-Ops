import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import Modal from '../components/ui/Modal.jsx';

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }) => children,
  motion: {
    div: ({ children, initial, animate, exit, transition, ...props }) => <div {...props}>{children}</div>,
  },
}));

function Dialog({ onClose = () => {} }) {
  return (
    <Modal open onClose={onClose} title="Edit thing" footer={<button>Save</button>}>
      <input aria-label="Name" />
      <button>Second action</button>
    </Modal>
  );
}

function Harness({ nested = false }) {
  const [open, setOpen] = useState(false);
  const [inner, setInner] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open trigger</button>
      <p>Background content</p>
      <button>Background button</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Edit thing" footer={<button>Save</button>}>
        <input aria-label="Name" />
        {nested && <button onClick={() => setInner(true)}>Open inner</button>}
        <Modal open={inner} onClose={() => setInner(false)} title="Confirm">
          <button>Yes</button>
        </Modal>
      </Modal>
    </div>
  );
}

describe('Modal keyboard and screen-reader behaviour', () => {
  it('moves focus inside the dialog when it opens', () => {
    render(<Dialog />);
    const dialog = screen.getByRole('dialog', { name: 'Edit thing' });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('keeps Tab inside the dialog, wrapping from the last control to the first', async () => {
    const user = userEvent.setup();
    render(<Dialog />);
    const dialog = screen.getByRole('dialog', { name: 'Edit thing' });
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('keeps Shift+Tab inside the dialog, wrapping from the first control to the last', async () => {
    const user = userEvent.setup();
    render(<Dialog />);
    const dialog = screen.getByRole('dialog', { name: 'Edit thing' });
    for (let i = 0; i < 6; i += 1) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the trigger when it closes', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open trigger' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Edit thing' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(trigger).not.toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Edit thing' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('makes background content inert while open, and restores it when closed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByText('Background content').closest('[inert]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open trigger' }));
    expect(screen.getByText('Background content').closest('[inert]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Background button' }).closest('[inert]')).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.getByText('Background content').closest('[inert]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Background button' }).closest('[inert]')).toBeNull();
  });

  it('keeps the dialog accessible name from its title', () => {
    render(<Dialog />);
    expect(screen.getByRole('dialog', { name: 'Edit thing' })).toHaveAccessibleName('Edit thing');
  });

  it('closes only the innermost dialog on Escape, and keeps Tab inside it', async () => {
    const user = userEvent.setup();
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    function Nested() {
      const [inner, setInner] = useState(false);
      return (
        <Modal open onClose={outerClose} title="Outer">
          <button onClick={() => setInner(true)}>Open inner</button>
          <Modal open={inner} onClose={() => { innerClose(); setInner(false); }} title="Inner">
            <button>Yes</button>
          </Modal>
        </Modal>
      );
    }
    render(<Nested />);
    await user.click(screen.getByRole('button', { name: 'Open inner' }));
    const inner = screen.getByRole('dialog', { name: 'Inner' });
    expect(inner.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 3; i += 1) {
      await user.tab();
      expect(inner.contains(document.activeElement)).toBe(true);
    }
    await user.keyboard('{Escape}');
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });

  it('does not take focus from a field that already has it on open', () => {
    function WithAutoFocus() {
      return (
        <Modal open onClose={() => {}} title="Form">
          <button>Cancel</button>
          <input aria-label="Email" autoFocus />
        </Modal>
      );
    }
    render(<WithAutoFocus />);
    expect(document.activeElement).toBe(screen.getByLabelText('Email'));
  });
});
