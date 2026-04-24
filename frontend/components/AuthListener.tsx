'use client';

/**
 * Global auth-state listener.
 *
 * Catches every realistic way a session can die while a page is mounted:
 *   1. SIGNED_OUT event — explicit sign-out, cross-tab sign-out, or a
 *      failed auto-refresh that supabase-js clears internally.
 *   2. Periodic poll (every 30s) — same-tab localStorage deletion (e.g.
 *      a dev nuking the token in DevTools, or the user using a browser
 *      extension) is NOT surfaced by any Supabase event because the
 *      in-memory session still looks valid. A cheap interval check on
 *      the sb-*-auth-token key closes that gap.
 *   3. visibilitychange — when a backgrounded tab becomes visible again,
 *      re-check immediately so the user doesn't have to wait for the
 *      next poll tick after re-focusing (browsers throttle hidden-tab
 *      intervals heavily).
 *   4. storage event — other-tab sign-outs (user clicks Logout in tab A,
 *      tab B should redirect too). onAuthStateChange already fires for
 *      this in most cases but storage is a cheap safety net.
 *
 * Mounted once at the root layout so it runs on every page, including
 * ones that never call the API.
 */

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { hasLocalSupabaseAuthToken } from '@/lib/clientAuth';

const EXPIRED_PATH = '/login?reason=session_expired';
const POLL_INTERVAL_MS = 30_000;

/** Routes that don't require a session. Skipping the session-gone check on
 *  these prevents a user who legitimately isn't logged in (e.g. signing up,
 *  resetting password) from being bounced to login. */
const PUBLIC_PATH_PREFIXES = ['/login', '/signup', '/account/reset-password'];

function isOnPublicPath(): boolean {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname;
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

function redirectIfNotOnPublicPath() {
  if (typeof window === 'undefined') return;
  if (isOnPublicPath()) return;
  try {
    localStorage.removeItem('user');
    sessionStorage.clear();
  } catch {
    // storage may throw in private browsing — continue to the redirect anyway.
  }
  // replace (not assign) so the dead page doesn't sit in history.
  window.location.replace(EXPIRED_PATH);
}

function checkSessionFreshness() {
  if (isOnPublicPath()) return;
  if (!hasLocalSupabaseAuthToken()) {
    redirectIfNotOnPublicPath();
  }
}

export default function AuthListener() {
  useEffect(() => {
    if (!supabase) return;
    if (typeof window === 'undefined') return;

    // 1. Supabase's own events (SIGNED_OUT, failed refresh, etc.)
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        redirectIfNotOnPublicPath();
      }
    });

    // 2. Periodic idle-session poll — catches same-tab localStorage
    //    deletion that no Supabase event fires for.
    const intervalId = window.setInterval(checkSessionFreshness, POLL_INTERVAL_MS);

    // 3. Re-check on visibility change — hidden-tab intervals are throttled,
    //    so the first check after re-focus should be eager, not lazy.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkSessionFreshness();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // 4. Other-tab localStorage changes (sign-out in tab A → tab B redirects).
    const onStorage = (event: StorageEvent) => {
      if (!event.key) return;
      if (!/^sb-.*-auth-token$/.test(event.key)) return;
      // New value null means the key was removed.
      if (event.newValue === null) {
        redirectIfNotOnPublicPath();
      }
    };
    window.addEventListener('storage', onStorage);

    // Initial check on mount — handles the case where the tab was loaded
    // after the session had already been nuked (e.g. user opens a
    // bookmark in a new window after clearing site data).
    checkSessionFreshness();

    return () => {
      subscription.subscription.unsubscribe();
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return null;
}
