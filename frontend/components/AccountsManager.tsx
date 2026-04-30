"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { authFetch } from "@/lib/clientAuth";
import DropdownButton from "@/components/DropdownButton";

type RoleKey = "admin" | "instructor" | "parent" | "swimmer";

type AccountRecord = {
    person_id: string | null;
    member_id?: string | null;
    first_name?: string;
    last_name?: string;
    email?: string;
    is_active?: boolean;
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

type StatusFilter = "all" | "active" | "inactive";

export default function AccountsManager({ onRefresh, refreshSignal }: { onRefresh?: () => void; refreshSignal?: number }) {
    const [accounts, setAccounts] = useState<AccountRecord[]>([]);
    const [currentPersonId, setCurrentPersonId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState("");
    const [roleFilter, setRoleFilter] = useState<"all" | RoleKey | "account">("all");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
    const [pendingUpdates, setPendingUpdates] = useState<Set<string>>(new Set());
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [editingKey, setEditingKey] = useState<string | null>(null);
    const [editForm, setEditForm] = useState({
        first_name: "",
        last_name: "",
        email: "",
        is_active: true,
    });
    const [savingEdit, setSavingEdit] = useState(false);
    const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

    const accountKey = (account: AccountRecord) =>
        account.person_id
            ? `person:${account.person_id}`
            : `member:${account.member_id}`;

    const startEdit = (account: AccountRecord) => {
        setEditingKey(accountKey(account));
        setEditForm({
            first_name: account.first_name || "",
            last_name: account.last_name || "",
            email: account.email || "",
            is_active: account.is_active !== false,
        });
    };

    const cancelEdit = () => {
        setEditingKey(null);
    };

    const saveEdit = async (account: AccountRecord) => {
        const original = {
            first_name: account.first_name || "",
            last_name: account.last_name || "",
            email: account.email || "",
            is_active: account.is_active !== false,
        };
        const trimmedFirst = editForm.first_name.trim();
        const trimmedLast = editForm.last_name.trim();
        const trimmedEmail = editForm.email.trim().toLowerCase();

        const noNameChange =
            trimmedFirst === original.first_name.trim() &&
            trimmedLast === original.last_name.trim();
        const noEmailChange =
            !account.person_id || trimmedEmail === original.email.trim().toLowerCase();
        const noStatusChange = editForm.is_active === original.is_active;

        if (noNameChange && noEmailChange && noStatusChange) {
            cancelEdit();
            return;
        }

        if (
            account.person_id &&
            trimmedEmail !== original.email &&
            !window.confirm(
                `Change sign-in email from ${original.email || "(none)"} to ${trimmedEmail || "(none)"}?`,
            )
        ) {
            return;
        }

        setSavingEdit(true);
        try {
            const payload: Record<string, unknown> = {
                first_name: trimmedFirst,
                last_name: trimmedLast,
                is_active: editForm.is_active,
            };
            if (account.person_id) {
                payload.person_id = account.person_id;
                payload.email = trimmedEmail;
            } else {
                payload.member_id = account.member_id;
            }

            const response = await authFetch("/api/admin/accounts", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(result?.error || "Failed to save changes");
            }

            showMessage("Account updated", "success");
            setEditingKey(null);
            await fetchAccounts();
            onRefresh?.();
        } catch (error) {
            showMessage(
                error instanceof Error ? error.message : "Failed to save changes",
                "error",
            );
        } finally {
            setSavingEdit(false);
        }
    };

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
            const response = await authFetch("/api/admin/accounts");
            const payload = await response.json();

            if (!response.ok) {
                throw new Error(payload?.error || "Failed to load accounts");
            }

            setAccounts(payload.accounts || []);
            setCurrentPersonId(payload.currentPersonId ?? null);
        } catch (error) {
            showMessage(error instanceof Error ? error.message : "Failed to load accounts", "error");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAccounts();
    }, [refreshSignal]);

    const hasAccountLink = (account: AccountRecord) => Boolean(account.person_id);

    const accountByMemberId = useMemo(() => {
        const entries = accounts
            .filter((account) => Boolean(account.member_id))
            .map((account) => [account.member_id as string, account] as const);
        return new Map(entries);
    }, [accounts]);

    const filteredAccounts = useMemo(() => {
        const normalizedSearch = search.trim().toLowerCase();

        return accounts.filter((account) => {
            const isSwimmerOnly =
                account.roles.swimmer &&
                !account.roles.admin &&
                !account.roles.instructor &&
                !account.roles.parent;

            if (roleFilter !== "swimmer" && isSwimmerOnly) {
                return false;
            }

            if (roleFilter !== "all") {
                const roleToCheck: RoleKey | string = roleFilter === "account" ? "parent" : roleFilter;
                if (!account.roles[roleToCheck as RoleKey]) {
                    return false;
                }
            }

            if (statusFilter !== "all") {
                const isActive = account.is_active !== false;
                if (statusFilter === "active" && !isActive) {
                    return false;
                }
                if (statusFilter === "inactive" && isActive) {
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
    }, [accounts, roleFilter, search, statusFilter]);

    const groupedAccounts = useMemo(() => {
        const getSortName = (account: AccountRecord) => {
            const firstName = (account.first_name || "").trim();
            const lastName = (account.last_name || "").trim();
            const fullName = `${firstName} ${lastName}`.trim();
            return fullName || account.email || "Unnamed";
        };

        const sorted = [...filteredAccounts].sort((a, b) => {
            const firstA = (a.first_name || "").trim().toLowerCase();
            const firstB = (b.first_name || "").trim().toLowerCase();
            if (firstA !== firstB) {
                return firstA.localeCompare(firstB);
            }

            const lastA = (a.last_name || "").trim().toLowerCase();
            const lastB = (b.last_name || "").trim().toLowerCase();
            if (lastA !== lastB) {
                return lastA.localeCompare(lastB);
            }

            return getSortName(a).toLowerCase().localeCompare(getSortName(b).toLowerCase());
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
        // Self-protection: block removing own admin role outright.
        if (personId === currentPersonId && role === "admin" && !enabled) {
            showMessage("You can't remove your own admin role.", "error");
            return;
        }

        const target = accounts.find((account) => account.person_id === personId);
        const targetName = target ? getDisplayName(target) : "this account";
        const action = enabled ? "Assign" : "Remove";
        const preposition = enabled ? "to" : "from";
        const confirmed = window.confirm(
            `${action} ${ROLE_LABELS[role]} role ${preposition} ${targetName}?`,
        );
        if (!confirmed) return;

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
                        },
                    }
                    : account,
            ),
        );

        try {
            const response = await authFetch("/api/admin/accounts", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
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
            <div className="fixed top-24 right-4 z-[100] space-y-2 w-[92vw] max-w-sm pointer-events-none sm:top-28">
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

            <div className="relative z-0 bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col overflow-visible">
                <div className="relative z-10 bg-white border-b border-gray-200 p-4 sm:p-6">
                    <p className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">
                        Manage Accounts
                    </p>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                        <input
                            type="text"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search by name or email"
                            className="sm:col-span-2 w-full px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        />
                        <DropdownButton
                            value={roleFilter}
                            onChange={(value) => setRoleFilter(value as "all" | RoleKey | "account")}
                            options={[
                                { value: "all", label: "All roles" },
                                ...ROLE_ORDER.map((role) => ({
                                    value: role,
                                    label: ROLE_LABELS[role],
                                })),
                                { value: "account", label: "Account" },
                                { value: "swimmer", label: "Swimmer" },
                            ]}
                            ariaLabel="Filter accounts by role"
                        />
                        <DropdownButton
                            value={statusFilter}
                            onChange={(value) => setStatusFilter(value as StatusFilter)}
                            options={[
                                { value: "all", label: "All statuses" },
                                { value: "active", label: "Active" },
                                { value: "inactive", label: "Inactive" },
                            ]}
                            ariaLabel="Filter accounts by status"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 sm:p-6">

                    {loading ? (
                        <div className="space-y-3 animate-pulse py-2">
                            <div className="h-10 rounded-lg bg-gray-100" />
                            <div className="h-20 rounded-lg bg-gray-100" />
                            <div className="h-20 rounded-lg bg-gray-100" />
                            <div className="h-20 rounded-lg bg-gray-100" />
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
                                            <div className="sticky top-2 z-0 bg-white/95 backdrop-blur text-xs font-semibold text-gray-600 py-1">
                                                {letter}
                                            </div>
                                            <div className="space-y-2">
                                                {groupedAccounts[letter].map((account) => {
                                                    const isEditing = editingKey === accountKey(account);
                                                    return (
                                                    <div
                                                        key={account.person_id || `member:${account.member_id}`}
                                                        className="border border-gray-200 rounded-lg p-3"
                                                    >
                                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                                            <div className="min-w-0">
                                                                <div className="mb-1 flex items-center gap-2">
                                                                    <p className="text-sm sm:text-base font-medium text-gray-900 truncate">
                                                                        {getDisplayName(account)}
                                                                    </p>
                                                                    <span
                                                                        className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] ${account.is_active === false
                                                                            ? "border-red-200 bg-red-50 text-red-700"
                                                                            : "border-green-200 bg-green-50 text-green-700"
                                                                            }`}
                                                                    >
                                                                        {account.is_active === false ? "Inactive" : "Active"}
                                                                    </span>
                                                                </div>
                                                                <p className="text-xs text-gray-500 truncate">
                                                                    {account.email || "No email"}
                                                                </p>
                                                            </div>

                                                            <div className="flex flex-wrap gap-1.5 sm:ml-auto sm:justify-end">
                                                                {roleFilter === "swimmer" ? (
                                                                    <>
                                                                        <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700">
                                                                            Swimmer
                                                                        </span>
                                                                        {account.roles.parent && (
                                                                            <span className="inline-flex items-center rounded-full border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700">
                                                                                Account
                                                                            </span>
                                                                        )}
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        {ROLE_ORDER.map((role) => {
                                                                            const enabled = Boolean(account.roles[role]);
                                                                            const pendingKey = `${account.person_id}:${role}`;
                                                                            const pending = pendingUpdates.has(pendingKey);
                                                                            const lockedSelfAdmin =
                                                                                role === "admin" &&
                                                                                enabled &&
                                                                                Boolean(account.person_id) &&
                                                                                account.person_id === currentPersonId;
                                                                            const cannotToggle =
                                                                                pending || !account.person_id || lockedSelfAdmin;

                                                                            return (
                                                                                <button
                                                                                    key={role}
                                                                                    type="button"
                                                                                    onClick={() => {
                                                                                        if (!account.person_id || cannotToggle) return;
                                                                                        updateRole(account.person_id, role, !enabled);
                                                                                    }}
                                                                                    disabled={cannotToggle}
                                                                                    title={
                                                                                        lockedSelfAdmin
                                                                                            ? "You can't remove your own admin role"
                                                                                            : undefined
                                                                                    }
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
                                                                    </>
                                                                )}
                                                                <button
                                                                    type="button"
                                                                    onClick={() => (isEditing ? cancelEdit() : startEdit(account))}
                                                                    aria-label={isEditing ? "Cancel edit" : "Edit account"}
                                                                    title={isEditing ? "Cancel edit" : "Edit account"}
                                                                    className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                                                                >
                                                                    {isEditing ? (
                                                                        <svg
                                                                            className="h-4 w-4"
                                                                            fill="none"
                                                                            stroke="currentColor"
                                                                            viewBox="0 0 24 24"
                                                                        >
                                                                            <path
                                                                                strokeLinecap="round"
                                                                                strokeLinejoin="round"
                                                                                strokeWidth={2}
                                                                                d="M6 18L18 6M6 6l12 12"
                                                                            />
                                                                        </svg>
                                                                    ) : (
                                                                        <svg
                                                                            className="h-4 w-4"
                                                                            fill="none"
                                                                            stroke="currentColor"
                                                                            viewBox="0 0 24 24"
                                                                        >
                                                                            <path
                                                                                strokeLinecap="round"
                                                                                strokeLinejoin="round"
                                                                                strokeWidth={2}
                                                                                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                                                                            />
                                                                        </svg>
                                                                    )}
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {isEditing && (
                                                            <div className="mt-3 border-t border-gray-100 pt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                                <div>
                                                                    <label className="block text-[11px] font-medium text-gray-600 mb-1">First name</label>
                                                                    <input
                                                                        type="text"
                                                                        value={editForm.first_name}
                                                                        onChange={(e) =>
                                                                            setEditForm((prev) => ({
                                                                                ...prev,
                                                                                first_name: e.target.value,
                                                                            }))
                                                                        }
                                                                        disabled={savingEdit}
                                                                        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 outline-none"
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className="block text-[11px] font-medium text-gray-600 mb-1">Last name</label>
                                                                    <input
                                                                        type="text"
                                                                        value={editForm.last_name}
                                                                        onChange={(e) =>
                                                                            setEditForm((prev) => ({
                                                                                ...prev,
                                                                                last_name: e.target.value,
                                                                            }))
                                                                        }
                                                                        disabled={savingEdit}
                                                                        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 outline-none"
                                                                    />
                                                                </div>
                                                                {account.person_id && (
                                                                    <div className="sm:col-span-2">
                                                                        <label className="block text-[11px] font-medium text-gray-600 mb-1">Email (sign-in address)</label>
                                                                        <input
                                                                            type="email"
                                                                            value={editForm.email}
                                                                            onChange={(e) =>
                                                                                setEditForm((prev) => ({
                                                                                    ...prev,
                                                                                    email: e.target.value,
                                                                                }))
                                                                            }
                                                                            disabled={savingEdit}
                                                                            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 outline-none"
                                                                        />
                                                                    </div>
                                                                )}
                                                                <div className="sm:col-span-2 flex items-center justify-between gap-3 pt-1">
                                                                    <label className="flex items-center gap-2 text-xs text-gray-700">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={editForm.is_active}
                                                                            onChange={(e) =>
                                                                                setEditForm((prev) => ({
                                                                                    ...prev,
                                                                                    is_active: e.target.checked,
                                                                                }))
                                                                            }
                                                                            disabled={
                                                                                savingEdit ||
                                                                                (Boolean(account.person_id) &&
                                                                                    account.person_id === currentPersonId)
                                                                            }
                                                                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                                        />
                                                                        <span>
                                                                            Active
                                                                            {account.person_id === currentPersonId && (
                                                                                <span className="ml-1 text-[11px] text-gray-400">(can't deactivate yourself)</span>
                                                                            )}
                                                                        </span>
                                                                    </label>
                                                                    <div className="flex gap-2">
                                                                        <button
                                                                            type="button"
                                                                            onClick={cancelEdit}
                                                                            disabled={savingEdit}
                                                                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                                                                        >
                                                                            Cancel
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => saveEdit(account)}
                                                                            disabled={savingEdit}
                                                                            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                                                                        >
                                                                            {savingEdit ? "Saving…" : "Save"}
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {account.linkedSwimmers && account.linkedSwimmers.length > 0 && (
                                                            <div className="mt-3 border-t border-gray-100 pt-3">
                                                                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                                                                    Kids
                                                                </p>
                                                                <div className="space-y-2">
                                                                    {account.linkedSwimmers.map((swimmer) => (
                                                                        <div
                                                                            key={swimmer.member_id}
                                                                            className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2"
                                                                        >
                                                                            <div className="flex items-center justify-between gap-2">
                                                                                <p className="text-xs sm:text-sm font-medium text-gray-900 truncate">
                                                                                    {accountByMemberId.get(swimmer.member_id)
                                                                                        ? getDisplayName(accountByMemberId.get(swimmer.member_id) as AccountRecord)
                                                                                        : swimmer.name}
                                                                                </p>
                                                                                <div className="flex flex-wrap items-center justify-end gap-1">
                                                                                    <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700">
                                                                                        Swimmer
                                                                                    </span>
                                                                                    {accountByMemberId.get(swimmer.member_id)?.roles.parent && (
                                                                                        <span className="inline-flex items-center rounded-full border border-gray-300 bg-white px-2 py-0.5 text-[10px] text-gray-700">
                                                                                            Account
                                                                                        </span>
                                                                                    )}
                                                                                    <span
                                                                                        className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${accountByMemberId.get(swimmer.member_id)?.is_active === false
                                                                                            ? "border-red-200 bg-red-50 text-red-700"
                                                                                            : "border-green-200 bg-green-50 text-green-700"
                                                                                            }`}
                                                                                    >
                                                                                        {accountByMemberId.get(swimmer.member_id)?.is_active === false ? "Inactive" : "Active"}
                                                                                    </span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                            </div>

                            <div className="flex sm:flex-col flex-wrap gap-1 max-sm:pt-1 sm:sticky sm:top-2 sm:self-start sm:bg-white sm:py-4 sm:pr-4">
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
