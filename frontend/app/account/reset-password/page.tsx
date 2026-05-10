"use client";

import { useState, useEffect } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<{
    text: string;
    type: "error" | "success";
  }>({
    text: "",
    type: "error",
  });
  // FIX: track whether a valid reset session is present
  //const [sessionReady, setSessionReady] = useState(false);
  //const [checkingSession, setCheckingSession] = useState(true);
  const router = useRouter();

  // FIX: guard the page — redirect to /login if there's no active session.
  // Without this, anyone navigating directly to /account/reset-password would
  // either get a confusing error or accidentally update their current password.
  //useEffect(() => {
  //  if (!isSupabaseConfigured || !supabase) {
  //    setCheckingSession(false);
  //    return;
  //  }

  //  supabase.auth.getSession().then(({ data }) => {
  //    if (!data.session) {
  //      router.push("/login");
  //    } else {
  //      setSessionReady(true);
  //    }
  //    setCheckingSession(false);
  //  });
  //}, [router]);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage({ text: "", type: "error" });

    if (!isSupabaseConfigured || !supabase) {
      setMessage({ text: "Supabase not configured", type: "error" });
      return;
    }

    if (!password.trim()) {
      setMessage({ text: "Enter a new password", type: "error" });
      return;
    }

    if (password.length < 6) {
      setMessage({
        text: "Password must be at least 6 characters",
        type: "error",
      });
      return;
    }

    if (password !== confirmPassword) {
      setMessage({ text: "Passwords do not match", type: "error" });
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setMessage({ text: error.message, type: "error" });
    } else {
      // FIX: success message now uses type "success" so it renders green, not red
      setMessage({
        text: "Password updated successfully! Redirecting...",
        type: "success",
      });
      setTimeout(() => {
        router.push("/login");
      }, 1500);
    }
  };

  //if (checkingSession) {
  //  return (
  //    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
  //      <p className="text-gray-500 text-sm">Verifying session...</p>
  //    </div>
  //  );
  //}

  //if (!sessionReady) {
  //  return null; // redirect in progress
  //}

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <form
        onSubmit={handleReset}
        className="bg-white p-6 rounded shadow-md space-y-4 w-full max-w-sm"
      >
        <h2 className="text-xl font-semibold text-center">Reset Password</h2>

        {/* New Password */}
        <input
          type="password"
          placeholder="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border p-2 rounded"
        />

        {/* Confirm Password */}
        <input
          type="password"
          placeholder="Confirm password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full border p-2 rounded"
        />

        <button className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition">
          Update Password
        </button>

        {/* FIX: message color is now green for success, red for errors */}
        {message.text && (
          <p
            className={`text-sm text-center ${
              message.type === "success" ? "text-green-600" : "text-red-600"
            }`}
          >
            {message.text}
          </p>
        )}
      </form>
    </div>
  );
}
