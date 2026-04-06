"use client";

import { useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const router = useRouter();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");

    if (!isSupabaseConfigured || !supabase) {
      setMessage("Supabase not configured");
      return;
    }

    if (!password.trim()) {
      setMessage("Enter a new password");
      return;
    }

    if (password.length < 6) {
      setMessage("Password must be at least 6 characters");
      return;
    }

    if (password !== confirmPassword) {
      setMessage("Passwords do not match");
      return;
    }

    const { error } = await supabase.auth.updateUser({
      password,
    });

    if (error) {
      setMessage(error.message);
    } else {
      setMessage("Password updated successfully! Redirecting...");

      setTimeout(() => {
        router.push("/login"); // 🔥 better than "/"
      }, 1500);
    }
  };

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

        {message && (
          <p className="text-sm text-center text-red-600">{message}</p>
        )}
      </form>
    </div>
  );
}
