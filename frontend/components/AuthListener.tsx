'use client';

/**
 * Global auth-state listener.
 *
 * Catches every realistic way a session can change underneath a mounted
 * page:
 *   1. SIGNED_OUT event — explicit sign-out, cross-tab sign-out, or a
 *      failed auto-refresh that supabase-js clears internally.
 *   2. SIGNED_IN with a different user — another tab on the same browser
 *      logged in as a *different human*, overwriting the shared
 *      localStorage session. Without this guard, the current tab keeps
 *      rendering its old user's UI but every subsequent API call goes
 *      out under the new user's token. We bounce to /login with a
 *      switched_account reason so they can sign back in for this tab.
 *      (A SAME human switching active role does NOT fire SIGNED_IN —
 *      role switching only updates the activeRole localStorage key —
 *      so this works correctly for users who hold multiple roles.)
 *   3. Periodic poll (every 30s) — same-tab localStorage deletion (e.g.
 *      a dev nuking the token in DevTools, or the user using a browser
 *      extension) is NOT surfaced by any Supabase event because the
 *      in-memory session still looks valid. A cheap interval check on
 *      the sb-*-auth-token key closes that gap.
 *   4. visibilitychange — when a backgrounded tab becomes visible again,
 *      re-check immediately so the user doesn't have to wait for the
 *      next poll tick after re-focusing (browsers throttle hidden-tab
 *      intervals heavily).
 *   5. storage event — other-tab token swaps. onAuthStateChange already
 *      fires for these in most cases but storage is a cheap safety net.
 *
 * Mounted once at the root layout so it runs on every page, including
 * ones that never call the API.
 */

import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { hasLocalSupabaseAuthToken } from '@/lib/clientAuth';

const EXPIRED_PATH = '/login?reason=session_expired';
const SWITCHED_PATH = '/login?reason=switched_account';
const POLL_INTERVAL_MS = 30_000;

/** Flag set in sessionStorage by the login page right before
 *  signInWithPassword so AuthListener can tell "the tab I'm running in
 *  *just* signed in" apart from "another tab signed in as a different
 *  user, overwriting our shared localStorage session". Without this,
 *  we'd incorrectly redirect the just-signed-in tab — supabase-js
 *  fires SIGNED_IN as a microtask, which can land *after* the login
 *  page has already called router.push, by which point
 *  window.location.pathname is no longer "/login" and the
 *  isOnPublicPath safety net no longer suppresses the redirect.
 *  Exported as a constant so the login page can reuse it. */
export const SELF_SIGNIN_FLAG = 'auth-self-signin-pending';

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

function redirectTo(target: string) {
  if (typeof window === 'undefined') return;
  if (isOnPublicPath()) return;
  try {
    localStorage.removeItem('user');
    sessionStorage.clear();
  } catch {
    // storage may throw in private browsing — continue to the redirect anyway.
  }
  // replace (not assign) so the dead page doesn't sit in history.
  window.location.replace(target);
}

function checkSessionFreshness() {
  if (isOnPublicPath()) return;
  if (!hasLocalSupabaseAuthToken()) {
    redirectTo(EXPIRED_PATH);
  }
}

export default function AuthListener() {
  // The auth.users.id this tab booted as. We compare against this on every
  // SIGNED_IN to detect "another human signed in on a different tab and
  // overwrote our shared localStorage session".
  const sessionUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    if (typeof window === 'undefined') return;

    // Capture the initial user_id so we have a baseline to compare against.
    void supabase.auth.getSession().then(({ data }) => {
      sessionUserIdRef.current = data.session?.user?.id ?? null;
    });

    // 1 + 2: Supabase's own events.
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_OUT') {
          const wasSignedIn = Boolean(sessionUserIdRef.current);
          sessionUserIdRef.current = null;
          // Only redirect if we actually had a session — avoids bouncing
          // visitors who navigate directly to /login with no prior session.
          if (wasSignedIn) redirectTo(EXPIRED_PATH);
          return;
        }

        if (event === 'SIGNED_IN') {
          const incomingUserId = session?.user?.id ?? null;
          const knownUserId = sessionUserIdRef.current;

          // Did the login page in *this tab* just initiate this signin?
          // If so, never redirect — even if it overwrote a different
          // user's session in shared localStorage, this is intentional.
          // Other tabs receiving the cross-tab SIGNED_IN won't have the
          // flag set and will fall through to the mismatch check.
          let selfInitiated = false;
          try {
            selfInitiated =
              sessionStorage.getItem(SELF_SIGNIN_FLAG) === '1';
            if (selfInitiated) sessionStorage.removeItem(SELF_SIGNIN_FLAG);
          } catch {
            /* private-browsing storage error */
          }

          if (
            !selfInitiated &&
            knownUserId &&
            incomingUserId &&
            knownUserId !== incomingUserId
          ) {
            // A different human took over the shared session from another
            // tab. Bail this tab out.
            sessionUserIdRef.current = incomingUserId;
            redirectTo(SWITCHED_PATH);
            return;
          }

          // Always sync ref to the new user — including when the redirect
          // was suppressed because we're on a public path or the signin
          // was self-initiated. Otherwise the ref goes stale and
          // subsequent legitimate switches won't trigger.
          sessionUserIdRef.current = incomingUserId ?? knownUserId;
        }
      },
    );

    // 3. Periodic idle-session poll — catches same-tab localStorage
    //    deletion that no Supabase event fires for.
    const intervalId = window.setInterval(checkSessionFreshness, POLL_INTERVAL_MS);

    // 4. Re-check on visibility change.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkSessionFreshness();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // 5. Cross-tab storage events on the auth-token key.
    const onStorage = (event: StorageEvent) => {
      if (!event.key) return;
      if (!/^sb-.*-auth-token$/.test(event.key)) return;
      if (event.newValue === null) {
        // Removed → sign-out elsewhere.
        sessionUserIdRef.current = null;
        redirectTo(EXPIRED_PATH);
      }
      // Value-changed (different user logging in) is handled by the
      // SIGNED_IN branch above — supabase-js fires SIGNED_IN when its
      // storage adapter sees the value swap.
    };
    window.addEventListener('storage', onStorage);

    // Initial check on mount.
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
