/**
 * SAC/Instructor dashboard page
 * Purpose: overview dashboard focused on instructor roster and skill evaluation.
 */

"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  createAuthenticatedHeaders,
  logoutAndRedirect,
} from "@/lib/clientAuth";

const TabSkeleton = ({ title }: { title: string }) => (
  <div className="w-full min-h-[60vh] rounded-lg border border-gray-200 bg-white p-4 sm:rounded-xl sm:p-6">
    <div className="mb-4 flex items-center gap-3">
      <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-blue-600" />
      <p className="text-sm font-medium text-gray-700">Loading swimmers...</p>
    </div>
    <div className="space-y-3 animate-pulse">
      <div className="h-10 rounded-lg bg-gray-100" />
      <div className="h-24 rounded-lg bg-gray-100" />
      <div className="h-24 rounded-lg bg-gray-100" />
    </div>
  </div>
);

const AdminInstructorEvaluations = dynamic(
  () => import("@/components/AdminInstructorEvaluations"),
  {
    loading: () => <TabSkeleton title="Swimmers" />,
    ssr: false,
  }
);

interface InstructorDashboardPayload {
  userName: string;
  organizationName: string;
  organizationLogoUrl: string | null;
  error?: string;
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function InstructorDashboard() {
  const [userName, setUserName] = useState("Instructor");
  const [organizationName, setOrganizationName] = useState("SAC Skill Tracker");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadBannerData() {
      try {
        const headers = await createAuthenticatedHeaders();
        const response = await fetch("/api/instructor/dashboard", { headers });
        const payload =
          (await response.json()) as InstructorDashboardPayload;

        if (!response.ok) {
          throw new Error(payload.error || "Failed to load instructor dashboard.");
        }

        if (!isMounted) return;

        setUserName(payload.userName || "Instructor");
        setOrganizationName(payload.organizationName || "SAC Skill Tracker");
        setLogoUrl(payload.organizationLogoUrl || null);
      } catch {
        if (!isMounted) return;
        setUserName("Instructor");
        setOrganizationName("SAC Skill Tracker");
        setLogoUrl(null);
      }
    }

    loadBannerData();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-3 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100 sm:h-9 sm:w-9 sm:rounded-xl">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Organization Logo"
                  className="h-full w-full object-cover"
                  onError={() => setLogoUrl(null)}
                />
              ) : (
                <svg
                  className="h-4 w-4 text-gray-500 sm:h-5 sm:w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-gray-900 sm:text-sm">
                {organizationName}
              </p>
              <p className="hidden text-[10px] text-gray-500 sm:block sm:text-xs">
                Instructor Dashboard
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden text-right md:block">
              <p className="text-sm font-medium text-gray-900">
                {userName || "Instructor"}
              </p>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                Instructor
              </span>
            </div>
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-800 text-[10px] font-semibold text-white sm:h-9 sm:w-9 sm:text-xs">
              {userName ? getInitials(userName) : "IN"}
            </div>
            <button
              onClick={async () => {
                await logoutAndRedirect("/login");
              }}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 sm:h-9 sm:w-9"
              aria-label="Log out"
            >
              <svg
                className="h-4 w-4 sm:h-5 sm:w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h5a2 2 0 012 2v1"
                />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-6 sm:py-8">
        <AdminInstructorEvaluations
          initialListView="my-swimmers"
          lockInitialListView
          initialStatusFilter="active"
          lockInitialStatusFilter
        />
      </main>
    </div>
  );
}

