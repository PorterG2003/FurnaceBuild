import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { supabase, wasRecoveryUrl } from '@/lib/supabase/client';
import type { Session, User as AuthUser } from '@supabase/supabase-js';

interface AuthContextValue {
  user: AuthUser | null;
  session: Session | null;
  loading: boolean;
  isRecoverySession: boolean;
  clearRecoverySession: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRecoverySession, setIsRecoverySession] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);

      switch (event) {
        case 'INITIAL_SESSION':
          if (wasRecoveryUrl && sess?.user) {
            setIsRecoverySession(true);
          }
          setLoading(false);
          break;

        case 'PASSWORD_RECOVERY':
          setIsRecoverySession(true);
          setLoading(false);
          break;

        case 'SIGNED_OUT':
          setIsRecoverySession(false);
          setLoading(false);
          break;

        default:
          setLoading(false);
          break;
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const clearRecoverySession = useCallback(() => {
    setIsRecoverySession(false);
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, session, loading, isRecoverySession, clearRecoverySession, signOut }),
    [user, session, loading, isRecoverySession, clearRecoverySession, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
