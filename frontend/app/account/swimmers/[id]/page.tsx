"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
    authFetch,
    SessionExpiredError,
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
    headerAccentColor?: string | null;
}

const DEFAULT_HEADER_ACCENT_COLOR = "#ffffff";

function normalizeHexColor(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const hex = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
    if (![3, 6].includes(hex.length) || !/^[0-9a-fA-F]+$/.test(hex)) {
        return null;
    }
    if (hex.length === 3) {
        return `#${hex
            .split("")
            .map((char) => `${char}${char}`)
            .join("")
            .toUpperCase()}`;
    }
    return `#${hex.toUpperCase()}`;
}

function hexToRgba(hexColor: string, alpha: number) {
    const normalized = normalizeHexColor(hexColor);
    if (!normalized) return `rgba(255, 255, 255, ${alpha})`;
    const red = Number.parseInt(normalized.slice(1, 3), 16);
    const green = Number.parseInt(normalized.slice(3, 5), 16);
    const blue = Number.parseInt(normalized.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
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

/**
 * Unboxed note — indented with a subtle left border, no heavy card chrome.
 * Used for both per-skill notes and class-level notes so everything reads as
 * one visual hierarchy.
 */
function NoteLine({ note }: { note: NoteItem }) {
    return (
        <div className="border-l-2 border-gray-200 pl-3">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                <span className="font-medium text-gray-600">{note.author}</span>
                <span aria-hidden>·</span>
                <span>{note.date}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
                {note.content}
            </p>
        </div>
    );
}

/** Shared chevron for all collapse toggles on the page. */
function ChevronIcon({ className = "h-3 w-3" }: { className?: string }) {
    return (
        <svg
            className={`flex-shrink-0 transform transition-transform group-open:rotate-180 ${className}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
        >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
    );
}

function getClassDropdownLabel(classHistory: ClassHistoryView) {
    if (classHistory.isGeneral) return classHistory.name;
    // Dropdown shows the START date only (full window stays visible in the
    // "Window" stat below the selector).
    const startsLabel = classHistory.startDate
        ? `Starts ${classHistory.startDate}`
        : null;
    const suffix = classHistory.isCurrent ? " · Current" : "";
    return startsLabel
        ? `${classHistory.name} · ${startsLabel}${suffix}`
        : classHistory.name;
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

                const response = await authFetch(`/api/account/swimmers/${swimmerId}`);
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
                // Redirect already in-flight — don't render an error banner.
                if (fetchError instanceof SessionExpiredError) return;
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

    const resolvedHeaderAccentColor =
        normalizeHexColor(swimmer?.headerAccentColor || "") ?? DEFAULT_HEADER_ACCENT_COLOR;

    return (
        <div style={{ minHeight: "100vh", backgroundColor: resolvedHeaderAccentColor }}>
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
                    {/* Class selector */}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-gray-900">
                                Class activity
                            </h3>
                            {selectedClassHistory?.isGeneral && (
                                <span className="mt-1 inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                                    General history
                                </span>
                            )}
                        </div>
                        <div className="w-full sm:max-w-sm">
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
                            {/* Inline stats — no boxes, just separated text */}
                            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs">
                                <div>
                                    <dt className="text-gray-500">Window</dt>
                                    <dd className="mt-0.5 text-sm text-gray-900">
                                        {getClassWindowLabel(selectedClassHistory)}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-gray-500">Acquired</dt>
                                    <dd className="mt-0.5 text-sm font-semibold text-gray-900">
                                        {classSummary.masteredCount}/{classSummary.totalSkills}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-gray-500">Progress</dt>
                                    <dd className="mt-0.5 text-sm font-semibold text-gray-900">
                                        {classSummary.progressPct}%
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-gray-500">Notes</dt>
                                    <dd className="mt-0.5 text-sm font-semibold text-gray-900">
                                        {classSummary.noteCount}
                                    </dd>
                                </div>
                            </dl>

                            {/* Skills — flat divide-y list, no per-skill boxes */}
                            <div className="mt-6">
                                <h4 className="text-base font-semibold text-gray-900">
                                    Skills
                                </h4>
                                {classSkills.length === 0 ? (
                                    <p className="mt-3 text-sm text-gray-500">
                                        No skills are available for this class yet.
                                    </p>
                                ) : (
                                    <ul className="mt-2 divide-y divide-gray-100">
                                        {classSkills.map((skill) => {
                                            const skillNotes = skill.notes ?? [];
                                            const progressHistory = skill.progressHistory ?? [];
                                            return (
                                                <li key={skill.id} className="py-4">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <p
                                                            className={`text-sm font-medium ${skill.mastered ? "text-gray-900" : "text-gray-700"}`}
                                                        >
                                                            {skill.name}
                                                        </p>
                                                        <span
                                                            className={`rounded-full px-2 py-0.5 text-[11px] ${getProgressBadgeClass(skill.progress)}`}
                                                        >
                                                            {skill.progress} — {getProgressStageLabel(skill.progress)}
                                                        </span>
                                                        {skill.dateAcquired && (
                                                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                                                                Obtained on {skill.dateAcquired}
                                                            </span>
                                                        )}
                                                        {skill.obtainedInClass && (
                                                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                                                                {selectedClassHistory?.isGeneral
                                                                    ? "In general history"
                                                                    : "In this class"}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Notes — most recent inline; older collapse */}
                                                    {skillNotes.length > 0 && (
                                                        <div className="mt-3 space-y-2">
                                                            <NoteLine note={skillNotes[0]} />
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
                                                                        <ChevronIcon />
                                                                    </summary>
                                                                    <div className="mt-2 space-y-2">
                                                                        {skillNotes.slice(1).map((entry) => (
                                                                            <NoteLine key={entry.id} note={entry} />
                                                                        ))}
                                                                    </div>
                                                                </details>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Progress history — only shown when there are multiple entries */}
                                                    {progressHistory.length > 1 && (
                                                        <details className="group mt-3">
                                                            <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-medium text-gray-600 hover:text-gray-800">
                                                                <span>Progress history ({progressHistory.length})</span>
                                                                <ChevronIcon />
                                                            </summary>
                                                            <ul className="mt-2 space-y-1 border-l-2 border-gray-200 pl-3 text-[11px] text-gray-600">
                                                                {[...progressHistory].reverse().map((entry) => (
                                                                    <li
                                                                        key={entry.id}
                                                                        className="flex flex-wrap items-center gap-2"
                                                                    >
                                                                        <span
                                                                            className={`rounded-full px-1.5 py-0.5 ${getProgressBadgeClass(entry.progress)}`}
                                                                        >
                                                                            {entry.progress}
                                                                        </span>
                                                                        <span>{entry.date}</span>
                                                                        {entry.dateAcquired && (
                                                                            <span className="text-emerald-700">
                                                                                · Obtained {entry.dateAcquired}
                                                                            </span>
                                                                        )}
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </details>
                                                    )}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>

                            {/* Class notes — folded into this same card, not its own section */}
                            <div className="mt-6 border-t border-gray-100 pt-4">
                                <h4 className="text-base font-semibold text-gray-900">
                                    Class notes
                                </h4>
                                <p className="mt-1 text-[11px] text-gray-500">
                                    General notes recorded for the selected class.
                                </p>
                                <div className="mt-3 space-y-3">
                                    {classNotes.length === 0 ? (
                                        <p className="text-sm text-gray-500">
                                            No general notes recorded for this class.
                                        </p>
                                    ) : (
                                        <>
                                            <NoteLine note={classNotes[0]} />
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
                                                        <ChevronIcon />
                                                    </summary>
                                                    <div className="mt-3 space-y-3">
                                                        {classNotes.slice(1).map((entry) => (
                                                            <NoteLine key={entry.id} note={entry} />
                                                        ))}
                                                    </div>
                                                </details>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </section>
            </main>
        </div>
    );
}
