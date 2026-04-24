/**
 * Primary login page.
 * Uses auth metadata first, then DB role resolution fallback.
 * Supports multi-role users — redirects to /role-select when multiple roles exist.
 */

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createAuthenticatedHeaders } from "@/lib/clientAuth";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import {
  getDashboardPathsForRoles,
  getAllAppRoles,
  normalizeEmail,
  normalizeRole,
  saveAvailableRoles,
  saveActiveRole,
} from "@/lib/authRoles";

const LEGACY_LOCALSTORAGE_ROLE_SET = new Set(["admin", "super-admin"]);

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [expiredNotice, setExpiredNotice] = useState(false);

  // Read ?reason=session_expired directly from window.location. Avoids
  // useSearchParams(), which requires the page to be wrapped in <Suspense>
  // during static pre-rendering and was failing the Vercel build.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("reason") === "session_expired") {
      setExpiredNotice(true);
    }
  }, []);

  const handleForgotPassword = async () => {
    setError("");

    try {
      const normalizedEmail = normalizeEmail(email);

      if (!normalizedEmail) {
        throw new Error("Enter your email first");
      }

      if (!supabase) {
        throw new Error("Supabase not configured");
      }

      const { error } = await supabase.auth.resetPasswordForEmail(
        normalizedEmail,
        {
          redirectTo: `${window.location.origin}/account/reset-password`,
        },
      );

      if (error) throw error;

      setError("Password reset email sent. Check your inbox.");
    } catch (err: any) {
      setError(err.message || "Failed to send reset email.");
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!normalizeEmail(email)) {
      setError("Enter email");
      return;
    }
    if (!password.trim()) {
      setError("Enter password");
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setError(
        "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your frontend .env.local file.",
      );
      return;
    }

    setLoading(true);

    try {
      const normalizedEmail = normalizeEmail(email);

      const { data, error: signInError } =
        await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

      if (signInError) throw signInError;
      if (!data.user) throw new Error("Login failed. Please try again.");

      const authenticatedEmail = normalizeEmail(
        data.user.email || normalizedEmail,
      );

      // ── Step 1: collect all raw roles from metadata ───────────────────────
      const metadataRawRoles = [
        data.user.user_metadata?.role,
        data.user.user_metadata?.user_role,
        data.user.app_metadata?.role,
        data.user.app_metadata?.user_role,
      ].filter(
        (v): v is string => typeof v === "string" && v.trim().length > 0,
      );

      let allRawRoles: string[] = metadataRawRoles.map((r) => normalizeRole(r));

      // ── Step 2: if metadata has no roles, fall back to DB resolve ──────────
      if (allRawRoles.length === 0) {
        const authHeaders = await createAuthenticatedHeaders();
        const roleResponse = await fetch("/api/auth/resolve-role", {
          headers: authHeaders,
        });

        if (!roleResponse.ok) {
          throw new Error("Could not resolve your role. Please try again.");
        }

        const rolePayload = await roleResponse.json();

        // resolve-role may return a single `role` or an array `roles`
        const payloadRoles: string[] = Array.isArray(rolePayload?.roles)
          ? rolePayload.roles
          : rolePayload?.role
            ? [String(rolePayload.role)]
            : [];

        allRawRoles = payloadRoles.map((r) => normalizeRole(r)).filter(Boolean);
      }

      if (allRawRoles.length === 0) {
        throw new Error(
          "No role found on your auth profile or role tables. Please contact an admin.",
        );
      }

      // ── Step 3: convert raw roles → unique app-level roles ─────────────────
      const appRoles = getAllAppRoles(allRawRoles);
      const availableDashboards = getDashboardPathsForRoles(appRoles);

      if (availableDashboards.length === 0) {
        throw new Error(
          `Unsupported role(s): ${appRoles.join(", ")}. Please contact an admin.`,
        );
      }

      // ── Step 4: persist roles for use by the role switcher widget ──────────
      saveAvailableRoles(appRoles);

      // ── Step 5: legacy localStorage cleanup ───────────────────────────────
      const highestRole = appRoles[0];
      if (LEGACY_LOCALSTORAGE_ROLE_SET.has(highestRole)) {
        localStorage.setItem(
          "user",
          JSON.stringify({ email: authenticatedEmail }),
        );
      } else {
        localStorage.removeItem("user");
      }

      // ── Step 6: route — multi-role → picker, single role → dashboard ───────
      if (availableDashboards.length > 1) {
        router.push("/role-select");
      } else {
        const { role, path } = availableDashboards[0];
        saveActiveRole(role);
        router.push(path);
      }
    } catch (err: any) {
      console.error("Login Error:", err);
      const message = String(err?.message || "Login failed.");
      const normalizedMessage = message.toLowerCase();

      if (normalizedMessage.includes("invalid login credentials")) {
        try {
          const normalizedEmail = normalizeEmail(email);
          const checkEmailResponse = await fetch(
            `/api/auth/check-email?email=${encodeURIComponent(normalizedEmail)}`,
          );

          if (checkEmailResponse.ok) {
            const payload = await checkEmailResponse.json();
            const existsInRoster = Boolean(payload?.existsInRoster);
            const hasAuthUser = Boolean(payload?.hasAuthUser);

            // hasAuthUser must be checked first — takes priority over existsInRoster
            if (hasAuthUser) {
              setError("Invalid email or password.");
              return;
            }

            if (existsInRoster) {
              setError(
                "No password is set for this email yet. Click Sign Up below to create your password.",
              );
              return;
            }

            setError(
              "Email not found in roster. Use your TeamEngine email or contact an admin.",
            );
            return;
          }
        } catch {
          // fall through to generic message
        }

        setError("Invalid email or password.");
        return;
      }

      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </div>
        </div>

        <h1 className="text-2xl font-bold text-center text-gray-900 mb-1">
          SAC Skill Tracker
        </h1>
        <p className="text-center text-sm text-gray-600 mb-6">
          Swimming Progress Dashboard
        </p>

        {expiredNotice && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-medium text-amber-800">
              Your session expired
            </p>
            <p className="mt-1 text-xs text-amber-700">
              Please sign in again to continue.
            </p>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="w-full px-4 py-2 border border-gray-300 rounded-md"
            />
          </div>

          {error && (
            <div className="text-red-600 text-sm text-center">{error}</div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleForgotPassword}
              className="text-sm text-blue-600 hover:underline"
            >
              Forgot Password?
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-md transition duration-200"
          >
            {loading ? "Signing in..." : "Continue"}
          </button>
        </form>

        <p className="text-center text-sm text-gray-600 mt-6">
          First time here?{" "}
          <button
            onClick={() => {
              const normalizedEmail = normalizeEmail(email);
              router.push(
                normalizedEmail
                  ? `/signup?email=${encodeURIComponent(normalizedEmail)}`
                  : "/signup",
              );
            }}
            className="text-blue-600 hover:underline"
          >
            Sign Up
          </button>
        </p>
      </div>
    </div>
  );
}
