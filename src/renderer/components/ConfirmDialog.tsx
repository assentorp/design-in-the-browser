import { useState, useEffect, useRef } from 'react';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PendingConfirm {
  opts: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
}

// Module-level bridge so any code (not just React components) can ask for
// confirmation. The host registers itself on mount.
let showConfirm: ((pending: PendingConfirm) => void) | null = null;

// Styled in-app replacement for window.confirm(). Resolves true when the
// user confirms, false when they cancel or press Escape.
export function appConfirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (showConfirm) {
      showConfirm({ opts, resolve });
    } else {
      // Host not mounted (shouldn't happen) — fall back to the native dialog
      resolve(window.confirm(opts.message ? `${opts.title}\n\n${opts.message}` : opts.title));
    }
  });
}

// Mounted once in App. Renders the active confirmation dialog, if any.
export default function ConfirmDialogHost() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    showConfirm = (next) => {
      setPending((prev) => {
        // A second confirm while one is open cancels the first
        prev?.resolve(false);
        return next;
      });
    };
    return () => {
      showConfirm = null;
    };
  }, []);

  useEffect(() => {
    if (pending) confirmBtnRef.current?.focus();
  }, [pending]);

  if (!pending) return null;

  const { opts } = pending;
  const close = (confirmed: boolean) => {
    pending.resolve(confirmed);
    setPending(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close(false);
    } else if (e.key === 'Enter') {
      e.stopPropagation();
      close(true);
    }
  };

  return (
    <div className="confirm-overlay" onClick={() => close(false)} onKeyDown={handleKeyDown}>
      <div className="confirm-dialog" role="alertdialog" aria-label={opts.title} onClick={(e) => e.stopPropagation()}>
        <h3 className="confirm-title">{opts.title}</h3>
        {opts.message && <p className="confirm-message">{opts.message}</p>}
        <div className="confirm-actions">
          <button type="button" className="btn btn-secondary" onClick={() => close(false)}>
            {opts.cancelLabel || 'Cancel'}
          </button>
          <button
            type="button"
            ref={confirmBtnRef}
            className={`btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => close(true)}
          >
            {opts.confirmLabel || 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
