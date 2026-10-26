import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

// Open dialogs, outermost first. Only the top of the stack handles keys and focus.
const openDialogs = [];

function focusableIn(root) {
  return [...root.querySelectorAll(FOCUSABLE)];
}

function trapFocus(event, dialog) {
  const items = focusableIn(dialog);
  if (items.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  const inside = dialog.contains(active);
  if (event.shiftKey) {
    if (!inside || active === first || active === dialog) {
      event.preventDefault();
      last.focus();
    }
  } else if (!inside || active === last) {
    event.preventDefault();
    first.focus();
  }
}

// Marks every element outside the path to the overlay as inert, so background content
// cannot take keyboard focus or reach assistive technology. The toast stack stays live.
function makeBackgroundInert(overlay) {
  const marked = [];
  let node = overlay;
  while (node && node !== document.body && node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling === node || sibling.hasAttribute('inert') || sibling.classList.contains('rso-toast-stack')) continue;
      sibling.setAttribute('inert', '');
      marked.push(sibling);
    }
    node = node.parentElement;
  }
  return () => marked.forEach((el) => el.removeAttribute('inert'));
}

export default function Modal({ open, onClose, title, children, footer, width }) {
  const overlayRef = useRef(null);
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const returnTarget = document.activeElement;
    const entry = { dialog };
    openDialogs.push(entry);
    const restoreBackground = makeBackgroundInert(overlayRef.current);

    if (!dialog.contains(document.activeElement)) {
      (focusableIn(dialog)[0] ?? dialog).focus();
    }

    const onKeyDown = (event) => {
      if (openDialogs[openDialogs.length - 1] !== entry) return;
      if (event.key === 'Escape') {
        onCloseRef.current();
      } else if (event.key === 'Tab') {
        trapFocus(event, dialog);
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      restoreBackground();
      openDialogs.splice(openDialogs.indexOf(entry), 1);
      if (returnTarget && returnTarget.isConnected && typeof returnTarget.focus === 'function') {
        returnTarget.focus();
      }
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="rso-modal-overlay"
          ref={overlayRef}
          onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className="rso-modal"
            ref={dialogRef}
            tabIndex={-1}
            style={width ? { width: `min(${width}px, 96vw)` } : undefined}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.18 }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            aria-labelledby={titleId}
          >
            <div className="rso-modal-head">
              <h2 id={titleId} className="rso-modal-title">{title}</h2>
              <button
                className="icon-btn"
                onClick={onClose}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="rso-modal-body">{children}</div>
            {footer && <div className="rso-modal-foot">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
