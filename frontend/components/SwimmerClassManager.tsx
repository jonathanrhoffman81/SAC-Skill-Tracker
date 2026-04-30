"use client";

import { useEffect, useMemo, useState } from "react";
import { authFetch } from "@/lib/clientAuth";
import DropdownButton from "@/components/DropdownButton";

type Member = {
    member_id: string;
    first_name: string;
    last_name: string;
    is_active: boolean;
};

type ClassGroup = {
    group_id: string;
    name: string;
};

type AvailableClass = {
    class_id: string;
    name: string;
    schedule: string | null;
    schedule_days: string[] | null;
    schedule_time: string | null;
    start_date: string | null;
    end_date: string | null;
    groups: ClassGroup[];
};

type Enrollment = {
    class_id: string;
    class_name: string;
    group_id: string | null;
    group_name: string | null;
    slot: number;
    enrolled_at: string;
};

type Toast = { id: number; message: string; type: "success" | "error" };

function getDisplayName(member: Member) {
    const name = `${member.first_name || ""} ${member.last_name || ""}`.trim();
    return name || "Unnamed swimmer";
}

function classScheduleSummary(c: AvailableClass) {
    if (c.schedule && c.schedule.trim()) return c.schedule.trim();
    const days = (c.schedule_days || []).join(", ");
    const time = c.schedule_time || "";
    const combined = [days, time].filter(Boolean).join(" / ");
    return combined || "Schedule TBD";
}

export default function SwimmerClassManager() {
    const [members, setMembers] = useState<Member[]>([]);
    const [membersLoading, setMembersLoading] = useState(false);
    const [search, setSearch] = useState("");
    const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

    const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
    const [availableClasses, setAvailableClasses] = useState<AvailableClass[]>([]);
    const [enrollmentsLoading, setEnrollmentsLoading] = useState(false);

    const [addClassId, setAddClassId] = useState<string>("");
    const [addGroupId, setAddGroupId] = useState<string>("");
    const [adding, setAdding] = useState(false);
    const [pendingRemove, setPendingRemove] = useState<Set<string>>(new Set());

    const [toasts, setToasts] = useState<Toast[]>([]);

    const showMessage = (message: string, type: "success" | "error") => {
        const id = Date.now() + Math.floor(Math.random() * 1000);
        setToasts((prev) => [...prev, { id, message, type }]);
        setTimeout(
            () => setToasts((prev) => prev.filter((t) => t.id !== id)),
            3500,
        );
    };

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setMembersLoading(true);
            try {
                const res = await authFetch("/api/admin/members");
                const payload = await res.json();
                if (!res.ok) throw new Error(payload?.error || "Failed to load swimmers");
                if (cancelled) return;
                setMembers(payload.members || []);
            } catch (err) {
                if (cancelled) return;
                showMessage(
                    err instanceof Error ? err.message : "Failed to load swimmers",
                    "error",
                );
            } finally {
                if (!cancelled) setMembersLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const filteredMembers = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return members;
        return members.filter((m) =>
            getDisplayName(m).toLowerCase().includes(q),
        );
    }, [members, search]);

    const selectedMember = useMemo(
        () => members.find((m) => m.member_id === selectedMemberId) || null,
        [members, selectedMemberId],
    );

    const enrolledClassIds = useMemo(
        () => new Set(enrollments.map((e) => e.class_id)),
        [enrollments],
    );

    const enrollableClasses = useMemo(
        () => availableClasses.filter((c) => !enrolledClassIds.has(c.class_id)),
        [availableClasses, enrolledClassIds],
    );

    const groupsForAddClass = useMemo(() => {
        const cls = availableClasses.find((c) => c.class_id === addClassId);
        return cls ? cls.groups : [];
    }, [availableClasses, addClassId]);

    const loadEnrollments = async (memberId: string) => {
        setEnrollmentsLoading(true);
        try {
            const res = await authFetch(
                `/api/admin/members/${encodeURIComponent(memberId)}/enrollments`,
            );
            const payload = await res.json();
            if (!res.ok) throw new Error(payload?.error || "Failed to load enrollments");
            setEnrollments(payload.enrollments || []);
            setAvailableClasses(payload.availableClasses || []);
            setAddClassId("");
            setAddGroupId("");
        } catch (err) {
            showMessage(
                err instanceof Error ? err.message : "Failed to load enrollments",
                "error",
            );
            setEnrollments([]);
            setAvailableClasses([]);
        } finally {
            setEnrollmentsLoading(false);
        }
    };

    const selectMember = (memberId: string) => {
        setSelectedMemberId(memberId);
        void loadEnrollments(memberId);
    };

    const handleAdd = async () => {
        if (!selectedMemberId || !addClassId) return;
        setAdding(true);
        try {
            const res = await authFetch(
                `/api/admin/members/${encodeURIComponent(selectedMemberId)}/enrollments`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        class_id: addClassId,
                        group_id: addGroupId || null,
                    }),
                },
            );
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || "Failed to add enrollment");
            showMessage("Class added", "success");
            await loadEnrollments(selectedMemberId);
        } catch (err) {
            showMessage(
                err instanceof Error ? err.message : "Failed to add enrollment",
                "error",
            );
        } finally {
            setAdding(false);
        }
    };

    const handleRemove = async (classId: string) => {
        if (!selectedMemberId) return;
        const confirmRemoval = window.confirm(
            "Remove this swimmer from the class? Their evaluations and skill history will be preserved.",
        );
        if (!confirmRemoval) return;

        setPendingRemove((prev) => new Set(prev).add(classId));
        try {
            const res = await authFetch(
                `/api/admin/members/${encodeURIComponent(selectedMemberId)}/enrollments`,
                {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ class_id: classId }),
                },
            );
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload?.error || "Failed to remove enrollment");
            showMessage("Class removed", "success");
            setEnrollments((prev) => prev.filter((e) => e.class_id !== classId));
        } catch (err) {
            showMessage(
                err instanceof Error ? err.message : "Failed to remove enrollment",
                "error",
            );
        } finally {
            setPendingRemove((prev) => {
                const next = new Set(prev);
                next.delete(classId);
                return next;
            });
        }
    };

    return (
        <>
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

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                <div className="p-4 sm:p-6 border-b border-gray-100">
                    <h2 className="text-base sm:text-lg font-semibold text-gray-900">
                        Swimmer Class Enrollments
                    </h2>
                    <p className="mt-1 text-sm text-gray-500">
                        Pick a swimmer to view and update which classes they're enrolled
                        in.
                    </p>
                </div>

                <div className="p-4 sm:p-6 grid gap-4 sm:gap-6 sm:grid-cols-[300px_1fr]">
                    {/* Swimmer picker */}
                    <div className="space-y-3">
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search swimmers"
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        />
                        <div className="max-h-[420px] overflow-y-auto rounded-lg border border-gray-200">
                            {membersLoading ? (
                                <div className="p-3 text-sm text-gray-500">Loading…</div>
                            ) : filteredMembers.length === 0 ? (
                                <div className="p-3 text-sm text-gray-500">
                                    No swimmers found.
                                </div>
                            ) : (
                                <ul className="divide-y divide-gray-100">
                                    {filteredMembers.map((m) => {
                                        const isSelected = m.member_id === selectedMemberId;
                                        return (
                                            <li key={m.member_id}>
                                                <button
                                                    type="button"
                                                    onClick={() => selectMember(m.member_id)}
                                                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${isSelected ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-900"
                                                        }`}
                                                >
                                                    <span className="block truncate">
                                                        {getDisplayName(m)}
                                                    </span>
                                                    {m.is_active === false && (
                                                        <span className="text-[11px] text-red-600">
                                                            Inactive
                                                        </span>
                                                    )}
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    </div>

                    {/* Selected swimmer detail */}
                    <div className="space-y-4">
                        {!selectedMember ? (
                            <p className="text-sm text-gray-500">
                                Select a swimmer on the left to manage their classes.
                            </p>
                        ) : enrollmentsLoading ? (
                            <p className="text-sm text-gray-500">Loading enrollments…</p>
                        ) : (
                            <>
                                <div>
                                    <p className="text-base font-semibold text-gray-900">
                                        {getDisplayName(selectedMember)}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-sm font-medium text-gray-700 mb-2">
                                        Current classes
                                    </p>
                                    {enrollments.length === 0 ? (
                                        <p className="text-sm text-gray-500">
                                            Not enrolled in any classes.
                                        </p>
                                    ) : (
                                        <ul className="space-y-2">
                                            {enrollments.map((enr) => (
                                                <li
                                                    key={enr.class_id}
                                                    className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2"
                                                >
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-medium text-gray-900 truncate">
                                                            {enr.class_name}
                                                        </p>
                                                        <p className="text-xs text-gray-500 truncate">
                                                            {enr.group_name
                                                                ? `Group: ${enr.group_name}`
                                                                : "No group"}
                                                        </p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemove(enr.class_id)}
                                                        disabled={pendingRemove.has(enr.class_id)}
                                                        className="text-xs px-2.5 py-1 rounded-md border border-red-300 text-red-700 bg-white hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed"
                                                    >
                                                        {pendingRemove.has(enr.class_id) ? "Removing…" : "Remove"}
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>

                                <div className="border-t border-gray-100 pt-4">
                                    <p className="text-sm font-medium text-gray-700 mb-2">
                                        Add to class
                                    </p>
                                    {enrollableClasses.length === 0 ? (
                                        <p className="text-sm text-gray-500">
                                            This swimmer is enrolled in every class in the org.
                                        </p>
                                    ) : (
                                        <div className="space-y-2">
                                            <DropdownButton
                                                value={addClassId}
                                                onChange={(value) => {
                                                    setAddClassId(value);
                                                    setAddGroupId("");
                                                }}
                                                placeholder="Pick a class"
                                                ariaLabel="Pick a class to add"
                                                options={[
                                                    { value: "", label: "Pick a class" },
                                                    ...enrollableClasses.map((c) => ({
                                                        value: c.class_id,
                                                        label: `${c.name} — ${classScheduleSummary(c)}`,
                                                    })),
                                                ]}
                                            />
                                            {addClassId && groupsForAddClass.length > 0 && (
                                                <DropdownButton
                                                    value={addGroupId}
                                                    onChange={setAddGroupId}
                                                    placeholder="No specific group"
                                                    ariaLabel="Pick a class group (optional)"
                                                    options={[
                                                        { value: "", label: "No specific group" },
                                                        ...groupsForAddClass.map((g) => ({
                                                            value: g.group_id,
                                                            label: g.name,
                                                        })),
                                                    ]}
                                                />
                                            )}
                                            <button
                                                type="button"
                                                onClick={handleAdd}
                                                disabled={!addClassId || adding}
                                                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                                            >
                                                {adding ? "Adding…" : "Add to class"}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
