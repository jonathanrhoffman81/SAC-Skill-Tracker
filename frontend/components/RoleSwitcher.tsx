/**
 * RoleSwitcher.tsx
 *
 * A floating widget shown on dashboards when the logged-in user has multiple roles.
 * Renders nothing if the user only has one role.
 *
 * Usage — add to the bottom of any dashboard page:
 *   import RoleSwitcher from "@/components/RoleSwitcher";
 *   ...
 *   <RoleSwitcher currentRole="admin" />
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getAvailableRoles,
  getDashboardPathsForRoles,
  saveActiveRole,
} from "@/lib/authRoles";

interface Props {
  /** The role this dashboard is currently running as, e.g. "admin", "instructor", "account" */
  currentRole: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  "super-admin": "Super Admin",
  instructor: "Instructor",
  account: "Parent / Guardian",
};

const ROLE_COLORS: Record<string, string> = {
  admin: "#2563EB",
  "super-admin": "#7C3AED",
  instructor: "#16A34A",
  account: "#D97706",
};

export default function RoleSwitcher({ currentRole }: Props) {
  const router = useRouter();
  const [dashboards, setDashboards] = useState<
    Array<{ role: string; path: string; label: string }>
  >([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const roles = getAvailableRoles();
    const all = getDashboardPathsForRoles(roles);
    // Only show the switcher if there are other dashboards to switch to
    const others = all.filter((d) => d.role !== currentRole);
    if (others.length > 0) setDashboards(all);
  }, [currentRole]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Don't render if single-role user
  if (dashboards.length <= 1) return null;

  const accentColor = ROLE_COLORS[currentRole] ?? "#2563EB";
  const others = dashboards.filter((d) => d.role !== currentRole);

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        bottom: "1.5rem",
        right: "1.5rem",
        zIndex: 200,
      }}
    >
      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 10px)",
            right: 0,
            background: "#fff",
            border: "1.5px solid #e5e7eb",
            borderRadius: "14px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.13)",
            minWidth: "220px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 14px 8px",
              borderBottom: "1px solid #f3f4f6",
            }}
          >
            <p
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#9ca3af",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Switch dashboard
            </p>
          </div>

          {/* Current role — shown as inactive */}
          <div
            style={{
              padding: "10px 14px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "#f9fafb",
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: ROLE_COLORS[currentRole] ?? "#6b7280",
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
              {ROLE_LABELS[currentRole] ?? currentRole}
            </span>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 10,
                background: "#e5e7eb",
                color: "#6b7280",
                borderRadius: 99,
                padding: "2px 8px",
                fontWeight: 600,
              }}
            >
              Current
            </span>
          </div>

          {others.map(({ role, path, label }) => (
            <button
              key={role}
              onClick={() => {
                saveActiveRole(role);
                setOpen(false);
                router.push(path);
              }}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.12s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "#f3f4f6")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: ROLE_COLORS[role] ?? "#6b7280",
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>
                {label}
              </span>
              <svg
                style={{
                  marginLeft: "auto",
                  width: 14,
                  height: 14,
                  color: "#9ca3af",
                }}
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
          ))}
        </div>
      )}

      {/* Trigger button */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: accentColor,
          color: "#fff",
          border: "none",
          borderRadius: "99px",
          padding: "10px 16px",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
          transition: "opacity 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
        aria-label="Switch dashboard"
      >
        <svg
          style={{ width: 16, height: 16 }}
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
        Switch Role
        <svg
          style={{
            width: 14,
            height: 14,
            transition: "transform 0.15s",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
    </div>
  );
}
