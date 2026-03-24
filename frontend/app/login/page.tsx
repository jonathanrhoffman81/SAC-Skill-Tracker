/**
 * Primary login page.
 * Uses auth metadata first, then DB role resolution fallback.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import {
  getDashboardPathForRole,
  normalizeEmail,
  normalizeRole,
} from "@/lib/authRoles";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      const normalizedEmail = normalizeEmail(email);

      if (!normalizedEmail) throw new Error("Enter email");
      if (!password.trim()) throw new Error("Enter password");
      if (!isSupabaseConfigured || !supabase) {
        throw new Error(
          "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your frontend .env.local file.",
        );
      }

      setLoading(true);

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (signInError) throw signInError;
      if (!data.user) throw new Error("Login failed. Please try again.");

      const authenticatedEmail = normalizeEmail(data.user.email || normalizedEmail);
      const metadataCandidates = [
        data.user.user_metadata?.role,
        data.user.user_metadata?.user_role,
        data.user.app_metadata?.role,
        data.user.app_metadata?.user_role,
      ];

      const rawRole = metadataCandidates.find(
        (value) => typeof value === "string" && value.trim().length > 0,
      );

      const effectiveRole = normalizeRole(String(rawRole || ""));

      let resolvedRole = effectiveRole;

      // Fallback: if metadata role is missing, resolve from person/org role tables.
      if (!resolvedRole) {
        const roleResponse = await fetch(
          `/api/auth/resolve-role?email=${encodeURIComponent(authenticatedEmail)}`,
        );

        if (roleResponse.ok) {
          const rolePayload = await roleResponse.json();
          resolvedRole = normalizeRole(String(rolePayload?.role || ""));
        }
      }

      localStorage.setItem("user", JSON.stringify({ email: authenticatedEmail }));

      if (!resolvedRole) {
        throw new Error(
          "No role found on your auth profile or role tables. Please contact an admin.",
        );
      }

      const dashboardPath = getDashboardPathForRole(resolvedRole);
      if (!dashboardPath) {
        throw new Error(`Unsupported role: ${resolvedRole}`);
      }

      router.push(dashboardPath);
    } catch (err: any) {
      console.error("Login Error:", err);
      const message = String(err?.message || "Login failed.");
      const normalizedMessage = message.toLowerCase();

      if (normalizedMessage.includes("invalid login credentials")) {
        const normalizedEmail = normalizeEmail(email);
        const checkEmailResponse = await fetch(
          `/api/auth/check-email?email=${encodeURIComponent(normalizedEmail)}`,
        );

        if (checkEmailResponse.ok) {
          const payload = await checkEmailResponse.json();
          const existsInRoster = Boolean(payload?.existsInRoster);
          const hasAuthUser = Boolean(payload?.hasAuthUser);

          if (existsInRoster && !hasAuthUser) {
            setError(
              "No password is set for this email yet. Click Sign Up below to create your password.",
            );
            return;
          }

          if (hasAuthUser) {
            setError("Invalid email or password.");
            return;
          }

          setError(
            "Email not found in roster. Use your TeamEngine email or contact an admin.",
          );
          return;
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
        {/* Logo */}
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

        {/* Title and Subtitle */}
        <h1 className="text-2xl font-bold text-center text-gray-900 mb-1">
          SAC Skill Tracker
        </h1>
        <p className="text-center text-sm text-gray-600 mb-6">
          Swimming Progress Dashboard
        </p>

        {/* Login Form */}
        <form onSubmit={handleLogin} className="space-y-4">
          {/* Email Input */}
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

          {/* Error Message */}
          {error && (
            <div className="text-red-600 text-sm text-center">{error}</div>
          )}

          {/* Submit Button */}
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
