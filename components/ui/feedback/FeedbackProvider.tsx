import type { ReactNode } from 'react';
import { DialogProvider } from '@/components/ui/dialogs/DialogContext';
import { ToastProvider } from './Toast';

export function FeedbackProvider({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <DialogProvider>{children}</DialogProvider>
    </ToastProvider>
  );
}
