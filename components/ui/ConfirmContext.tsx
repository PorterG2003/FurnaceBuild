import React from 'react';
import {
  DialogProvider,
  useDialog,
  type ConfirmOptions,
} from '@/components/ui/dialogs/DialogContext';

interface ConfirmContextValue {
  showConfirm: (options: ConfirmOptions) => void;
}

export function useConfirm(): ConfirmContextValue {
  const { showConfirm } = useDialog();
  return { showConfirm };
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  return <DialogProvider>{children}</DialogProvider>;
}
