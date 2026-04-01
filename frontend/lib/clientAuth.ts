'use client';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export interface AuthenticatedSessionIdentity {
  authUserId: string;
  email: string | null;
  displayName: string | null;
}

async function getRequiredSession() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    );
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new Error(`Failed to load auth session: ${error.message}`);
  }

  const session = data.session;
  if (!session?.access_token || !session.user) {
    throw new Error('Missing authenticated session. Please log in again.');
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
    localStorage.removeItem('user');
    sessionStorage.clear();
    window.location.assign(redirectPath);
  }
}
