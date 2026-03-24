"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { normalizeEmail } from "@/lib/authRoles";

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const prefilledEmail = normalizeEmail(String(searchParams.get("email") || ""));
  const effectiveEmail = email || prefilledEmail;

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const normalizedEmail = normalizeEmail(effectiveEmail);

      if (!normalizedEmail) {
        throw new Error("Please enter your email");
      }

      if (password.length < 6) {
        throw new Error("Password must be at least 6 characters");
      }

      if (password !== confirmPassword) {
        throw new Error("Passwords do not match");
      }

      if (!isSupabaseConfigured || !supabase) {
        throw new Error(
          "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your frontend .env.local file.",
        );
      }

      const checkEmailResponse = await fetch(
        `/api/auth/check-email?email=${encodeURIComponent(normalizedEmail)}`,
      );

      if (!checkEmailResponse.ok) {
        const checkEmailError = await checkEmailResponse
          .json()
          .catch(() => ({ error: "Failed to verify email." }));
        throw new Error(checkEmailError.error || "Failed to verify email.");
      }

      const checkEmailPayload = await checkEmailResponse.json();

      if (!checkEmailPayload.existsInRoster) {
        throw new Error(
          "This email is not in the SAC roster. Use the same email as TeamEngine or contact an admin.",
        );
      }

      if (!checkEmailPayload.hasActiveOrganization) {
        throw new Error(
          "This email is on file but is not active in an organization. Please contact an admin.",
        );
      }

      const firstName = String(checkEmailPayload.firstName || "").trim();
      const lastName = String(checkEmailPayload.lastName || "").trim();
      const role = String(checkEmailPayload.role || "account").trim();
      const dbRole = String(checkEmailPayload.dbRole || role || "account").trim();
      const personId = String(checkEmailPayload.personId || "").trim();
      const fullName = `${firstName || "Member"} ${lastName || ""}`.trim();

      // Create auth user only. Person linkage is handled by DB trigger using person_id/email metadata.
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            person_id: personId || null,
            full_name: fullName,
            first_name: firstName || "Member",
            last_name: lastName || "",
            email: normalizedEmail,
            role,
            user_role: role,
            db_role: dbRole,
          },
        },
      });

      if (error) {
        const message = String(error.message || "");
        const normalizedMessage = message.toLowerCase();

        if (
          normalizedMessage.includes("email address") &&
          normalizedMessage.includes("invalid")
        ) {
          throw new Error(
            "Email format was rejected by Auth. Re-type email manually (no quotes/spaces) and try again.",
          );
        }

        if (
          normalizedMessage.includes("rate limit") ||
          normalizedMessage.includes("over_email_send_rate_limit")
        ) {
          throw new Error(
            "Too many signup attempts in a short time. Please wait a minute and try again.",
          );
        }

        if (
          normalizedMessage.includes("database error saving new user")
        ) {
          throw new Error(
            "Could not create auth account due to a database trigger/config issue. Ask admin to check Supabase Auth triggers for required metadata.",
          );
        }
        throw error;
      }

      if (data.user && data.user.identities?.length === 0) {
        setError(
          "An account with this email already exists. Please login or use Forgot Password.",
        );
        return;
      }

      setSuccess(
        `Welcome to SAC Skill Tracker! We sent a confirmation link to ${normalizedEmail}. After confirming, come back and sign in.`,
      );
      setPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      console.error("Signup Error:", err);
      setError(err.message);
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
          Create Account
        </h1>
        <p className="text-center text-sm text-gray-600 mb-6">
          Join SAC Skill Tracker
        </p>

        <form onSubmit={handleSignup} className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={effectiveEmail}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-md"
          />

          {prefilledEmail && (
            <p className="text-xs text-gray-600">
              We prefilled your email from login. Set your password here if this
              is your first time signing in.
            </p>
          )}

          <p className="text-xs text-gray-600">
            Use the same email as your TeamEngine account.
          </p>

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-md"
          />

          <input
            type="password"
            placeholder="Confirm Password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-md"
          />

          {error && (
            <div className="text-red-600 text-sm text-center">{error}</div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-md px-4 py-3">
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 rounded-md"
          >
            {loading ? "Creating Account..." : "Sign Up"}
          </button>

          {success && (
            <button
              type="button"
              onClick={() => router.push("/login")}
              className="w-full border border-blue-600 text-blue-600 py-3 rounded-md"
            >
              Go to Login
            </button>
          )}
        </form>

        <p className="text-center text-sm text-gray-600 mt-6">
          Already have an account?{" "}
          <button
            onClick={() => router.push("/login")}
            className="text-blue-600 hover:underline"
          >
            Login
          </button>
        </p>
      </div>
    </div>
  );
}

export default function Signup() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center text-gray-600">
            Loading signup...
          </div>
        </div>
      }
    >
      <SignupForm />
    </Suspense>
  );
}
