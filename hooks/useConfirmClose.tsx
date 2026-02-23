import { useCallback } from 'react';
import { useConfirm } from '@/components/ui/ConfirmContext';

/**
 * Returns a close handler that shows the global discard-confirm modal when there are
 * unsaved changes. Use for modals/forms: pass as onClose so Cancel, X, and backdrop
 * all guard against losing changes. Requires ConfirmProvider at app root.
 */
export function useConfirmClose(
  isDirty: boolean,
  onClose: () => void,
  options?: {
    title?: string;
    message?: string;
    discardLabel?: string;
    keepLabel?: string;
  }
): () => void {
  const { showConfirm } = useConfirm();
  const title = options?.title ?? 'Discard changes?';
  const message = options?.message ?? 'You have unsaved changes. Discard them?';
  const discardLabel = options?.discardLabel ?? 'Discard';
  const keepLabel = options?.keepLabel ?? 'Keep editing';

  return useCallback(() => {
    if (!isDirty) {
      onClose();
      return;
    }
    showConfirm({
      title,
      message,
      cancelLabel: keepLabel,
      confirmLabel: discardLabel,
      confirmVariant: 'destructive',
      onConfirm: onClose,
    });
  }, [isDirty, onClose, showConfirm, title, message, discardLabel, keepLabel]);
}
