import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

export default function Modal({ open, onClose, title, children, footer, width }) {
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

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
            style={width ? { width: `min(${width}px, 96vw)` } : undefined}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.18 }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <div className="rso-modal-head">
              <h2 className="rso-modal-title">{title}</h2>
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
