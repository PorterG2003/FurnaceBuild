import { useEffect, useRef } from 'react';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { useDialog } from '@/components/ui/dialogs/DialogContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  parsePublicAccessState,
  resolvePublicAccessDialog,
  stripPublicAccessParams,
  type PublicAccessAction,
  type PublicAccessSurface,
} from '@/lib/publicAccessState';

async function runPublicAccessAction(
  action: PublicAccessAction | undefined,
  run: {
    signOut: () => Promise<void>;
    replace: (href: string | { pathname: string; params?: Record<string, string> }) => void;
  },
) {
  if (!action || action.kind === 'none') return;
  if (action.kind === 'navigate') {
    run.replace(action.href);
    return;
  }
  await run.signOut();
  run.replace(action.href);
}

function buildPathWithParams(pathname: string, params: Record<string, string>): string {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      searchParams.set(key, value);
    }
  });
  const query = searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function usePublicAccessDialog(
  surface: PublicAccessSurface,
  options?: { enabled?: boolean },
) {
  const params = useLocalSearchParams() as Record<string, string | string[] | undefined>;
  const pathname = usePathname();
  const router = useRouter();
  const { showAccessDialog } = useDialog();
  const { user, signOut } = useAuth();
  const shownKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (options?.enabled === false) {
      shownKeyRef.current = null;
      return;
    }

    const accessState = parsePublicAccessState(params);
    if (!accessState) {
      shownKeyRef.current = null;
      return;
    }

    const key = `${surface}:${JSON.stringify(accessState)}`;
    if (shownKeyRef.current === key) return;
    shownKeyRef.current = key;

    const cleanedParams = stripPublicAccessParams(params);
    router.replace(buildPathWithParams(pathname, cleanedParams) as any);

    const dialog = resolvePublicAccessDialog({
      state: accessState,
      surface,
      currentUserEmail: user?.email ?? null,
    });

    const runAction = (action?: PublicAccessAction) =>
      runPublicAccessAction(action, {
        signOut,
        replace: (href) => router.replace(href as any),
      });

    showAccessDialog({
      title: dialog.title,
      message: dialog.message,
      wide: dialog.wide,
      primaryLabel: dialog.primaryLabel,
      secondaryLabel: dialog.secondaryLabel,
      onPrimary: () => {
        void runAction(dialog.primaryAction);
      },
      onSecondary: dialog.secondaryAction
        ? () => {
            void runAction(dialog.secondaryAction);
          }
        : undefined,
      onClose: () => {
        void runAction(dialog.closeAction);
      },
    });
  }, [options?.enabled, params, pathname, router, showAccessDialog, signOut, surface, user?.email]);
}

