/**
 * RoleSwitcher.tsx
 *
 * Click to cycle roles (no dropdown UI).
 * Safe for single-role users (renders static label).
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getAvailableRoles,
  getDashboardPathsForRoles,
  saveActiveRole,
} from "@/lib/authRoles";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Dashboard {
  role: string;
  path: string;
  label: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getRoleLabel(role: string, dashboards: Dashboard[]) {
  return dashboards.find((d) => d.role === role)?.label ?? role;
}

function useRoleDashboards(currentRole: string) {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [hasSuperAdmin, setHasSuperAdmin] = useState(false);

  useEffect(() => {
    const roles = getAvailableRoles();
    setHasSuperAdmin(roles.includes("super-admin"));
    const all = getDashboardPathsForRoles(roles);
    if (all.length > 0) setDashboards(all);
  }, [currentRole]);

  return { dashboards, hasSuperAdmin };
}

// ─── Header Switcher (CLICK TO CYCLE) ───────────────────────────────────────

export function RoleSwitcherBadge({ currentRole }: { currentRole: string }) {
  const router = useRouter();
  const { dashboards, hasSuperAdmin } = useRoleDashboards(currentRole);

  if (hasSuperAdmin) return null;

  const handleCycle = () => {
    if (dashboards.length <= 1) return;

    const currentIndex = dashboards.findIndex((d) => d.role === currentRole);

    const next = dashboards[(currentIndex + 1) % dashboards.length];
    if (!next) return;

    saveActiveRole(next.role);
    router.push(next.path);
  };

  const label = getRoleLabel(currentRole, dashboards);

  // Single role → static label (no button behavior needed)
  if (dashboards.length <= 1) {
    return (
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "#374151",
          background: "#F3F4F6",
          padding: "2px 10px",
          borderRadius: 999,
        }}
      >
        {label}
      </span>
    );
  }

  return (
    <button
      onClick={handleCycle}
      title="Switch role"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        border: "1px solid #E5E7EB",
        background: "#fff",
        color: "#111827",
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "#F9FAFB";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "#fff";
      }}
    >
      {label}

      <svg
        width={11}
        height={11}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        style={{ opacity: 0.5, transform: "rotate(90deg)" }}
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

// ─── Floating Button (OPTIONAL BUT CLEANED) ────────────────────────────────

export function RoleSwitcherFAB({ currentRole }: { currentRole: string }) {
  const router = useRouter();
  const { dashboards, hasSuperAdmin } = useRoleDashboards(currentRole);

  if (hasSuperAdmin) return null;

  const handleCycle = () => {
    if (dashboards.length <= 1) return;

    const currentIndex = dashboards.findIndex((d) => d.role === currentRole);

    const next = dashboards[(currentIndex + 1) % dashboards.length];
    if (!next) return;

    saveActiveRole(next.role);
    router.push(next.path);
  };

  const label = getRoleLabel(currentRole, dashboards);

  if (dashboards.length <= 1) return null;

  return (
    <button
      onClick={handleCycle}
      style={{
        position: "fixed",
        bottom: "1.5rem",
        right: "1.5rem",
        zIndex: 300,
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#111827",
        color: "#fff",
        border: "none",
        borderRadius: 999,
        padding: "10px 16px",
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
        boxShadow: "0 6px 20px rgba(0,0,0,0.2)",
      }}
    >
      {label}

      <svg
        width={12}
        height={12}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        style={{ opacity: 0.7 }}
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

// default export (optional compatibility)
export default RoleSwitcherFAB;
