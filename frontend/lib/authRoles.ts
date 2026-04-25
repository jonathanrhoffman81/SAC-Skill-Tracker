/**
 * Shared auth utilities for client pages and server routes.
 * Keeps role normalization and routing behavior consistent across login/signup APIs.
 */

export const ROLE_PRIORITY = [
  "super-admin",
  "superadmin",
  "org-admin",
  "org_admin",
  "admin",
  "instructor",
  "guardian",
  "parent",
  "member",
  "account",
  "human",
  "swimmer",
] as const;

const ACCOUNT_ROLE_SET = new Set([
  "account",
  "human",
  "guardian",
  "parent",
  "swimmer",
]);

export function normalizeEmail(value: string) {
  return String(value || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/^["'""]+|["'""]+$/g, "")
    .toLowerCase();
}

export function normalizeRole(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .trim();
}

export function toAppRole(roleName: string): string | null {
  const normalized = normalizeRole(roleName);

  if (normalized === "superadmin" || normalized === "super-admin") {
    return "super-admin";
  }

  if (normalized === "org-admin" || normalized === "admin") {
    return "admin";
  }

  if (normalized === "instructor") {
    return "instructor";
  }

  if (ACCOUNT_ROLE_SET.has(normalized)) {
    return "account";
  }

  return normalized || null;
}

export function pickHighestPriorityRole(roleNames: string[]) {
  const normalizedUniqueRoles = Array.from(
    new Set(roleNames.map((role) => normalizeRole(role)).filter(Boolean)),
  );

  const preferredRole = ROLE_PRIORITY.find((priorityRole) =>
    normalizedUniqueRoles.includes(priorityRole),
  );

  return preferredRole || normalizedUniqueRoles[0] || null;
}

/**
 * NEW: Returns all unique app-level roles for a list of raw role names.
 * Used to detect multi-role users who should see the role switcher.
 */
export function getAllAppRoles(roleNames: string[]): string[] {
  const appRoles = roleNames
    .map((r) => toAppRole(normalizeRole(r)))
    .filter((r): r is string => Boolean(r));
  return Array.from(new Set(appRoles));
}

export function getDashboardPathForRole(roleName: string): string | null {
  const normalized = normalizeRole(roleName);

  if (normalized === "instructor") {
    return "/instructor/dashboard";
  }

  if (normalized === "admin") {
    return "/admin/dashboard";
  }

  if (normalized === "superadmin" || normalized === "super-admin") {
    return "/super-admin/dashboard";
  }

  if (ACCOUNT_ROLE_SET.has(normalized)) {
    return "/account/dashboard";
  }

  return null;
}

/**
 * NEW: Returns all dashboard paths for a list of app roles.
 * Returns an empty array if no valid paths exist.
 */
export function getDashboardPathsForRoles(
  appRoles: string[],
): Array<{ role: string; path: string; label: string }> {
  const ROLE_LABELS: Record<string, string> = {
    "super-admin": "Super Admin",
    admin: "Admin",
    instructor: "Instructor",
    account: "Parent / Guardian",
  };

  return appRoles
    .map((role) => {
      const path = getDashboardPathForRole(role);
      if (!path) return null;
      return { role, path, label: ROLE_LABELS[role] ?? role };
    })
    .filter((r): r is { role: string; path: string; label: string } =>
      Boolean(r),
    );
}

/**
 * Returns the forced dashboard when a role combination should bypass /role-select.
 */
export function getRoleSelectBypass(appRoles: string[]): {
  role: string;
  path: string;
} | null {
  const normalized = new Set(appRoles.map((role) => normalizeRole(role)));

  // Product rule: super-admin users should always land on admin.
  if (normalized.has("super-admin")) {
    return { role: "admin", path: "/admin/dashboard" };
  }

  return null;
}

// ─── Session storage helpers for multi-role persistence ──────────────────────

const MULTI_ROLE_KEY = "auth:available-roles";
const ACTIVE_ROLE_KEY = "auth:active-role";

/**
 * Persists all available roles to sessionStorage after login.
 * Call this once after successful auth, before redirecting.
 */
export function saveAvailableRoles(roles: string[]) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(MULTI_ROLE_KEY, JSON.stringify(roles));
}

/**
 * Retrieves all available roles from sessionStorage.
 */
export function getAvailableRoles(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(MULTI_ROLE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Persists the currently active role to sessionStorage.
 */
export function saveActiveRole(role: string) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(ACTIVE_ROLE_KEY, role);
}

/**
 * Retrieves the currently active role from sessionStorage.
 */
export function getActiveRole(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(ACTIVE_ROLE_KEY);
}

/**
 * Clears all role session data. Call on logout.
 */
export function clearRoleSession() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(MULTI_ROLE_KEY);
  sessionStorage.removeItem(ACTIVE_ROLE_KEY);
}
