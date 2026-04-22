/**
 * /role-select/page.tsx
 *
 * Shown after login when a user has multiple roles.
 * Lets them choose which dashboard to enter.
 * Also used by the RoleSwitcher widget to switch between dashboards mid-session.
 */

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getAvailableRoles,
  getDashboardPathsForRoles,
  saveActiveRole,
} from "@/lib/authRoles";

const ROLE_ICONS: Record<string, React.ReactNode> = {
  admin: (
    <svg
      className="w-6 h-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  ),
  "super-admin": (
    <svg
      className="w-6 h-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
      />
    </svg>
  ),
  instructor: (
    <svg
      className="w-6 h-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
      />
    </svg>
  ),
  account: (
    <svg
      className="w-6 h-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M17 20h5v-2a4 4 0 00-5.356-3.76M17 20H7m10 0v-2c0-.653-.126-1.277-.356-1.848M7 20H2v-2a4 4 0 015.356-3.76M7 20v-2c0-.653.126-1.277.356-1.848m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  ),
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: "Manage swimmers, classes, instructors, and organization settings.",
  "super-admin": "Full platform access across all organizations.",
  instructor: "View and evaluate your assigned swimmers.",
  account: "View your linked swimmers' skill progress.",
};

const ROLE_COLORS: Record<
  string,
  { bg: string; border: string; icon: string; badge: string }
> = {
  admin: {
    bg: "hover:bg-blue-50",
    border: "hover:border-blue-300",
    icon: "bg-blue-100 text-blue-600",
    badge: "bg-blue-100 text-blue-700",
  },
  "super-admin": {
    bg: "hover:bg-purple-50",
    border: "hover:border-purple-300",
    icon: "bg-purple-100 text-purple-600",
    badge: "bg-purple-100 text-purple-700",
  },
  instructor: {
    bg: "hover:bg-green-50",
    border: "hover:border-green-300",
    icon: "bg-green-100 text-green-600",
    badge: "bg-green-100 text-green-700",
  },
  account: {
    bg: "hover:bg-amber-50",
    border: "hover:border-amber-300",
    icon: "bg-amber-100 text-amber-600",
    badge: "bg-amber-100 text-amber-700",
  },
};

export default function RoleSelect() {
  const router = useRouter();
  const [dashboards, setDashboards] = useState<
    Array<{ role: string; path: string; label: string }>
  >([]);
  const [selecting, setSelecting] = useState<string | null>(null);

  useEffect(() => {
    const roles = getAvailableRoles();
    const available = getDashboardPathsForRoles(roles);

    if (available.length === 0) {
      // No roles saved — send back to login
      router.replace("/login");
      return;
    }

    if (available.length === 1) {
      // Only one role — skip the picker
      saveActiveRole(available[0].role);
      router.replace(available[0].path);
      return;
    }

    setDashboards(available);
  }, [router]);

  const handleSelect = (role: string, path: string) => {
    setSelecting(role);
    saveActiveRole(role);
    router.push(path);
  };

  if (dashboards.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="flex items-center gap-3 text-gray-500">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        {/* Header */}
        <div className="flex justify-center mb-6">
          <div className="w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center">
            <svg
              className="w-7 h-7 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
              />
            </svg>
          </div>
        </div>

        <h1 className="text-xl font-bold text-center text-gray-900 mb-1">
          Choose a Dashboard
        </h1>
        <p className="text-sm text-center text-gray-500 mb-8">
          Your account has multiple roles. Select which view to open.
        </p>

        {/* Role cards */}
        <div className="space-y-3">
          {dashboards.map(({ role, path, label }) => {
            const colors = ROLE_COLORS[role] ?? ROLE_COLORS.account;
            const isLoading = selecting === role;

            return (
              <button
                key={role}
                onClick={() => handleSelect(role, path)}
                disabled={selecting !== null}
                className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 border-gray-200 bg-white transition-all duration-150 text-left disabled:opacity-60 disabled:cursor-not-allowed ${colors.bg} ${colors.border}`}
              >
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${colors.icon}`}
                >
                  {isLoading ? (
                    <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : (
                    (ROLE_ICONS[role] ?? ROLE_ICONS.account)
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-gray-900">
                      {label}
                    </span>
                    <span
                      className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${colors.badge}`}
                    >
                      {role}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 leading-snug">
                    {ROLE_DESCRIPTIONS[role] ?? "Access your dashboard."}
                  </p>
                </div>

                <svg
                  className="w-4 h-4 text-gray-400 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
