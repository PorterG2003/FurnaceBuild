import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AccessIssueDialog, ConfirmModal } from '@/components/ui/modals';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'default' | 'destructive';
  onConfirm: () => void;
  onCancel?: () => void;
}

export interface AccessIssueDialogOptions {
  title: string;
  message: string;
  wide?: boolean;
  primaryLabel?: string;
  secondaryLabel?: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
  onClose?: () => void;
}

interface DialogContextValue {
  showConfirm: (options: ConfirmOptions) => void;
  showAccessDialog: (options: AccessIssueDialogOptions) => void;
  closeDialog: () => void;
}

type DialogState =
  | { kind: 'confirm'; options: ConfirmOptions }
  | { kind: 'access'; options: AccessIssueDialogOptions }
  | null;

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error('useDialog must be used within a DialogProvider');
  }
  return ctx;
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DialogState>(null);

  const showConfirm = useCallback((options: ConfirmOptions) => {
    setState({ kind: 'confirm', options });
  }, []);

  const showAccessDialog = useCallback((options: AccessIssueDialogOptions) => {
    setState({ kind: 'access', options });
  }, []);

  /** Dismiss only (X / backdrop / hardware back). Does not run confirm onCancel. */
  const dismissDialog = useCallback(() => {
    setState((current) => {
      if (current?.kind === 'access') {
        current.options.onClose?.();
      }
      return null;
    });
  }, []);

  /** Cancel/Discard button: run onCancel then clear. */
  const handleConfirmCancel = useCallback(() => {
    setState((current) => {
      if (current?.kind === 'confirm') {
        current.options.onCancel?.();
      }
      return null;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setState((current) => {
      if (current?.kind === 'confirm') {
        current.options.onConfirm();
      }
      return null;
    });
  }, []);

  const handleAccessPrimary = useCallback(() => {
    setState((current) => {
      if (current?.kind === 'access') {
        current.options.onPrimary?.();
      }
      return null;
    });
  }, []);

  const handleAccessSecondary = useCallback(() => {
    setState((current) => {
      if (current?.kind === 'access') {
        current.options.onSecondary?.();
      }
      return null;
    });
  }, []);

  const value = useMemo<DialogContextValue>(
    () => ({
      showConfirm,
      showAccessDialog,
      closeDialog: dismissDialog,
    }),
    [dismissDialog, showAccessDialog, showConfirm],
  );

  return (
    <DialogContext.Provider value={value}>
      {children}
      {state?.kind === 'confirm' ? (
        <ConfirmModal
          visible={true}
          onClose={dismissDialog}
          onCancel={handleConfirmCancel}
          onConfirm={handleConfirm}
          title={state.options.title}
          message={state.options.message}
          confirmLabel={state.options.confirmLabel}
          cancelLabel={state.options.cancelLabel}
          confirmVariant={state.options.confirmVariant}
        />
      ) : null}
      {state?.kind === 'access' ? (
        <AccessIssueDialog
          visible={true}
          onClose={dismissDialog}
          title={state.options.title}
          message={state.options.message}
          wide={state.options.wide}
          primaryLabel={state.options.primaryLabel}
          secondaryLabel={state.options.secondaryLabel}
          onPrimary={handleAccessPrimary}
          onSecondary={state.options.onSecondary ? handleAccessSecondary : undefined}
        />
      ) : null}
    </DialogContext.Provider>
  );
}
