import React, { createContext, useCallback, useContext, useState } from 'react';
import { ConfirmModal } from '@/components/ui/modals';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'default' | 'destructive';
  onConfirm: () => void;
  onCancel?: () => void;
}

interface ConfirmContextValue {
  showConfirm: (options: ConfirmOptions) => void;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return ctx;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmOptions | null>(null);

  const showConfirm = useCallback((options: ConfirmOptions) => {
    setState(options);
  }, []);

  const handleClose = useCallback(() => {
    state?.onCancel?.();
    setState(null);
  }, [state]);

  const handleConfirm = useCallback(() => {
    state?.onConfirm();
    setState(null);
  }, [state]);

  return (
    <ConfirmContext.Provider value={{ showConfirm }}>
      {children}
      {state && (
        <ConfirmModal
          visible={true}
          onClose={handleClose}
          onConfirm={handleConfirm}
          title={state.title}
          message={state.message}
          confirmLabel={state.confirmLabel}
          cancelLabel={state.cancelLabel}
          confirmVariant={state.confirmVariant}
        />
      )}
    </ConfirmContext.Provider>
  );
}
