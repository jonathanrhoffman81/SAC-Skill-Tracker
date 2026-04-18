"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
    createAuthenticatedHeaders,
    getAuthenticatedSessionIdentity,
} from "@/lib/clientAuth";
import CertificatePage from "@/components/CertificateLayout";

interface SwimmerDetail {
    id: string;
    name: string;
    age: number | null;
    enrollmentDate: string;
    organization: string;
    isActive: boolean;
}

interface NoteItem {
    id: string;
    date: string;
    content: string;
    author: string;
}

interface ProgressHistoryItem {
    id: string;
    date: string;
    progress: number;
    dateAcquired?: string;
}

interface ClassHistorySkill {
    id: string;
    name: string;
    mastered: boolean;
    progress: number;
    dateAcquired?: string;
    obtainedInClass?: boolean;
    notes?: NoteItem[];
    progressHistory?: ProgressHistoryItem[];
}

interface ClassHistoryView {
    id: string;
    classId: string | null;
    name: string;
    schedule: string;
    startDate?: string;
    endDate?: string;
    startDateIso?: string;
    endDateIso?: string;
    isCurrent: boolean;
    isGeneral: boolean;
    skills: ClassHistorySkill[];
    classNotes: NoteItem[];
    summary: {
        progressPct: number;
        masteredCount: number;
        totalSkills: number;
        noteCount: number;
    };
}

interface SwimmerPayload {
    swimmer: SwimmerDetail;
    classHistories: ClassHistoryView[];
    defaultClassHistoryId: string;
    error?: string;
}

interface DashboardCachePayload {
    swimmers: Array<{
        id: string;
        name: string;
    }>;
    profilesBySwimmer?: Record<string, SwimmerPayload>;
}

const SWIMMER_PROFILE_CACHE_PREFIX = "account-swimmer-profile-cache:v4:";
const DASHBOARD_CACHE_PREFIX = "account-dashboard-cache:v4:";

function getInitials(name: string) {
    return name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
}

function getProgressBadgeClass(progress: number) {
    if (progress === 4) return "bg-emerald-100 text-emerald-700";
    if (progress === 3) return "bg-blue-100 text-blue-700";
    if (progress === 2) return "bg-amber-100 text-amber-700";
    if (progress === 1) return "bg-orange-100 text-orange-700";
    return "bg-gray-100 text-gray-600";
}

function getProgressStageLabel(progress: number) {
    if (progress === 4) return "Demonstrates complete understanding of the skill";
    if (progress === 3) return "Consistently demonstrates the skill";
    if (progress === 2) return "Inconsistently demonstrates the skill";
    if (progress === 1)
        return "Demonstrates the skill only with significant support";
    return "Unable to attempt the skill";
}

function getClassWindowLabel(classHistory: ClassHistoryView | null) {
    if (!classHistory) return "";
    if (classHistory.startDate && classHistory.endDate) {
        return `${classHistory.startDate} - ${classHistory.endDate}`;
    }
    if (classHistory.endDate) return `Through ${classHistory.endDate}`;
    if (classHistory.startDate) return `After ${classHistory.startDate}`;
    return classHistory.isGeneral ? "General history" : "Dates TBD";
}

function NoteCard({ note }: { note: NoteItem }) {
    return (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span>{note.author}</span>
                <span>{note.date}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">
                {note.content}
            </p>
        </div>
    );
}

function ClassNoteCard({ note }: { note: NoteItem }) {
    return (
        <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span>{note.author}</span>
                <span>{note.date}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">
                {note.content}
            </p>
        </div>
    );
}

function getClassDropdownLabel(classHistory: ClassHistoryView) {
    if (classHistory.isGeneral) return classHistory.name;
    const window = getClassWindowLabel(classHistory);
    const suffix = classHistory.isCurrent ? " · Current" : "";
    return window ? `${classHistory.name} · ${window}${suffix}` : classHistory.name;
}

type ClassGroup = { label: string; items: ClassHistoryView[] };

function groupClassHistories(
    classHistories: ClassHistoryView[],
    todayIso: string,
): ClassGroup[] {
    const active: ClassHistoryView[] = [];
    const upcoming: ClassHistoryView[] = [];
    const undated: ClassHistoryView[] = [];
    const general: ClassHistoryView[] = [];
    const pastByYear = new Map<string, ClassHistoryView[]>();

    classHistories.forEach((ch) => {
        if (ch.isGeneral) {
            general.push(ch);
            return;
        }
        if (ch.isCurrent) {
            active.push(ch);
            return;
        }
        if (ch.startDateIso && ch.startDateIso > todayIso) {
            upcoming.push(ch);
            return;
        }
        // Past or ended: group by year of end (fall back to start)
        const yearSource = ch.endDateIso ?? ch.startDateIso;
        if (!yearSource) {
            undated.push(ch);
            return;
        }
        const year = yearSource.slice(0, 4);
        const bucket = pastByYear.get(year) ?? [];
        bucket.push(ch);
        pastByYear.set(year, bucket);
    });

    const groups: ClassGroup[] = [];
    if (active.length) groups.push({ label: "Active", items: active });
    if (upcoming.length) groups.push({ label: "Upcoming", items: upcoming });
    // Past years, most recent year first
    Array.from(pastByYear.keys())
        .sort((a, b) => b.localeCompare(a))
        .forEach((year) => {
            groups.push({ label: year, items: pastByYear.get(year) ?? [] });
        });
    if (undated.length) groups.push({ label: "Undated", items: undated });
    if (general.length) groups.push({ label: "General", items: general });
    return groups;
}

export default function ParentSwimmerDetail() {
    const router = useRouter();
    const params = useParams();
    const swimmerId = params.id as string;

    const [swimmer, setSwimmer] = useState<SwimmerDetail | null>(null);
    const [classHistories, setClassHistories] = useState<ClassHistoryView[]>([]);
    const [selectedClassHistoryId, setSelectedClassHistoryId] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let isMounted = true;

        async function loadSwimmerData() {
            let hasCachedData = false;

            try {
                setIsLoading(true);
                setError("");
                const identity = await getAuthenticatedSessionIdentity();
                const profileCacheKey = `${SWIMMER_PROFILE_CACHE_PREFIX}${identity.authUserId}:${swimmerId}`;
                const cachedProfileRaw = sessionStorage.getItem(profileCacheKey);

                if (cachedProfileRaw) {
                    try {
                        const cachedPayload = JSON.parse(
                            cachedProfileRaw,
                        ) as SwimmerPayload;
                        if (isMounted && cachedPayload.swimmer) {
                            setSwimmer(cachedPayload.swimmer);
                            setClassHistories(cachedPayload.classHistories ?? []);
                            setSelectedClassHistoryId(
                                cachedPayload.defaultClassHistoryId ??
                                cachedPayload.classHistories?.[0]?.id ??
                                "",
                            );
                            hasCachedData = true;
                            setIsLoading(false);
                        }
                    } catch {
                        sessionStorage.removeItem(profileCacheKey);
                    }
                }

                if (!hasCachedData) {
                    const dashboardCacheKey = `${DASHBOARD_CACHE_PREFIX}${identity.authUserId}`;
                    const cachedDashboardRaw = sessionStorage.getItem(dashboardCacheKey);
                    if (cachedDashboardRaw) {
                        try {
                            const dashboardCache = JSON.parse(
                                cachedDashboardRaw,
                            ) as DashboardCachePayload;
                            const cachedProfile =
                                dashboardCache.profilesBySwimmer?.[swimmerId] ?? null;
                            if (isMounted && cachedProfile?.swimmer) {
                                setSwimmer(cachedProfile.swimmer);
                                setClassHistories(cachedProfile.classHistories ?? []);
                                setSelectedClassHistoryId(
                                    cachedProfile.defaultClassHistoryId ??
                                    cachedProfile.classHistories?.[0]?.id ??
                                    "",
                                );
                                sessionStorage.setItem(
                                    profileCacheKey,
                                    JSON.stringify(cachedProfile),
                                );
                                hasCachedData = true;
                                setIsLoading(false);
                            }

                            if (hasCachedData) return;

                            const cachedSwimmer = (dashboardCache.swimmers ?? []).find(
                                (item) => item.id === swimmerId,
                            );
                            if (isMounted && cachedSwimmer) {
                                setSwimmer({
                                    id: cachedSwimmer.id,
                                    name: cachedSwimmer.name,
                                    age: null,
                                    enrollmentDate: "",
                                    organization: "",
                                    isActive: true,
                                });
                                setClassHistories([]);
                                setSelectedClassHistoryId("");
                                hasCachedData = true;
                                setIsLoading(false);
                            }
                        } catch {
                            // Ignore malformed dashboard cache.
                        }
                    }
                }

                const headers = await createAuthenticatedHeaders();
                const response = await fetch(`/api/account/swimmers/${swimmerId}`, {
                    headers,
                });
                const payload = (await response.json()) as SwimmerPayload;

                if (!response.ok) {
                    throw new Error(payload.error || "Failed to load swimmer detail.");
                }

                if (!isMounted) return;

                setSwimmer(payload.swimmer ?? null);
                setClassHistories(payload.classHistories ?? []);
                setSelectedClassHistoryId(
                    payload.defaultClassHistoryId ?? payload.classHistories?.[0]?.id ?? "",
                );
                sessionStorage.setItem(profileCacheKey, JSON.stringify(payload));
            } catch (fetchError) {
                if (!isMounted) return;
                const message =
                    fetchError instanceof Error ? fetchError.message : "Unexpected error";
                if (!hasCachedData) {
                    setError(message);
                    setSwimmer(null);
                    setClassHistories([]);
                    setSelectedClassHistoryId("");
                }
            } finally {
                if (isMounted) setIsLoading(false);
            }
        }

        loadSwimmerData();
        return () => {
            isMounted = false;
        };
    }, [swimmerId]);

    const selectedClassHistory = useMemo(
        () =>
            classHistories.find((item) => item.id === selectedClassHistoryId) ??
            classHistories[0] ??
            null,
        [selectedClassHistoryId, classHistories],
    );

    const classHistoryGroups = useMemo(() => {
        const todayIso = new Date().toISOString().slice(0, 10);
        return groupClassHistories(classHistories, todayIso);
    }, [classHistories]);

    const masteredSkills = useMemo(() => {
        const map = new Map<
            string,
            { id: string; name: string; dateAcquired: string }
        >();
        classHistories.forEach((classHistory) => {
            classHistory.skills.forEach((skill) => {
                const done = skill.progress === 4 || Boolean(skill.dateAcquired);
                if (!done) return;
                const ex = map.get(skill.id);
                if (
                    !ex ||
                    (!ex.dateAcquired && skill.dateAcquired) ||
                    (ex.dateAcquired &&
                        skill.dateAcquired &&
                        new Date(skill.dateAcquired) < new Date(ex.dateAcquired))
                ) {
                    map.set(skill.id, {
                        id: skill.id,
                        name: skill.name,
                        dateAcquired: skill.dateAcquired ?? "",
                    });
                }
            });
        });
        return Array.from(map.values()).sort((a, b) =>
            a.name.localeCompare(b.name),
        );
    }, [classHistories]);

    const classSkills = selectedClassHistory?.skills ?? [];
    const classNotes = selectedClassHistory?.classNotes ?? [];
    const classSummary = selectedClassHistory?.summary ?? {
        progressPct: 0,
        masteredCount: 0,
        totalSkills: 0,
        noteCount: 0,
    };

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-gray-50">
                <div className="text-sm text-gray-600">Loading swimmer details...</div>
            </div>
        );
    }

    if (!isLoading && (error || !swimmer)) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
                <div className="max-w-lg text-center">
                    <p className="text-sm text-red-700">
                        {error || "Swimmer not found."}
                    </p>
                    <button
                        onClick={() => router.back()}
                        className="mt-4 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        Go Back
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
                <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => router.back()}
                            className="-ml-2 rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                        >
                            <svg
                                className="h-5 w-5"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M15 19l-7-7 7-7"
                                />
                            </svg>
                        </button>
                        <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-base font-semibold text-gray-700 sm:h-12 sm:w-12 sm:text-lg">
                                {getInitials(swimmer?.name ?? "Unknown")}
                            </div>
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h1 className="truncate text-lg font-semibold text-gray-900 sm:text-xl">
                                        {swimmer?.name}
                                    </h1>
                                    {swimmer && !swimmer.isActive && (
                                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                                            Inactive
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-gray-500">Parent View</p>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:space-y-6 sm:px-6 sm:py-8">
                {swimmer && !swimmer.isActive && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                        <p className="text-sm font-semibold text-amber-800">
                            This swimmer is inactive
                        </p>
                        <p className="mt-1 text-xs text-amber-700">
                            {swimmer.name || "This swimmer"} is no longer active. Past class
                            history, notes, and skill progress remain viewable below.
                        </p>
                    </div>
                )}

                <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <h3 className="text-sm font-semibold text-gray-900">
                            Swimmer Profile
                        </h3>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <div>
                            <p className="text-xs text-gray-500">Age</p>
                            <p className="text-sm text-gray-900">
                                {swimmer?.age ?? "Not available"}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500">Enrollment Date</p>
                            <p className="text-sm text-gray-900">
                                {swimmer?.enrollmentDate || "Not available"}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500">Class Progress</p>
                            <p className="text-sm font-semibold text-gray-900">
                                {classSummary.progressPct}%
                            </p>
                        </div>
                    </div>

                    <div className="mt-8">
                        <div className="mb-3 flex items-center justify-between">
                            <p className="text-xs font-semibold text-gray-500">
                                Skill Certificates
                            </p>
                            <p className="text-xs text-gray-400">Click a badge to download</p>
                        </div>
                        <CertificatePage
                            swimmerName={swimmer?.name ?? ""}
                            organization={swimmer?.organization ?? ""}
                            initialSkills={masteredSkills}
                        />
                    </div>
                </section>

                <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-gray-900">
                                Class History
                            </h3>
                        </div>
                        <div className="w-full lg:max-w-sm">
                            <label
                                htmlFor="class-history-select"
                                className="mb-1 block text-xs font-medium text-gray-700"
                            >
                                Select class
                            </label>
                            <select
                                id="class-history-select"
                                value={selectedClassHistory?.id ?? ""}
                                onChange={(e) => setSelectedClassHistoryId(e.target.value)}
                                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                {classHistoryGroups.map((group) => (
                                    <optgroup key={group.label} label={group.label}>
                                        {group.items.map((classHistory) => (
                                            <option key={classHistory.id} value={classHistory.id}>
                                                {getClassDropdownLabel(classHistory)}
                                            </option>
                                        ))}
                                    </optgroup>
                                ))}
                            </select>
                        </div>
                    </div>

                    {selectedClassHistory && (
                        <>
                            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-3">
                                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                                        Window
                                    </p>
                                    <p className="mt-1 text-sm text-gray-900">
                                        {getClassWindowLabel(selectedClassHistory)}
                                    </p>
                                </div>
                                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-3">
                                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                                        Skills Acquired
                                    </p>
                                    <p className="mt-1 text-sm font-semibold text-gray-900">
                                        {classSummary.masteredCount}/{classSummary.totalSkills}
                                    </p>
                                </div>
                                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-3">
                                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                                        Progress
                                    </p>
                                    <p className="mt-1 text-sm font-semibold text-gray-900">
                                        {classSummary.progressPct}%
                                    </p>
                                </div>
                                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-3">
                                    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                                        Notes
                                    </p>
                                    <p className="mt-1 text-sm font-semibold text-gray-900">
                                        {classSummary.noteCount}
                                    </p>
                                </div>
                            </div>

                            <div className="mt-5">
                                <div className="flex items-center justify-between gap-3">
                                    <h4 className="text-sm font-semibold text-gray-900">
                                        Class details
                                    </h4>
                                    {selectedClassHistory.isGeneral && (
                                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                                            General history
                                        </span>
                                    )}
                                </div>
                                <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-3">
                                    <p className="text-xs font-medium text-gray-900">
                                        {selectedClassHistory.name}
                                    </p>
                                    <p className="mt-1 text-[11px] text-gray-500">
                                        {selectedClassHistory.schedule}
                                    </p>
                                </div>
                            </div>
                        </>
                    )}
                </section>

                <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <h3 className="text-sm font-semibold text-gray-900">Skills</h3>
                        <div className="text-left sm:text-right">
                            <p className="text-xs text-gray-500">Selected class</p>
                            <p className="text-sm font-semibold text-gray-900">
                                {selectedClassHistory?.name ?? "No class selected"}
                            </p>
                        </div>
                    </div>

                    <div className="mt-5 space-y-4">
                        {classSkills.map((skill) => {
                            const skillNotes = skill.notes ?? [];
                            const progressHistory = skill.progressHistory ?? [];
                            return (
                                <article
                                    key={skill.id}
                                    className="rounded-xl border border-gray-200 bg-gray-50 p-4"
                                >
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="min-w-0">
                                            <p
                                                className={`text-sm font-medium ${skill.mastered ? "text-gray-900" : "text-gray-700"}`}
                                            >
                                                {skill.name}
                                            </p>
                                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                                <span
                                                    className={`rounded-full px-2 py-0.5 ${getProgressBadgeClass(skill.progress)}`}
                                                >
                                                    {skill.progress} —{" "}
                                                    {getProgressStageLabel(skill.progress)}
                                                </span>
                                                {skill.dateAcquired && (
                                                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
                                                        Obtained on {skill.dateAcquired}
                                                    </span>
                                                )}
                                                {skill.obtainedInClass && (
                                                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">
                                                        {selectedClassHistory?.isGeneral
                                                            ? "Obtained in general history"
                                                            : "Obtained in this class"}
                                                    </span>
                                                )}
                                            </div>
                                            <details className="group mt-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
                                                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-gray-700">
                                                    <span>
                                                        Progress history ({progressHistory.length})
                                                    </span>
                                                    <svg
                                                        className="h-4 w-4 flex-shrink-0 text-gray-500 transition-transform group-open:rotate-180"
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
                                                </summary>

                                                <div className="mt-3 space-y-2">
                                                    {progressHistory.length > 0 ? (
                                                        [...progressHistory].reverse().map((entry) => (
                                                            <div
                                                                key={entry.id}
                                                                className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-3"
                                                            >
                                                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                                                    <span
                                                                        className={`rounded-full px-2 py-0.5 ${getProgressBadgeClass(entry.progress)}`}
                                                                    >
                                                                        {entry.progress} -{" "}
                                                                        {getProgressStageLabel(entry.progress)}
                                                                    </span>
                                                                    <span className="text-gray-500">
                                                                        {entry.date}
                                                                    </span>
                                                                    {entry.dateAcquired && (
                                                                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
                                                                            Obtained on {entry.dateAcquired}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <p className="text-xs text-gray-500">
                                                            No progress changes recorded for this skill yet.
                                                        </p>
                                                    )}
                                                </div>
                                            </details>
                                        </div>
                                    </div>

                                    <div className="mt-4 rounded-lg border border-gray-100 bg-white px-4 py-3">
                                        <p className="text-xs font-semibold text-gray-700">
                                            Notes for this skill
                                        </p>
                                        <div className="mt-3 space-y-3">
                                            {skillNotes.length === 0 ? (
                                                <p className="text-sm text-gray-500">
                                                    No notes for this skill in the selected class.
                                                </p>
                                            ) : (
                                                <>
                                                    <NoteCard note={skillNotes[0]} />
                                                    {skillNotes.length > 1 && (
                                                        <details className="group">
                                                            <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-700">
                                                                <span className="group-open:hidden">
                                                                    Show {skillNotes.length - 1} older note
                                                                    {skillNotes.length - 1 === 1 ? "" : "s"}
                                                                </span>
                                                                <span className="hidden group-open:inline">
                                                                    Hide older notes
                                                                </span>
                                                                <svg
                                                                    className="h-3 w-3 flex-shrink-0 transform transition-transform group-open:rotate-180"
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
                                                            </summary>
                                                            <div className="mt-3 space-y-3">
                                                                {skillNotes.slice(1).map((entry) => (
                                                                    <NoteCard key={entry.id} note={entry} />
                                                                ))}
                                                            </div>
                                                        </details>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </article>
                            );
                        })}

                        {classSkills.length === 0 && (
                            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
                                No skills are available for this class yet.
                            </div>
                        )}
                    </div>
                </section>

                <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
                    <div>
                        <h4 className="text-sm font-semibold text-gray-900">
                            Class Notes
                        </h4>
                        <p className="mt-1 text-xs text-gray-500">
                            General notes recorded for the selected class.
                        </p>
                    </div>
                    <div className="mt-4 space-y-3">
                        {classNotes.length === 0 ? (
                            <p className="text-sm text-gray-500">
                                No general notes recorded for this class.
                            </p>
                        ) : (
                            <>
                                <ClassNoteCard note={classNotes[0]} />
                                {classNotes.length > 1 && (
                                    <details className="group">
                                        <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700">
                                            <span className="group-open:hidden">
                                                Show {classNotes.length - 1} older note
                                                {classNotes.length - 1 === 1 ? "" : "s"}
                                            </span>
                                            <span className="hidden group-open:inline">
                                                Hide older notes
                                            </span>
                                            <svg
                                                className="h-3 w-3 flex-shrink-0 transform transition-transform group-open:rotate-180"
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
                                        </summary>
                                        <div className="mt-3 space-y-3">
                                            {classNotes.slice(1).map((entry) => (
                                                <ClassNoteCard key={entry.id} note={entry} />
                                            ))}
                                        </div>
                                    </details>
                                )}
                            </>
                        )}
                    </div>
                </section>
            </main>
        </div>
    );
}
