'use client';

/**
 * Global auth-state listener.
 *
 * Subscribes to Supabase's `onAuthStateChange` so that whenever the session
 * becomes invalid — refresh-token failure, sign-out from another tab,
 * server-side revocation — the user is pushed to /login automatically rather
 * than left on a stale page that will error on its next request.
 *
 * Mounted once at the root layout so it runs on every page.
 */

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';

const EXPIRED_PATH = '/login?reason=session_expired';

function redirectIfNotOnLogin(path: string) {
  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/login')) return;
  // replace (not assign) so the dead page doesn't sit in history.
  window.location.replace(path);
}

export default function AuthListener() {
  useEffect(() => {
    if (!supabase) return;

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === 'SIGNED_OUT') {
          // Session is gone — either they logged out, got logged out, or
          // the refresh chain broke. Either way, bounce to login.
          if (typeof window !== 'undefined') {
            localStorage.removeItem('user');
            sessionStorage.clear();
          }
          redirectIfNotOnLogin(EXPIRED_PATH);
        }
      }
    );

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, []);

  return null;
}
