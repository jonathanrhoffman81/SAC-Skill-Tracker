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
        .replace(/^["'“”]+|["'“”]+$/g, "")
        .toLowerCase();
}

export function normalizeRole(value: string) {
    return String(value || "")
        .toLowerCase()
        .replace(/[_\s]+/g, "-")
        .trim();
}

export function toAppRole(roleName: string) {
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

export function getDashboardPathForRole(roleName: string) {
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