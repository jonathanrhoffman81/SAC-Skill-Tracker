"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createAuthenticatedHeaders } from "@/lib/clientAuth";

type RoleKey = "admin" | "instructor" | "parent" | "swimmer";

type AccountRecord = {
    person_id: string | null;
    member_id?: string | null;
    first_name?: string;
    last_name?: string;
    email?: string;
    linkedSwimmers?: Array<{ member_id: string; name: string }>;
    roles: Record<RoleKey, boolean>;
};

type Toast = {
    id: number;
    message: string;
    type: "success" | "error";
};

const ROLE_ORDER: RoleKey[] = ["admin", "instructor"];
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const ROLE_LABELS: Record<RoleKey, string> = {
    admin: "Admin",
    instructor: "Instructor",
    parent: "Parent",
    swimmer: "Swimmer",
};

export default function AccountsManager({ onRefresh }: { onRefresh?: () => void }) {
    const [accounts, setAccounts] = useState<AccountRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState("");
    const [roleFilter, setRoleFilter] = useState<"all" | RoleKey | "account">("all");
    const [pendingUpdates, setPendingUpdates] = useState<Set<string>>(new Set());
    const [toasts, setToasts] = useState<Toast[]>([]);
    const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

    function getDisplayName(account: AccountRecord) {
        const fullName = `${account.first_name || ""} ${account.last_name || ""}`.trim();
        return fullName || account.email || "Unnamed";
    }

    const showMessage = (text: string, type: "success" | "error") => {
        const id = Date.now() + Math.floor(Math.random() * 1000);
        setToasts((prev) => [...prev, { id, message: text, type }]);
        setTimeout(() => {
            setToasts((prev) => prev.filter((toast) => toast.id !== id));
        }, 3500);
    };

    const fetchAccounts = async () => {
        setLoading(true);
        try {
            const headers = await createAuthenticatedHeaders();
            const response = await fetch("/api/admin/accounts", { headers });
            const payload = await response.json();

            if (!response.ok) {
                throw new Error(payload?.error || "Failed to load accounts");
            }

            setAccounts(payload.accounts || []);
        } catch (error) {
            showMessage(error instanceof Error ? error.message : "Failed to load accounts", "error");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAccounts();
    }, []);

    const hasAccountLink = (account: AccountRecord) => Boolean(account.person_id);

    const filteredAccounts = useMemo(() => {
        const normalizedSearch = search.trim().toLowerCase();

        return accounts.filter((account) => {
            if (roleFilter !== "all") {
                const roleToCheck: RoleKey | string = roleFilter === "account" ? "parent" : roleFilter;
                if (!account.roles[roleToCheck as RoleKey]) {
                    return false;
                }
            }

            if (!normalizedSearch) return true;

            const fullName = `${account.first_name || ""} ${account.last_name || ""}`.trim().toLowerCase();
            const email = (account.email || "").toLowerCase();
            const linkedSwimmers = (account.linkedSwimmers || [])
                .map((swimmer) => swimmer.name)
                .join(" ")
                .toLowerCase();

            return (
                fullName.includes(normalizedSearch) ||
                email.includes(normalizedSearch) ||
                linkedSwimmers.includes(normalizedSearch)
            );
        });
    }, [accounts, roleFilter, search]);

    const groupedAccounts = useMemo(() => {
        const getRolePriority = (roles: Record<RoleKey, boolean>) => {
            if (roles.admin) return 0;
            if (roles.instructor) return 1;
            if (roles.parent) return 2;
            return 3; // swimmer or other
        };

        const sorted = [...filteredAccounts].sort((a, b) => {
            const rolePriorityA = getRolePriority(a.roles);
            const rolePriorityB = getRolePriority(b.roles);

            if (rolePriorityA !== rolePriorityB) {
                return rolePriorityA - rolePriorityB;
            }

            return getDisplayName(a).toLowerCase().localeCompare(getDisplayName(b).toLowerCase());
        });

        return sorted.reduce<Record<string, AccountRecord[]>>((groups, account) => {
            const firstChar = getDisplayName(account).trim().charAt(0).toUpperCase();
            const letter = /[A-Z]/.test(firstChar) ? firstChar : "#";
            if (!groups[letter]) {
                groups[letter] = [];
            }
            groups[letter].push(account);
            return groups;
        }, {});
    }, [filteredAccounts]);

    const availableLetters = useMemo(
        () => new Set(Object.keys(groupedAccounts)),
        [groupedAccounts],
    );

    const scrollToLetter = (letter: string) => {
        const section = sectionRefs.current[letter];
        if (!section) return;

        const scrollContainer = section.closest('[class*="overflow-y-auto"]') as HTMLElement;
        if (!scrollContainer) return;

        const sectionRect = section.getBoundingClientRect();
        const containerRect = scrollContainer.getBoundingClientRect();
        const offset = sectionRect.top - containerRect.top;

        scrollContainer.scrollBy({
            top: offset,
            behavior: 'smooth',
        });
    };

    const updateRole = async (personId: string, role: RoleKey, enabled: boolean) => {
        const pendingKey = `${personId}:${role}`;
        setPendingUpdates((prev) => new Set(prev).add(pendingKey));

        const previous = accounts;
        setAccounts((prev) =>
            prev.map((account) =>
                account.person_id === personId
                    ? {
                        ...account,
                        roles: {
                            ...account.roles,
                            [role]: enabled,
                            ...(role === "admin" && enabled ? { instructor: true } : {}),
                        },
                    }
                    : account,
            ),
        );

        try {
            const response = await fetch("/api/admin/accounts", {
                method: "PATCH",
                headers: await createAuthenticatedHeaders({ "Content-Type": "application/json" }),
                body: JSON.stringify({ person_id: personId, role, enabled }),
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload?.error || "Failed to update role");
            }

            showMessage(`${ROLE_LABELS[role]} role ${enabled ? "assigned" : "removed"}`, "success");
            onRefresh?.();
        } catch (error) {
            setAccounts(previous);
            showMessage(error instanceof Error ? error.message : "Failed to update role", "error");
        } finally {
            setPendingUpdates((prev) => {
                const next = new Set(prev);
                next.delete(pendingKey);
                return next;
            });
        }
    };

    return (
        <>
            {/* Fixed toast notifications */}
            <div className="fixed top-4 right-4 z-[100] space-y-2 w-[92vw] max-w-sm pointer-events-none">
                {toasts.map((toast) => (
                    <div
                        key={toast.id}
                        className={`pointer-events-auto rounded-lg border px-3 py-2 shadow-lg text-xs sm:text-sm ${toast.type === "success"
                            ? "bg-green-50 border-green-200 text-green-800"
                            : "bg-red-50 border-red-200 text-red-800"
                            }`}
                    >
                        {toast.message}
                    </div>
                ))}
            </div>

            <div className="bg-white rounded-lg sm:rounded-xl border border-gray-200 shadow-sm flex flex-col h-screen">
                <div className="sticky top-0 z-20 bg-white border-b border-gray-200 p-4 sm:p-6">
                    <p className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">
                        Manage Accounts
                    </p>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <input
                            type="text"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search by name or email"
                            className="sm:col-span-2 w-full px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        />
                        <select
                            value={roleFilter}
                            onChange={(event) => setRoleFilter(event.target.value as "all" | RoleKey | "account")}
                            className="w-full px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        >
                            <option value="all">All roles</option>
                            {ROLE_ORDER.map((role) => (
                                <option key={role} value={role}>
                                    {ROLE_LABELS[role]}
                                </option>
                            ))}
                            <option value="account">Account</option>
                        </select>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 sm:p-6">

                    {loading ? (
                        <div className="flex items-center justify-center py-6 sm:py-8">
                            <div className="animate-spin rounded-full h-5 w-5 sm:h-6 sm:w-6 border-b-2 border-blue-600" />
                        </div>
                    ) : filteredAccounts.length === 0 ? (
                        <p className="text-xs sm:text-sm text-gray-500 text-center py-3 sm:py-4">
                            No accounts match your filters.
                        </p>
                    ) : (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
                            <div className="space-y-3">
                                {[...LETTERS, "#"]
                                    .filter((letter) => groupedAccounts[letter]?.length)
                                    .map((letter) => (
                                        <div
                                            key={letter}
                                            ref={(element) => {
                                                sectionRefs.current[letter] = element;
                                            }}
                                        >
                                            <div className="sticky top-0 z-5 bg-white/95 backdrop-blur text-xs font-semibold text-gray-600 py-1">
                                                {letter}
                                            </div>
                                            <div className="space-y-2">
                                                {groupedAccounts[letter].map((account) => (
                                                    <div
                                                        key={account.person_id || `member:${account.member_id}`}
                                                        className="border border-gray-200 rounded-lg p-3"
                                                    >
                                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-2 mb-1">
                                                                    <p className="text-sm sm:text-base font-medium text-gray-900 truncate">
                                                                        {getDisplayName(account)}
                                                                    </p>
                                                                </div>
                                                                <p className="text-xs text-gray-500 truncate">
                                                                    {account.email || "No email"}
                                                                </p>
                                                            </div>

                                                            <div className="flex flex-wrap gap-1.5 sm:ml-auto sm:justify-end">
                                                                {ROLE_ORDER.map((role) => {
                                                                    const enabled = Boolean(account.roles[role]);
                                                                    const pendingKey = `${account.person_id}:${role}`;
                                                                    const pending = pendingUpdates.has(pendingKey);
                                                                    const lockedByAdmin =
                                                                        role === "instructor" && account.roles.admin && enabled;
                                                                    const cannotToggle =
                                                                        pending || !account.person_id || lockedByAdmin;

                                                                    return (
                                                                        <button
                                                                            key={role}
                                                                            type="button"
                                                                            onClick={() => {
                                                                                if (!account.person_id || cannotToggle) return;
                                                                                updateRole(account.person_id, role, !enabled);
                                                                            }}
                                                                            disabled={cannotToggle}
                                                                            className={`px-2.5 py-1 text-xs rounded-md border transition ${enabled
                                                                                ? "border-blue-600 bg-blue-600 text-white"
                                                                                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                                                                                } ${cannotToggle ? "opacity-60 cursor-not-allowed" : ""}`}
                                                                        >
                                                                            {pending ? "Updating..." : ROLE_LABELS[role]}
                                                                        </button>
                                                                    );
                                                                })}

                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        if (!account.person_id) return;
                                                                        updateRole(account.person_id, "parent", !account.roles.parent);
                                                                    }}
                                                                    disabled={!account.person_id || pendingUpdates.has(`${account.person_id}:parent`)}
                                                                    className={`px-2.5 py-1 text-xs rounded-md border transition ${account.roles.parent
                                                                        ? 'border-blue-600 bg-blue-600 text-white'
                                                                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                                                                        } ${!account.person_id || pendingUpdates.has(`${account.person_id}:parent`) ? "opacity-60 cursor-not-allowed" : ""}`}
                                                                >
                                                                    {pendingUpdates.has(`${account.person_id}:parent`) ? "Updating..." : "Account"}
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {account.linkedSwimmers && account.linkedSwimmers.length > 0 && (
                                                            <div className="mt-3 border-t border-gray-100 pt-3">
                                                                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                                                                    Kids
                                                                </p>
                                                                <div className="flex flex-wrap gap-2">
                                                                    {account.linkedSwimmers.map((swimmer) => (
                                                                        <span
                                                                            key={swimmer.member_id}
                                                                            className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700 border border-blue-100"
                                                                        >
                                                                            {swimmer.name}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                            </div>

                            <div className="flex sm:flex-col flex-wrap gap-1 max-sm:pt-1 sm:sticky sm:top-0 sm:self-start sm:bg-white sm:py-4 sm:pr-4">
                                {[...LETTERS, "#"].map((letter) => {
                                    const hasEntries = availableLetters.has(letter);
                                    return (
                                        <button
                                            key={letter}
                                            type="button"
                                            onClick={() => hasEntries && scrollToLetter(letter)}
                                            disabled={!hasEntries}
                                            className={`w-6 h-6 rounded text-[11px] border ${hasEntries
                                                ? "border-gray-300 text-gray-700 hover:bg-gray-100"
                                                : "border-gray-200 text-gray-300 cursor-not-allowed"
                                                }`}
                                        >
                                            {letter}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}                </div>            </div>
        </>
    );
}
