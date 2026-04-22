/**
 * RoleSwitcher.tsx
 *
 * Two integrated UI surfaces for switching dashboards mid-session:
 *
 *
 * Both render null for single-role users — safe to add to every dashboard.
 **/

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getAvailableRoles,
  getDashboardPathsForRoles,
  saveActiveRole,
} from "@/lib/authRoles";

// ─── Config ───────────────────────────────────────────────────────────────────

interface Dashboard {
  role: string;
  path: string;
  label: string;
}

const ROLE_META: Record<
  string,
  { color: string; bg: string; text: string; dot: string; description: string }
> = {
  admin: {
    color: "#2563EB",
    bg: "#EFF6FF",
    text: "#1D4ED8",
    dot: "#3B82F6",
    description: "Manage swimmers, classes & org settings",
  },
  "super-admin": {
    color: "#7C3AED",
    bg: "#F5F3FF",
    text: "#6D28D9",
    dot: "#8B5CF6",
    description: "Full platform access across all orgs",
  },
  instructor: {
    color: "#059669",
    bg: "#ECFDF5",
    text: "#047857",
    dot: "#10B981",
    description: "View and evaluate your swimmers",
  },
  account: {
    color: "#D97706",
    bg: "#FFFBEB",
    text: "#B45309",
    dot: "#F59E0B",
    description: "View your swimmers' skill progress",
  },
};

const DEFAULT_META = {
  color: "#6B7280",
  bg: "#F9FAFB",
  text: "#374151",
  dot: "#9CA3AF",
  description: "Access your dashboard",
};

function getMeta(role: string) {
  return ROLE_META[role] ?? DEFAULT_META;
}

function RoleIcon({ role, size = 16 }: { role: string; size?: number }) {
  const s = size;
  if (role === "admin" || role === "super-admin") {
    return (
      <svg
        width={s}
        height={s}
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
    );
  }
  if (role === "instructor") {
    return (
      <svg
        width={s}
        height={s}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    );
  }
  return (
    <svg
      width={s}
      height={s}
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
  );
}

function useRoleDashboards(currentRole: string) {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  useEffect(() => {
    const roles = getAvailableRoles();
    const all = getDashboardPathsForRoles(roles);
    if (all.length > 1) setDashboards(all);
  }, [currentRole]);
  return dashboards;
}

// ─── Shared dropdown panel ────────────────────────────────────────────────────

function SwitcherPanel({
  dashboards,
  currentRole,
  onSelect,
  navigating,
}: {
  dashboards: Dashboard[];
  currentRole: string;
  onSelect: (role: string, path: string) => void;
  navigating: string | null;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E7EB",
        borderRadius: 10,
        boxShadow: "0 10px 25px rgba(0,0,0,0.10)",
        width: 160,
        padding: 4,
      }}
    >
      {dashboards.map(({ role, path, label }) => {
        const isLoading = navigating === role;

        return (
          <button
            key={role}
            onClick={() => onSelect(role, path)}
            disabled={navigating !== null}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 8,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
              color: "#374151",
              textAlign: "left",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#F9FAFB";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ flex: 1 }}>{label}</span>

              {isLoading && (
                <span
                  style={{
                    width: 10,
                    height: 10,
                    border: "2px solid #999",
                    borderTopColor: "transparent",
                    borderRadius: "50%",
                  }}
                />
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── 1. Header Badge ──────────────────────────────────────────────────────────

/**
 * Compact pill for the dashboard header.
 * Shows the active role name + colored dot. Clicking opens a dropdown.
 *
 * Add inside your <header> near the user's name, e.g.:
 *
 */
export function RoleSwitcherBadge({ currentRole }: { currentRole: string }) {
  const router = useRouter();
  const dashboards = useRoleDashboards(currentRole);
  const meta = getMeta(currentRole);

  if (dashboards.length <= 1) {
    return (
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: meta.text,
          background: "#F3F4F6",
          padding: "2px 8px",
          borderRadius: 999,
        }}
      >
        {currentRole === "admin" ? "Admin" : currentRole}
      </span>
    );
  }

  const handleCycle = () => {
    const currentIndex = dashboards.findIndex((d) => d.role === currentRole);

    const next = dashboards[(currentIndex + 1) % dashboards.length];

    if (!next) return;

    saveActiveRole(next.role);
    router.push(next.path);
  };

  const currentLabel =
    dashboards.find((d) => d.role === currentRole)?.label ?? currentRole;

  return (
    <button
      onClick={handleCycle}
      title="Switch role"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 99,
        border: `1.5px solid ${meta.color}28`,
        background: "#fff",
        color: meta.text,
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = meta.bg;
        e.currentTarget.style.borderColor = `${meta.color}50`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "#fff";
        e.currentTarget.style.borderColor = `${meta.color}28`;
      }}
    >
      {currentLabel}

      <svg
        width={11}
        height={11}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        style={{
          opacity: 0.55,
          transform: "rotate(90deg)",
        }}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2.5}
          d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
        />
      </svg>
    </button>
  );
}
