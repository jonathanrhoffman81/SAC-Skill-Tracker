/**
 * Login page
 * Purpose: Simple login with name and role selection
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function Login() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [password, setPassword] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      if (!email.trim()) throw new Error("Enter email");
      if (!password.trim()) throw new Error("Enter password");

      setLoading(true);

      // Authenticate user
      // const { data, error } = await supabase.auth.signInWithPassword({
      //   email,
      //   password,
      // });

      localStorage.setItem("user", JSON.stringify({ email })); // Store email for dashboard data fetching
      // console.log("Login Response:", { data, error });
      if (error) throw error;

      // await supabase.auth.refreshSession();

      // const { data: person, error: personError } = await supabase
      //   .from("person")
      //   .select("*")
      //   .eq("auth_user_id", data.user.id)
      //   .maybeSingle();

      // if (personError) throw personError;
      // if (!person) throw new Error("User profile not found");

      // Redirect based on role
      switch (role) {
        case "admin":
          router.push("/admin/dashboard");
          break;

        case "superadmin":
          router.push("/super-admin/dashboard");
          break;

        case "human":
          router.push("/account/dashboard");
          break;

        default:
          router.push("/");
      }
    } catch (err: any) {
      console.error("Login Error:", err);
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
          SAC Skill Tracker
        </h1>
        <p className="text-center text-sm text-gray-600 mb-6">
          Swimming Progress Dashboard
        </p>

        {/* Login Form */}
        <form onSubmit={handleLogin} className="space-y-4">
          {/* Full Name Input */}
          <div>
            <label
              htmlFor="fullName"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Full Name
            </label>
            <input
              id="fullName"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Enter your full name"
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>

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
            {/* Password Input */}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="w-full px-4 py-2 border border-gray-300 rounded-md"
            />
          </div>

          {/* Role Selector */}
          <div>
            <label
              htmlFor="role"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              I am a...
            </label>
            <select
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            >
              <option value="">Select your role</option>
              <option value="instructor">Instructor</option>
              <option value="account">Parent/Swimmer</option>
              <option value="admin">Admin</option>
              <option value="superadmin">Super Admin</option>
            </select>
          </div>

          {/* Error Message */}
          {error && (
            <div className="text-red-600 text-sm text-center">{error}</div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-md transition duration-200"
          >
            Continue
          </button>
        </form>
        <p className="text-center text-sm text-gray-600 mt-6">
          Don't have an account?{" "}
          <button
            onClick={() => router.push("/signup")}
            className="text-blue-600 hover:underline"
          >
            Sign Up
          </button>
        </p>
      </div>
    </div>
  );
}
