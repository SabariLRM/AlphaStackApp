import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface ToastState {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

interface UiApi {
  toast(text: string, action?: ToastState['action']): void;
  confirm(opts: ConfirmOptions): Promise<boolean>;
}

const UiContext = createContext<UiApi | null>(null);

export function useUi(): UiApi {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi outside UiProvider');
  return ctx;
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const showToast = useCallback((text: string, action?: ToastState['action']) => {
    window.clearTimeout(timer.current);
    setToast({ id: Date.now(), text, action });
    timer.current = window.setTimeout(() => setToast(null), action ? 7000 : 4000);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ ...opts, resolve })), []);

  const close = (value: boolean) => {
    dialog?.resolve(value);
    setDialog(null);
  };

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <UiContext.Provider value={{ toast: showToast, confirm }}>
      {children}
      {toast && (
        <div className="toast" role="status" aria-live="polite" key={toast.id}>
          <span style={{ flex: 1 }}>{toast.text}</span>
          {toast.action && (
            <button
              onClick={() => {
                toast.action!.run();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
      {dialog && (
        <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
            <h2 id="dlg-title">{dialog.title}</h2>
            {dialog.body && <div>{dialog.body}</div>}
            <div className="actions">
              <button className="btn text" onClick={() => close(false)}>
                Cancel
              </button>
              <button className={`btn ${dialog.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => close(true)}>
                {dialog.confirmLabel ?? 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </UiContext.Provider>
  );
}

export function Spinner() {
  return (
    <div className="center" style={{ padding: 48 }}>
      <div className="spinner" role="progressbar" aria-label="Loading" />
    </div>
  );
}
