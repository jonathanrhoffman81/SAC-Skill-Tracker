'use client';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export interface AuthenticatedSessionIdentity {
  authUserId: string;
  email: string | null;
  displayName: string | null;
}

/**
 * Marker subclass we throw when the session is gone. Callers don't need to
 * handle it specially — a redirect has already been queued by the helper that
 * threw it. The throw just halts the current async chain so no further work
 * runs against a dead session.
 */
export class SessionExpiredError extends Error {
  constructor() {
    super('Session expired');
    this.name = 'SessionExpiredError';
  }
}

const SESSION_EXPIRED_PATH = '/login?reason=session_expired';

/**
 * Navigate to login with a session-expired marker, unless we're already on the
 * login page (avoid redirect loops). Silent no-op on the server or on a login
 * page. Can be called from any client-side context.
 *
 * Unlike logoutAndRedirect (used by the Logout button), this path does NOT
 * await Supabase's signOut call — it clears local state synchronously and
 * navigates immediately. For an expired session the server-side token is
 * already dead, so waiting on a network roundtrip just gives the stale
 * dashboard ~300ms to flash. We still fire signOut in the background as
 * belt-and-suspenders for other tabs and in-memory state.
 */
export function redirectToLoginExpired(): void {
  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/login')) return;

  try {
    localStorage.removeItem('user');
    sessionStorage.clear();
  } catch {
    // Storage access can throw in edge cases (private browsing, etc.) — still navigate.
  }

  // Fire-and-forget so other tabs eventually get the SIGNED_OUT event.
  void signOutCurrentUser().catch(() => {});

  window.location.replace(SESSION_EXPIRED_PATH);
}

/**
 * Fast synchronous localStorage check for a Supabase auth token.
 * Bypasses supabase.auth.getSession() which, when the in-memory session is
 * expired, can hang on a background refresh attempt for several seconds
 * before returning null. If localStorage has no sb-*-auth-token key at all,
 * we know the session is gone and can redirect immediately.
 *
 * Exported so the idle-session poller in AuthListener can share the logic.
 */
export function hasLocalSupabaseAuthToken(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && /^sb-.*-auth-token$/.test(key)) {
        return true;
      }
    }
  } catch {
    // localStorage access can throw in some private-browsing modes — treat as no token.
  }
  return false;
}

async function getRequiredSession() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    );
  }

  // Short-circuit: no persisted token → don't even ask supabase-js, which would
  // otherwise spend seconds attempting an impossible refresh.
  if (!hasLocalSupabaseAuthToken()) {
    redirectToLoginExpired();
    throw new SessionExpiredError();
  }

  const { data, error } = await supabase.auth.getSession();
  const session = data?.session;

  if (error || !session?.access_token || !session.user) {
    redirectToLoginExpired();
    throw new SessionExpiredError();
  }

  // Defensive client-side expiry check. Supabase's auto-refresh *should*
  // catch this but can race with long-idle tabs or failed refresh chains.
  // expires_at is a unix-seconds timestamp; treat <10s as already dead.
  if (session.expires_at && session.expires_at * 1000 < Date.now() + 10_000) {
    redirectToLoginExpired();
    throw new SessionExpiredError();
  }

  return session;
}

export async function getAuthenticatedAccessToken(): Promise<string> {
  const session = await getRequiredSession();
  return session.access_token;
}

export async function getAuthenticatedSessionIdentity(): Promise<AuthenticatedSessionIdentity> {
  const session = await getRequiredSession();
  const fullName =
    session.user.user_metadata?.full_name ||
    [session.user.user_metadata?.first_name, session.user.user_metadata?.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();

  return {
    authUserId: session.user.id,
    email: session.user.email ?? null,
    displayName: fullName || session.user.email || null,
  };
}

export async function createAuthenticatedHeaders(
  extraHeaders?: HeadersInit
): Promise<Headers> {
  const accessToken = await getAuthenticatedAccessToken();
  const headers = new Headers(extraHeaders);
  headers.set('Authorization', `Bearer ${accessToken}`);
  return headers;
}

/** How long we'll wait for an authenticated fetch to respond before assuming
 *  the session is gone and bouncing to login. Prevents a stalled server-side
 *  auth check from leaving the user staring at a loading state. */
const AUTH_FETCH_TIMEOUT_MS = 8_000;

/**
 * Wrapper around `fetch` for authenticated `/api/*` calls.
 * - Attaches the current access token automatically (no need to call
 *   createAuthenticatedHeaders separately).
 * - If the server responds 401 (token revoked / server-rejected), bounces
 *   the user to /login?reason=session_expired and throws SessionExpiredError.
 * - If the fetch takes longer than AUTH_FETCH_TIMEOUT_MS we abort it — a
 *   stalled server-side auth validation shouldn't keep the UI hanging.
 *
 * Call sites can treat the returned Response as normal; by the time they see
 * a resolved Response, auth was OK.
 */
export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const headers = await createAuthenticatedHeaders(init?.headers);

  // Honour any caller-supplied signal by chaining it with our timeout signal.
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), AUTH_FETCH_TIMEOUT_MS);
  const signal = init?.signal
    ? composeAbortSignals(init.signal, timeoutController.signal)
    : timeoutController.signal;

  let response: Response;
  try {
    response = await fetch(input, { ...init, headers, signal });
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 401) {
    redirectToLoginExpired();
    throw new SessionExpiredError();
  }

  return response;
}

function composeAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  // Prefer AbortSignal.any where available (recent Safari/Chrome/Node).
  const anyFactory = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFactory === 'function') return anyFactory([a, b]);

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (a.aborted || b.aborted) abort();
  a.addEventListener('abort', abort, { once: true });
  b.addEventListener('abort', abort, { once: true });
  return controller.signal;
}

export async function signOutCurrentUser(): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    return;
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    throw new Error(`Failed to sign out: ${error.message}`);
  }
}

export async function logoutAndRedirect(redirectPath = '/login'): Promise<void> {
  try {
    await signOutCurrentUser();
  } catch {
    // We still clear local client state and force navigation even if Supabase sign-out fails.
  } finally {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('user');
      sessionStorage.clear();
      window.location.assign(redirectPath);
    }
  }
}
