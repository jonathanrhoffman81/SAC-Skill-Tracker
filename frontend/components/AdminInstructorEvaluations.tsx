"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import EvaluationForm from "@/components/EvaluationForm";
import DropdownButton from "@/components/DropdownButton";
import { authFetch, getAuthenticatedSessionIdentity } from "@/lib/clientAuth";
import { getClassTagColors } from "@/lib/classColors";

interface DashboardClass {
    id: string;
    name: string;
    schedule: string;
    slot?: number | null;
    startDate?: string;
    endDate?: string;
}

interface DashboardSkill {
    id: string;
    name: string;
    progress: 0 | 1 | 2 | 3 | 4;
    hasProgressHistory?: boolean;
    mastered: boolean;
    dateAcquired?: string;
}

interface DashboardSwimmer {
    id: string;
    name: string;
    classes: DashboardClass[];
    skills: DashboardSkill[];
    isActive?: boolean;
    hasCurrentInstructorEvaluation?: boolean;
    classEvaluations?: Array<{
        classId: string;
        evaluationCount: number;
        generalNoteCount: number;
        skillNoteCount: number;
        lastEvaluationDate?: string;
        latestGeneralNote?: string;
        instructors: string[];
        recentEntries: Array<{
            evaluationId: string;
            date: string;
            instructor: string;
            skillName?: string;
            feedback?: string;
            isSkillNote: boolean;
        }>;
    }>;
    evaluationSummary: {
        evaluationCount: number;
        lastEvaluationDate?: string;
        instructors: string[];
    };
    skillSummary?: {
        totalSkills: number;
        masteredSkills: number;
        averageProficiency: number;
    };
    isMySwimmer?: boolean;
}

interface InitialEvaluationFilters {
    classes?: Array<{ value: string; label: string; startDate?: string; endDate?: string }>;
    instructors?: Array<{ value: string; label: string }>;
    groups?: Array<{ value: string; label: string; classId?: string }>;
    memberIdsByGroupId?: Record<string, string[]>;
    memberIdsByInstructorId?: Record<string, string[]>;
}

interface AdminInstructorEvaluationsProps {
    initialFilters?: InitialEvaluationFilters;
    initialListView?: "overview" | "active-classes" | "past-classes" | "recent-evals" | "my-swimmers" | "needs-evaluation";
    lockInitialListView?: boolean;
    initialStatusFilter?: "all" | "active" | "inactive";
    lockInitialStatusFilter?: boolean;
    initialInstructorFilter?: string;
    needsEvaluationScope?: "all" | "my-only" | "my-first";
    showNeedsEvaluationSection?: boolean;
    showProficiencyScaleSection?: boolean;
    restoreOpenSwimmerId?: boolean;
    scrollToTopAfterNeedsEvalSave?: boolean;
}

interface PaginationState {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
}

interface DashboardPayload {
    swimmers: DashboardSwimmer[];
    pagination?: PaginationState;
    error?: string;
}

interface AssignmentFiltersPayload {
    classes?: Array<{
        value: string;
        label: string;
        startDate?: string;
        endDate?: string;
    }>;
    groups?: Array<{
        group_id: string;
        class_id: string;
        class_name: string;
        group_name?: string;
    }>;
    instructors?: Array<{
        person_id?: string;
        value?: string;
        label?: string;
        first_name?: string | null;
        last_name?: string | null;
        email?: string;
    }>;
    assignments?: Array<{
        instructor_person_id: string;
        group_id: string;
    }>;
    enrollments?: Array<{
        member_id: string;
        class_id: string;
        group_id?: string | null;
        group_name?: string | null;
    }>;
}

const PAGE_SIZE = 10;
const VIRTUAL_ROW_HEIGHT = 184;
const VIRTUAL_OVERSCAN = 5;
const PERSISTED_STATE_KEY = "admin-instructor-evaluations-state";
const PERSISTED_DATA_KEY = "admin-instructor-evaluations-data";
const PERSISTED_STATE_TTL_MS = 15 * 60 * 1000;
const PERSISTED_STATE_VERSION = 8;

interface PersistedState {
    version: number;
    savedAt: number;
    scrollY: number;
    openSwimmerId: string | null;
    searchQuery: string;
    debouncedSearchQuery: string;
    classFilter: string;
    instructorFilter: string;
    groupFilter: string;
    statusFilter: "all" | "active" | "inactive";
    listView: "overview" | "active-classes" | "past-classes" | "recent-evals" | "my-swimmers" | "needs-evaluation";
    currentPage: number;
}

interface PersistedData {
    version: number;
    savedAt: number;
    searchKey: string;
    swimmers: DashboardSwimmer[];
    fallbackClassOptions: Array<{ value: string; label: string; startDate?: string; endDate?: string }>;
    fallbackInstructorOptions: Array<{ value: string; label: string }>;
    fallbackGroupOptions: Array<{ value: string; label: string }>;
    memberIdsByGroupId: Record<string, string[]>;
    memberIdsByInstructorId?: Record<string, string[]>;
}

const CLASS_FILTER_RECENT_DAYS = 7;

function buildScopedStorageKey(baseKey: string, scopeKey: string) {
    return `${baseKey}:${scopeKey}`;
}

function readPersistedState(storageKey: string): PersistedState | null {
    if (typeof window === "undefined") return null;

    try {
        const raw = window.sessionStorage.getItem(storageKey);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as PersistedState;
        if (!parsed?.savedAt) return null;
        if (parsed.version !== PERSISTED_STATE_VERSION) {
            window.sessionStorage.removeItem(storageKey);
            return null;
        }

        if (Date.now() - parsed.savedAt > PERSISTED_STATE_TTL_MS) {
            window.sessionStorage.removeItem(storageKey);
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}

function readPersistedData(storageKey: string): PersistedData | null {
    if (typeof window === "undefined") return null;

    try {
        const raw = window.sessionStorage.getItem(storageKey);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as PersistedData;
        if (!parsed?.savedAt) return null;
        if (parsed.version !== PERSISTED_STATE_VERSION) {
            window.sessionStorage.removeItem(storageKey);
            return null;
        }

        if (Date.now() - parsed.savedAt > PERSISTED_STATE_TTL_MS) {
            window.sessionStorage.removeItem(storageKey);
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}

function calculateAverageProficiency(skills: DashboardSkill[]): string {
    if (skills.length === 0) return "0";

    const proficiencyToPercentage = (level: 0 | 1 | 2 | 3 | 4): number => {
        const mapping: Record<number, number> = {
            0: 0,
            1: 25,
            2: 50,
            3: 75,
            4: 100,
        };
        return mapping[level];
    };

    const totalPercentage = skills.reduce(
        (sum, skill) => sum + proficiencyToPercentage(skill.progress),
        0,
    );
    return Math.round(totalPercentage / skills.length).toString();
}

function getInitials(name: string) {
    return name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
}

function formatEmailToName(email?: string | null) {
    if (!email) return undefined;
    const local = String(email).split("@")[0];
    const words = local.replace(/[._\-]+/g, " ").split(" ").filter(Boolean);
    if (words.length === 0) return undefined;
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

function formatDateForSummary(date: Date): string {
    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

function formatDateLabel(dateValue?: string) {
    const parsed = toDateAtMidnight(dateValue);
    if (!parsed) return "soon";
    return formatDateForSummary(parsed);
}

function getClassWindowLabel(classItem: DashboardClass) {
    if (classItem.startDate && classItem.endDate) {
        return `${formatDateLabel(classItem.startDate)} - ${formatDateLabel(classItem.endDate)}`;
    }
    if (classItem.endDate) return `Through ${formatDateLabel(classItem.endDate)}`;
    if (classItem.startDate) return `After ${formatDateLabel(classItem.startDate)}`;
    return "Dates TBD";
}

function truncateNotePreview(note?: string, maxLength = 140) {
    if (!note) return "";
    return note.length > maxLength ? `${note.slice(0, maxLength).trim()}...` : note;
}

function formatSavedDateLabel(dateValue: string) {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
        ? new Date(
            Number(dateValue.slice(0, 4)),
            Number(dateValue.slice(5, 7)) - 1,
            Number(dateValue.slice(8, 10)),
        )
        : new Date(dateValue);
    if (Number.isNaN(parsed.getTime())) {
        return dateValue;
    }

    return parsed.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

function hasUsableEvaluationId(value?: string) {
    return Boolean(value && value !== "undefined" && value !== "null");
}

function sanitizePersistedSwimmers(swimmers: DashboardSwimmer[]): DashboardSwimmer[] {
    return swimmers.map((swimmer) => ({
        ...swimmer,
        classEvaluations: (swimmer.classEvaluations ?? []).map((classSummary) => ({
            ...classSummary,
            recentEntries: (classSummary.recentEntries ?? []).filter((entry) =>
                hasUsableEvaluationId(entry.evaluationId),
            ),
        })),
    }));
}

function progressToPercent(progress: 0 | 1 | 2 | 3 | 4) {
    const mapping: Record<number, number> = {
        0: 0,
        1: 25,
        2: 50,
        3: 75,
        4: 100,
    };

    return mapping[progress] ?? 0;
}

function toDateAtMidnight(dateValue?: string) {
    if (!dateValue) return null;

    const normalized = dateValue.includes("T") ? dateValue.slice(0, 10) : dateValue;
    const parsed = new Date(`${normalized}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    parsed.setHours(0, 0, 0, 0);
    return parsed;
}

function isClassCurrentOrRecent(startDate?: string, endDate?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const recentCutoff = new Date(today);
    recentCutoff.setDate(recentCutoff.getDate() - CLASS_FILTER_RECENT_DAYS);

    const start = toDateAtMidnight(startDate);
    const end = toDateAtMidnight(endDate);

    //const isActive = (!start || start <= today) && (!end || end >= today);
    //include all future classes
    const isActive = (!end || end >= today);
    
    const endedRecently = Boolean(end && end < today && end >= recentCutoff);

    return isActive || endedRecently;
}

//status filter should apply to member status only 
function matchesClassStatusFilter(
    classItem: DashboardClass,
    statusFilter: "all" | "active" | "inactive",
) {
    if (statusFilter === "all") return true;

    const isCurrentOrRecent = isClassCurrentOrRecent(classItem.startDate, classItem.endDate);

    //return statusFilter === "active" ? isCurrentOrRecent : !isCurrentOrRecent;
    return isCurrentOrRecent;
}

function buildCacheKey(page: number, search: string) {
    return search.toLowerCase();
}

function buildSearchCacheKey(search: string) {
    return search.toLowerCase();
}

export default function AdminInstructorEvaluations({
    initialFilters,
    initialListView = "active-classes",
    lockInitialListView = false,
    initialStatusFilter = "active",
    lockInitialStatusFilter = false,
    initialInstructorFilter,
    needsEvaluationScope = "my-first",
    showNeedsEvaluationSection = false,
    showProficiencyScaleSection = false,
    restoreOpenSwimmerId = true,
    scrollToTopAfterNeedsEvalSave = false,
}: AdminInstructorEvaluationsProps) {
    const router = useRouter();
    const [openSwimmerId, setOpenSwimmerId] = useState<string | null>(null);
    const [needsEvalOpenSwimmerIds, setNeedsEvalOpenSwimmerIds] = useState<Set<string>>(new Set());

    // Find which paginated page a swimmer's row lives on in the main list,
    // so that clicking them from the small "Needs Evaluation" preview card
    // jumps to the right page instead of leaving them hidden several pages
    // down. Returns null if the swimmer isn't in the visible list at all.
    const findSwimmerPage = (
        swimmerId: string,
        list: { id: string }[],
    ): number | null => {
        const index = list.findIndex((item) => item.id === swimmerId);
        if (index < 0) return null;
        return Math.floor(index / PAGE_SIZE) + 1;
    };

    // Pop the swimmer out of the "opened from needs-eval" set, and if it was
    // there (and the parent enabled the behavior), scroll the page to the top.
    // Used by both Save and Close so closing without saving still returns the
    // user to the list head. The scroll is deferred past the next layout pass
    // because closing the form removes a tall section, and a synchronous
    // smooth-scroll started before that reflow gets fought by the browser's
    // scroll-anchoring (which is why the earlier inline version "worked" only
    // for save and not for close).
    const consumeNeedsEvalSwimmer = (swimmerId: string) => {
        const wasFromNeedsEval = needsEvalOpenSwimmerIds.has(swimmerId);
        if (wasFromNeedsEval) {
            setNeedsEvalOpenSwimmerIds((prev) => {
                if (!prev.has(swimmerId)) return prev;
                const next = new Set(prev);
                next.delete(swimmerId);
                return next;
            });
        }
        if (wasFromNeedsEval && scrollToTopAfterNeedsEvalSave) {
            // Two rAFs ≈ "after the next React commit's paint." That lets the
            // form-collapse layout settle before we kick off the smooth scroll.
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    window.scrollTo({ top: 0, behavior: "smooth" });
                });
            });
        }
    };

    const [dirtyEvaluationFormBySwimmer, setDirtyEvaluationFormBySwimmer] = useState<Record<string, boolean>>({});

    const setEvaluationFormDirty = (swimmerId: string, isDirty: boolean) => {
        setDirtyEvaluationFormBySwimmer((prev) => {
            if (Boolean(prev[swimmerId]) === isDirty) return prev;
            return { ...prev, [swimmerId]: isDirty };
        });
    };

    // If the form has unsaved changes, ask the user before discarding them.
    // Returns true when the caller should proceed with closing.
    const confirmDiscardEvaluation = (swimmerId: string): boolean => {
        if (!dirtyEvaluationFormBySwimmer[swimmerId]) return true;
        const ok = window.confirm(
            "You have unsaved changes in this evaluation. Close without saving?",
        );
        if (ok) {
            setEvaluationFormDirty(swimmerId, false);
        }
        return ok;
    };

    const [searchQuery, setSearchQuery] = useState("");
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
    const [isFiltersOpen, setIsFiltersOpen] = useState(false);
    const [classFilter, setClassFilter] = useState("all");
    const [instructorFilter, setInstructorFilter] = useState(initialInstructorFilter ?? "all");
    const [groupFilter, setGroupFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">(initialStatusFilter);
    const [listView, setListView] = useState<"overview" | "active-classes" | "past-classes" | "recent-evals" | "my-swimmers" | "needs-evaluation">(initialListView);
    const [swimmers, setSwimmers] = useState<DashboardSwimmer[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageInput, setPageInput] = useState("1");
    const [activeEvaluationClassIdBySwimmer, setActiveEvaluationClassIdBySwimmer] = useState<Record<string, string | null>>({});
    const [editingEvaluationBySwimmer, setEditingEvaluationBySwimmer] = useState<Record<string, {
        evaluationId: string;
        classId: string;
        isSkillNote: boolean;
        skillId?: string;
        feedback?: string;
    } | null>>({});
    const [viewingEvaluationBySwimmer, setViewingEvaluationBySwimmer] = useState<Record<string, {
        evaluationId: string;
        classId: string;
        isSkillNote: boolean;
        skillId?: string;
        feedback?: string;
    } | null>>({});
    const [historyActionErrorBySwimmer, setHistoryActionErrorBySwimmer] = useState<Record<string, string>>({});
    const [deletingEvaluationKey, setDeletingEvaluationKey] = useState<string | null>(null);
    const [actionBanner, setActionBanner] = useState<{
        type: "success" | "error";
        message: string;
    } | null>(null);
    const [deleteDialog, setDeleteDialog] = useState<{
        show: boolean;
        swimmerId: string | null;
        classId: string | null;
        evaluationId: string | null;
        swimmerName: string;
        className: string;
    }>({
        show: false,
        swimmerId: null,
        classId: null,
        evaluationId: null,
        swimmerName: "",
        className: "",
    });
    const [pagination, setPagination] = useState<PaginationState>(
        {
            page: 1,
            pageSize: PAGE_SIZE,
            total: 0,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: false,
        },
    );
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");
    const [fallbackClassOptions, setFallbackClassOptions] = useState<Array<{ value: string; label: string; startDate?: string; endDate?: string }>>(() =>
        initialFilters?.classes ?? [],
    );
    const [fallbackInstructorOptions, setFallbackInstructorOptions] = useState<Array<{ value: string; label: string }>>(() =>
        initialFilters?.instructors ?? [],
    );
    const [fallbackGroupOptions, setFallbackGroupOptions] = useState<Array<{ value: string; label: string }>>(() =>
        (initialFilters?.groups ?? []).map((group) => ({
            value: group.value,
            label: group.label,
        })),
    );
    const [groupClassMap, setGroupClassMap] = useState<Map<string, string>>(() => {
        const map = new Map<string, string>();
        (initialFilters?.groups ?? []).forEach((group) => {
            if (group.value && group.classId) map.set(group.value, group.classId);
        });
        return map;
    });
    const [memberIdsByGroupId, setMemberIdsByGroupId] = useState<Record<string, Set<string>>>(() =>
        Object.fromEntries(
            Object.entries(initialFilters?.memberIdsByGroupId ?? {}).map(([groupId, memberIds]) => [
                groupId,
                new Set(memberIds),
            ]),
        ) as Record<string, Set<string>>,
    );
    const [memberIdsByInstructorId, setMemberIdsByInstructorId] = useState<Record<string, Set<string>>>(() =>
        Object.fromEntries(
            Object.entries(initialFilters?.memberIdsByInstructorId ?? {}).map(([instructorId, memberIds]) => [
                instructorId,
                new Set(memberIds),
            ]),
        ) as Record<string, Set<string>>,
    );
    const [storageScopeKey, setStorageScopeKey] = useState<string | null>(null);
    const [hasRestoredState, setHasRestoredState] = useState(false);
    const cacheRef = useRef<Map<string, { swimmers: DashboardSwimmer[]; pagination: PaginationState }>>(new Map());
    const allSearchCacheRef = useRef<Map<string, DashboardSwimmer[]>>(new Map());
    const inflightRef = useRef<
        Map<string, Promise<{ swimmers: DashboardSwimmer[]; pagination: PaginationState }>>
    >(new Map());
    const swimmerRowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
    const skipInitialPersistRef = useRef(true);
    const pendingRestoredScrollYRef = useRef<number | null>(null);
    const suppressAutoFocusRef = useRef(false);
    const pendingScrollToSwimmerRef = useRef<string | null>(null);
    const virtualListContainerRef = useRef<HTMLDivElement | null>(null);
    const [virtualScrollTop, setVirtualScrollTop] = useState(0);
    const [virtualContainerHeight, setVirtualContainerHeight] = useState(720);

    const showActionBanner = (type: "success" | "error", message: string) => {
        setActionBanner({ type, message });
        if (typeof window !== "undefined") {
            window.setTimeout(() => {
                setActionBanner((current) => (current?.message === message ? null : current));
            }, 5000);
        }
    };

    const syncVirtualContainerHeight = () => {
        const element = virtualListContainerRef.current;
        if (!element) return;

        setVirtualContainerHeight(element.clientHeight || 720);
    };

    useEffect(() => {
        if (!initialFilters) return;

        setFallbackClassOptions((prev) => prev.length > 0 ? prev : (initialFilters.classes ?? []));
        setFallbackInstructorOptions((prev) => prev.length > 0 ? prev : (initialFilters.instructors ?? []));
        setFallbackGroupOptions((prev) => {
            if (prev.length > 0) return prev;
            return (initialFilters.groups ?? []).map((group) => ({
                value: group.value,
                label: group.label,
            }));
        });
        setMemberIdsByGroupId((prev) => {
            if (Object.keys(prev).length > 0) return prev;

            return Object.fromEntries(
                Object.entries(initialFilters.memberIdsByGroupId ?? {}).map(([groupId, memberIds]) => [
                    groupId,
                    new Set(memberIds),
                ]),
            ) as Record<string, Set<string>>;
        });
        setMemberIdsByInstructorId((prev) => {
            if (Object.keys(prev).length > 0) return prev;

            return Object.fromEntries(
                Object.entries(initialFilters.memberIdsByInstructorId ?? {}).map(([instructorId, memberIds]) => [
                    instructorId,
                    new Set(memberIds),
                ]),
            ) as Record<string, Set<string>>;
        });
    }, [initialFilters]);

    function persistDataCache(searchKey: string) {
        if (typeof window === "undefined") return;
        if (!storageScopeKey) return;

        try {
            const serializedMemberIdsByGroupId = Object.fromEntries(
                Object.entries(memberIdsByGroupId).map(([groupId, memberIds]) => [
                    groupId,
                    Array.from(memberIds),
                ]),
            );
            const serializedMemberIdsByInstructorId = Object.fromEntries(
                Object.entries(memberIdsByInstructorId).map(([instructorId, memberIds]) => [
                    instructorId,
                    Array.from(memberIds),
                ]),
            );

            const payload: PersistedData = {
                version: PERSISTED_STATE_VERSION,
                savedAt: Date.now(),
                searchKey,
                swimmers,
                fallbackClassOptions,
                fallbackInstructorOptions,
                fallbackGroupOptions,
                memberIdsByGroupId: serializedMemberIdsByGroupId,
                memberIdsByInstructorId: serializedMemberIdsByInstructorId,
            };

            window.sessionStorage.setItem(
                buildScopedStorageKey(PERSISTED_DATA_KEY, storageScopeKey),
                JSON.stringify(payload),
            );
        } catch {
            window.sessionStorage.removeItem(
                buildScopedStorageKey(PERSISTED_DATA_KEY, storageScopeKey),
            );
        }
    }

    function persistState(scrollYOverride?: number) {
        if (typeof window === "undefined") return;
        if (!storageScopeKey) return;

        try {
            const stateToPersist: PersistedState = {
                version: PERSISTED_STATE_VERSION,
                savedAt: Date.now(),
                scrollY: typeof scrollYOverride === "number" ? scrollYOverride : window.scrollY,
                openSwimmerId,
                searchQuery,
                debouncedSearchQuery,
                classFilter,
                instructorFilter,
                groupFilter,
                statusFilter,
                listView,
                currentPage,
            };

            window.sessionStorage.setItem(
                buildScopedStorageKey(PERSISTED_STATE_KEY, storageScopeKey),
                JSON.stringify(stateToPersist),
            );
        } catch {
            window.sessionStorage.removeItem(
                buildScopedStorageKey(PERSISTED_STATE_KEY, storageScopeKey),
            );
        }
    }

    async function fetchPageData(
        page: number,
        search: string,
    ): Promise<{ swimmers: DashboardSwimmer[]; pagination: PaginationState }> {
        const cacheKey = buildCacheKey(page, search);
        const cached = cacheRef.current.get(cacheKey);
        if (cached) return cached;

        const inFlight = inflightRef.current.get(cacheKey);
        if (inFlight) return inFlight;

        const requestPromise = (async () => {
            const params = new URLSearchParams();
            if (search) {
                params.set("q", search);
            }
            params.set("all", "1");

            const response = await authFetch(`/api/instructor/all-swimmers?${params.toString()}`);
            const payload = (await response.json()) as DashboardPayload;

            if (!response.ok) {
                throw new Error(payload.error || "Failed to load evaluations.");
            }

            const resolvedSwimmers = (payload.swimmers ?? []).map((swimmer) => ({
                ...swimmer,
                classes: (swimmer.classes ?? []).map((classItem) => ({
                    ...classItem,
                    startDate: classItem.startDate,
                    endDate: classItem.endDate,
                })),
                evaluationSummary: swimmer.evaluationSummary ?? {
                    evaluationCount: 0,
                    lastEvaluationDate: undefined,
                    instructors: [],
                },
            }));

            const resolvedPagination = payload.pagination ?? {
                page: 1,
                pageSize: PAGE_SIZE,
                total: resolvedSwimmers.length,
                totalPages: 1,
                hasNextPage: false,
                hasPreviousPage: false,
            };

            const resolved = {
                swimmers: resolvedSwimmers,
                pagination: resolvedPagination,
            };

            cacheRef.current.set(cacheKey, resolved);
            return resolved;
        })();

        inflightRef.current.set(cacheKey, requestPromise);
        try {
            return await requestPromise;
        } finally {
            inflightRef.current.delete(cacheKey);
        }
    }

    async function loadFilterOptionsFromAssignments() {
        try {
            const endpointCandidates = [
                "/api/admin/instructor-member-assignments",
                "/api/instructor/filters",
            ];

            let payload: (AssignmentFiltersPayload & { error?: string }) | null = null;
            let lastErrorMessage = "Failed to load class/instructor filter options.";

            for (const endpoint of endpointCandidates) {
                const response = await authFetch(endpoint);
                const responsePayload = (await response.json()) as AssignmentFiltersPayload & { error?: string };

                if (response.ok) {
                    payload = responsePayload;
                    break;
                }

                lastErrorMessage = responsePayload.error || lastErrorMessage;
            }

            if (!payload) {
                throw new Error(lastErrorMessage);
            }

            const classMap = new Map<string, string>();
            const groupMap = new Map<string, string>();
            const newGroupClassMap = new Map<string, string>();
            const enrollmentMap: Record<string, Set<string>> = {};
            const instructorMemberMap: Record<string, Set<string>> = {};
            (payload.classes ?? []).forEach((classOption) => {
                if (!classOption.value) return;
                classMap.set(classOption.value, classOption.label || "Unnamed class");
            });

            (payload.groups ?? []).forEach((group) => {
                if (!group.class_id) return;
                if (!classMap.has(group.class_id)) {
                    classMap.set(group.class_id, group.class_name || "Unnamed class");
                }
                if (group.group_id && !groupMap.has(group.group_id)) {
                    groupMap.set(group.group_id, group.group_name || group.class_name || "Unnamed group");
                    newGroupClassMap.set(group.group_id, group.class_id);
                }
            });

            (payload.enrollments ?? []).forEach((enrollment) => {
                const groupId = enrollment.group_id;
                if (!groupId) return;

                if (!enrollmentMap[groupId]) {
                    enrollmentMap[groupId] = new Set<string>();
                }

                enrollmentMap[groupId].add(enrollment.member_id);

                if (!groupMap.has(groupId)) {
                    groupMap.set(groupId, enrollment.group_name || "Unnamed group");
                    if (enrollment.class_id) newGroupClassMap.set(groupId, enrollment.class_id);
                }
            });

            (payload.assignments ?? []).forEach((assignment) => {
                const instructorId = assignment.instructor_person_id;
                const groupId = assignment.group_id;
                if (!instructorId || !groupId) return;

                const memberIds = enrollmentMap[groupId];
                if (!memberIds) return;

                if (!instructorMemberMap[instructorId]) {
                    instructorMemberMap[instructorId] = new Set<string>();
                }

                memberIds.forEach((memberId) => {
                    instructorMemberMap[instructorId].add(memberId);
                });
            });

            const instructorOptions = (payload.instructors ?? [])
                .map((instructor) => {
                    const value = instructor.person_id || instructor.value;
                    if (!value) return null;
                    const fullName = `${instructor.first_name ?? ""} ${instructor.last_name ?? ""}`.trim();
                    const label = fullName || instructor.label || formatEmailToName(instructor.email) || instructor.email || "Instructor";
                    return { value, label: label.trim() };
                })
                .filter((option): option is { value: string; label: string } => Boolean(option?.value));

            setFallbackClassOptions(
                Array.from(classMap.entries())
                    .map(([value, label]) => ({ value, label }))
                    .sort((a, b) => a.label.localeCompare(b.label)),
            );

            setFallbackInstructorOptions(
                instructorOptions.sort((a, b) => a.label.localeCompare(b.label)),
            );

            setFallbackGroupOptions(
                Array.from(groupMap.entries())
                    .map(([value, label]) => ({ value, label }))
                    .sort((a, b) => a.label.localeCompare(b.label)),
            );
            setGroupClassMap(newGroupClassMap);

            setMemberIdsByGroupId(enrollmentMap);
            setMemberIdsByInstructorId(instructorMemberMap);
        } catch {
            // Keep any bootstrap-loaded options instead of wiping filters when a refresh endpoint fails.
        }
    }

    async function loadData(
        page?: number,
        search?: string,
        options?: { forceRefresh?: boolean },
    ) {
        const activePage = page || currentPage;
        const activeSearch = search ?? debouncedSearchQuery;
        const cacheKey = buildCacheKey(activePage, activeSearch);
        const searchCacheKey = buildSearchCacheKey(activeSearch);

        if (options?.forceRefresh) {
            cacheRef.current.delete(cacheKey);
            allSearchCacheRef.current.delete(searchCacheKey);
            if (typeof window !== "undefined" && storageScopeKey) {
                window.sessionStorage.removeItem(
                    buildScopedStorageKey(PERSISTED_DATA_KEY, storageScopeKey),
                );
            }
        }

        if (!options?.forceRefresh) {
            const cachedAll = allSearchCacheRef.current.get(searchCacheKey);
            const shouldUseCachedAll =
                Boolean(cachedAll) &&
                ((cachedAll?.length ?? 0) > 0 || activeSearch.length > 0);

            if (shouldUseCachedAll && cachedAll) {
                setError("");
                setSwimmers(cachedAll);
                setIsLoading(false);
                return;
            }
        }

        try {
            setIsLoading(true);
            setError("");

            const allSwimmersResponse = await fetchPageData(1, activeSearch);
            const allSwimmers = allSwimmersResponse.swimmers;

            setSwimmers(allSwimmers);
            allSearchCacheRef.current.set(searchCacheKey, allSwimmers);
        } catch (fetchError) {
            const message =
                fetchError instanceof Error
                    ? fetchError.message
                    : "Unexpected error loading evaluations.";
            setError(message);
            setSwimmers([]);
            setPagination({
                page: 1,
                pageSize: PAGE_SIZE,
                total: 0,
                totalPages: 1,
                hasNextPage: false,
                hasPreviousPage: false,
            });
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        let isMounted = true;

        async function resolveStorageScopeKey() {
            if (typeof window === "undefined") return;

            const pathScope = window.location.pathname;

            try {
                const identity = await getAuthenticatedSessionIdentity();
                if (!isMounted) return;
                setStorageScopeKey(`${identity.authUserId}:${pathScope}`);
            } catch {
                if (!isMounted) return;
                setStorageScopeKey(`anonymous:${pathScope}`);
            }
        }

        void resolveStorageScopeKey();

        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        if (!storageScopeKey) return;

        const persistedStateKey = buildScopedStorageKey(PERSISTED_STATE_KEY, storageScopeKey);
        const persistedDataKey = buildScopedStorageKey(PERSISTED_DATA_KEY, storageScopeKey);
        const restoredState = readPersistedState(persistedStateKey);
        const restoredData = readPersistedData(persistedDataKey);

        if (restoredState) {
            setOpenSwimmerId(restoreOpenSwimmerId ? restoredState.openSwimmerId : null);
            setSearchQuery(restoredState.searchQuery);
            setDebouncedSearchQuery(restoredState.debouncedSearchQuery);
            setClassFilter(restoredState.classFilter ?? "all");
            setInstructorFilter(restoredState.instructorFilter ?? initialInstructorFilter ?? "all");
            setGroupFilter(restoredState.groupFilter ?? "all");
            setStatusFilter(lockInitialStatusFilter ? initialStatusFilter : (restoredState.statusFilter ?? initialStatusFilter));
            setListView(lockInitialListView ? initialListView : (restoredState.listView ?? initialListView));
            setCurrentPage(restoredState.currentPage || 1);

            if (typeof restoredState.scrollY === "number" && restoredState.scrollY > 0) {
                pendingRestoredScrollYRef.current = restoredState.scrollY;
                suppressAutoFocusRef.current = true;
            }
        }
        if (!restoredState && initialInstructorFilter) {
            setInstructorFilter(initialInstructorFilter);
        }

        if (restoredData) {
            const sanitizedSwimmers = sanitizePersistedSwimmers(restoredData.swimmers ?? []);

            setSwimmers(sanitizedSwimmers);
            setFallbackClassOptions(restoredData.fallbackClassOptions ?? []);
            setFallbackInstructorOptions(restoredData.fallbackInstructorOptions ?? []);
            setFallbackGroupOptions(restoredData.fallbackGroupOptions ?? []);

            const hydratedMemberIdsByGroupId = Object.fromEntries(
                Object.entries(restoredData.memberIdsByGroupId ?? {}).map(([groupId, memberIds]) => [
                    groupId,
                    new Set(memberIds),
                ]),
            ) as Record<string, Set<string>>;
            const hydratedMemberIdsByInstructorId = Object.fromEntries(
                Object.entries(restoredData.memberIdsByInstructorId ?? {}).map(([instructorId, memberIds]) => [
                    instructorId,
                    new Set(memberIds),
                ]),
            ) as Record<string, Set<string>>;

            setMemberIdsByGroupId(hydratedMemberIdsByGroupId);
            setMemberIdsByInstructorId(hydratedMemberIdsByInstructorId);
            setIsLoading(false);
        }

        setHasRestoredState(true);
    }, [initialInstructorFilter, initialListView, initialStatusFilter, lockInitialListView, lockInitialStatusFilter, restoreOpenSwimmerId, storageScopeKey]);

    useEffect(() => {
        if (!openSwimmerId) return;
        if (suppressAutoFocusRef.current) return;

        const targetRow = swimmerRowRefs.current[openSwimmerId];
        if (!targetRow) return;

        requestAnimationFrame(() => {
            targetRow.focus({ preventScroll: true });
            targetRow.scrollIntoView({ block: "nearest", behavior: "auto" });
        });
    }, [openSwimmerId, swimmers, listView]);

    // After a needs-eval click expands a swimmer card + opens the eval form,
    // scroll smoothly to the card so the form is visible.
    useEffect(() => {
        const swimmerId = pendingScrollToSwimmerRef.current;
        if (!swimmerId) return;

        const targetRow = swimmerRowRefs.current[swimmerId];
        if (!targetRow) return;

        pendingScrollToSwimmerRef.current = null;
        setTimeout(() => {
            targetRow.scrollIntoView({ block: "start", behavior: "smooth" });
        }, 50);
    }, [activeEvaluationClassIdBySwimmer]);

    useEffect(() => {
        const restoredScrollY = pendingRestoredScrollYRef.current;
        if (restoredScrollY === null) return;
        if (!hasRestoredState || isLoading) return;

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                window.scrollTo({ top: restoredScrollY, behavior: "auto" });
                pendingRestoredScrollYRef.current = null;
                suppressAutoFocusRef.current = false;
            });
        });
    }, [hasRestoredState, isLoading, swimmers]);

    useEffect(() => {
        const handle = window.setTimeout(() => {
            setDebouncedSearchQuery(searchQuery.trim());
        }, 250);

        return () => window.clearTimeout(handle);
    }, [searchQuery]);

    useEffect(() => {
        if (!hasRestoredState) return;
        loadData(currentPage, debouncedSearchQuery);
    }, [hasRestoredState, currentPage, debouncedSearchQuery]);

    useEffect(() => {
        if (!hasRestoredState) return;
        void loadFilterOptionsFromAssignments();
    }, [hasRestoredState]);

    useEffect(() => {
        if (!hasRestoredState) return;
        if (skipInitialPersistRef.current) {
            skipInitialPersistRef.current = false;
            return;
        }

        persistState();
    }, [
        hasRestoredState,
        openSwimmerId,
        searchQuery,
        debouncedSearchQuery,
        classFilter,
        instructorFilter,
        groupFilter,
        statusFilter,
        listView,
        swimmers,
        currentPage,
        pagination,
    ]);

    useEffect(() => {
        if (!hasRestoredState) return;
        if (isLoading) return;
        persistDataCache(debouncedSearchQuery);
    }, [
        hasRestoredState,
        isLoading,
        debouncedSearchQuery,
        swimmers,
        fallbackClassOptions,
        fallbackInstructorOptions,
        fallbackGroupOptions,
        memberIdsByGroupId,
        memberIdsByInstructorId,
    ]);

    const handleSwimmerClick = (swimmerId: string) => {
        setEditingEvaluationBySwimmer((prev) => ({
            ...prev,
            [swimmerId]: null,
        }));
        setViewingEvaluationBySwimmer((prev) => ({
            ...prev,
            [swimmerId]: null,
        }));
        setHistoryActionErrorBySwimmer((prev) => ({
            ...prev,
            [swimmerId]: "",
        }));
        setOpenSwimmerId((current) => (current === swimmerId ? null : swimmerId));
    };

    const openEvaluationEntryForEditing = async (args: {
        swimmerId: string;
        classId: string;
        entry: {
            evaluationId: string;
            isSkillNote: boolean;
            skillName?: string;
            feedback?: string;
        };
        skills: DashboardSkill[];
    }) => {
        if (!hasUsableEvaluationId(args.entry.evaluationId)) {
            await loadData(currentPage, debouncedSearchQuery, {
                forceRefresh: true,
            });
            setHistoryActionErrorBySwimmer((prev) => ({
                ...prev,
                [args.swimmerId]:
                    "This evaluation entry was out of sync. The list was refreshed; please try again.",
            }));
            return;
        }

        setActiveEvaluationClassIdBySwimmer((prev) => ({
            ...prev,
            [args.swimmerId]: null,
        }));
        setEditingEvaluationBySwimmer((prev) => ({
            ...prev,
            [args.swimmerId]: {
                evaluationId: args.entry.evaluationId,
                classId: args.classId,
                isSkillNote: args.entry.isSkillNote,
                skillId: args.entry.isSkillNote
                    ? args.skills.find((skill) => skill.name === args.entry.skillName)?.id
                    : undefined,
                feedback: args.entry.feedback,
            },
        }));
        setHistoryActionErrorBySwimmer((prev) => ({
            ...prev,
            [args.swimmerId]: "",
        }));
    };

    const deleteEvaluationEntry = async (args: {
        swimmerId: string;
        classId: string;
        evaluationId: string;
    }): Promise<boolean> => {
        if (!hasUsableEvaluationId(args.evaluationId)) {
            await loadData(currentPage, debouncedSearchQuery, {
                forceRefresh: true,
            });
            setHistoryActionErrorBySwimmer((prev) => ({
                ...prev,
                [args.swimmerId]: "This evaluation entry was out of sync. The list was refreshed; please try again.",
            }));
            showActionBanner("error", "This evaluation entry was out of sync. The list was refreshed; please try again.");
            return false;
        }

        const deleteKey = `${args.swimmerId}:${args.classId}:${args.evaluationId}`;

        try {
            setDeletingEvaluationKey(deleteKey);
            setHistoryActionErrorBySwimmer((prev) => ({
                ...prev,
                [args.swimmerId]: "",
            }));

            const response = await authFetch(
                `/api/instructor/swimmers/${args.swimmerId}?evaluationId=${encodeURIComponent(args.evaluationId)}`,
                {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                },
            );

            const responseText = await response.text();
            let payload: { error?: string } = {};

            if (responseText.trim()) {
                try {
                    payload = JSON.parse(responseText) as { error?: string };
                } catch {
                    throw new Error(response.ok
                        ? "The server returned an unexpected response."
                        : `The server returned an unexpected ${response.status} error page.`);
                }
            }

            if (!response.ok) {
                throw new Error(payload.error || "Failed to delete evaluation.");
            }

            applyDeletedEvaluationLocally(args);
            setHistoryActionErrorBySwimmer((prev) => ({
                ...prev,
                [args.swimmerId]: "",
            }));
            showActionBanner("success", "Evaluation entry deleted.");

            setEditingEvaluationBySwimmer((prev) => ({
                ...prev,
                [args.swimmerId]: prev[args.swimmerId]?.evaluationId === args.evaluationId
                    ? null
                    : prev[args.swimmerId],
            }));

            await loadData(currentPage, debouncedSearchQuery, {
                forceRefresh: true,
            });
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to delete evaluation.";

            if (message.includes("Evaluation not found")) {
                await loadData(currentPage, debouncedSearchQuery, {
                    forceRefresh: true,
                });
            }

            setHistoryActionErrorBySwimmer((prev) => ({
                ...prev,
                [args.swimmerId]: message.includes("Evaluation not found")
                    ? "This evaluation entry was out of sync. The list was refreshed; please try again."
                    : message,
            }));
            showActionBanner(
                "error",
                message.includes("Evaluation not found")
                    ? "This evaluation entry was out of sync. The list was refreshed; please try again."
                    : message,
            );
            return false;
        } finally {
            setDeletingEvaluationKey(null);
        }
    };

    const applyDeletedEvaluationLocally = (args: {
        swimmerId: string;
        classId: string;
        evaluationId: string;
    }) => {
        setSwimmers((prev) => prev.map((swimmer) => {
            if (swimmer.id !== args.swimmerId) {
                return swimmer;
            }

            let removedEntryCount = 0;

            const nextClassEvaluations = (swimmer.classEvaluations ?? []).map((classSummary) => {
                if (classSummary.classId !== args.classId) {
                    return classSummary;
                }

                const removedEntries = (classSummary.recentEntries ?? []).filter(
                    (entry) => entry.evaluationId === args.evaluationId,
                );

                if (removedEntries.length === 0) {
                    return classSummary;
                }

                removedEntryCount += removedEntries.length;

                const nextRecentEntries = (classSummary.recentEntries ?? []).filter(
                    (entry) => entry.evaluationId !== args.evaluationId,
                );
                const remainingGeneralEntries = nextRecentEntries.filter((entry) => !entry.isSkillNote);
                const removedGeneralCount = removedEntries.filter((entry) => !entry.isSkillNote).length;
                const removedSkillCount = removedEntries.filter((entry) => entry.isSkillNote).length;

                return {
                    ...classSummary,
                    evaluationCount: Math.max(0, classSummary.evaluationCount - removedEntries.length),
                    generalNoteCount: Math.max(0, classSummary.generalNoteCount - removedGeneralCount),
                    skillNoteCount: Math.max(0, classSummary.skillNoteCount - removedSkillCount),
                    latestGeneralNote: remainingGeneralEntries[0]?.feedback,
                    recentEntries: nextRecentEntries,
                };
            });

            return {
                ...swimmer,
                classEvaluations: nextClassEvaluations,
                evaluationSummary: {
                    ...swimmer.evaluationSummary,
                    evaluationCount: Math.max(0, swimmer.evaluationSummary.evaluationCount - removedEntryCount),
                },
            };
        }));
    };

    const isPastClass = (classItem: DashboardClass) => {
        if (!classItem.endDate) return false;
        const endDate = new Date(classItem.endDate);
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        return endDate < now;
    };

    const getClassesNeedingEvaluation = useCallback((
        swimmer: DashboardSwimmer,
        options?: { requireMySwimmer?: boolean },
    ) => {
        if (options?.requireMySwimmer && !swimmer.isMySwimmer) return [];

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const upcomingCutoff = new Date(today);
        upcomingCutoff.setDate(upcomingCutoff.getDate() + 3);

        const recentPastCutoff = new Date(today);
        recentPastCutoff.setDate(recentPastCutoff.getDate() - 14);

        const evaluationCountsByClassId = new Map(
            (swimmer.classEvaluations ?? []).map((classSummary) => [
                classSummary.classId,
                classSummary.evaluationCount,
            ]),
        );

        return swimmer.classes.filter((classItem) => {
            const endDate = toDateAtMidnight(classItem.endDate);
            if (!endDate) {
                return false;
            }

            if (endDate < recentPastCutoff || endDate > upcomingCutoff) {
                return false;
            }

            return (evaluationCountsByClassId.get(classItem.id) ?? 0) === 0;
        });
    }, []);

    const swimmerNeedsEvaluation = useCallback((
        swimmer: DashboardSwimmer,
        options?: { requireMySwimmer?: boolean },
    ) => getClassesNeedingEvaluation(swimmer, options).length > 0, [getClassesNeedingEvaluation]);

    const mySwimmersNeedingEvaluation = useMemo(() => (
        swimmers.filter((swimmer) =>
            swimmerNeedsEvaluation(swimmer, { requireMySwimmer: true }),
        )
    ), [swimmers]);

    const shouldRequireMySwimmerForNeedsEvaluation =
        needsEvaluationScope === "my-only" ||
        (needsEvaluationScope === "my-first" && mySwimmersNeedingEvaluation.length > 0);

    const emptyStateText = useMemo(() => {
        if (debouncedSearchQuery) {
            return "No swimmers found for this search.";
        }

        if (classFilter !== "all" || instructorFilter !== "all" || groupFilter !== "all" || statusFilter !== "all") {
            return "No swimmers match the selected filters.";
        }

        if (listView === "active-classes") {
            return "No swimmers with active classes found.";
        }

        if (listView === "past-classes") {
            return "No swimmers with past classes found.";
        }

        if (listView === "recent-evals") {
            return "No swimmers with evaluations found.";
        }

        if (listView === "needs-evaluation") {
            return "No swimmers currently need an evaluation.";
        }

        if (listView === "my-swimmers") {
            return "No swimmers assigned to you found.";
        }

        return "No swimmers found.";
    }, [debouncedSearchQuery, classFilter, instructorFilter, groupFilter, listView, statusFilter]);

/*
    const classFilterOptions = useMemo(() => {
        const classMap = new Map<string, string>();

        swimmers.forEach((swimmer) => {
            swimmer.classes.forEach((classItem) => {
                if (!isClassCurrentOrRecent(classItem.startDate, classItem.endDate)) {
                    return;
                }

                if (!classMap.has(classItem.id)) {
                    classMap.set(classItem.id, classItem.name);
                }
            });
        });

        const options = Array.from(classMap.entries())
            .map(([value, label]) => ({ value, label }))
            .sort((a, b) => a.label.localeCompare(b.label));

        fallbackClassOptions.forEach((option) => {
            if (!classMap.has(option.value)) {
                if (!isClassCurrentOrRecent(option.startDate, option.endDate)) {
                    return;
                }

                classMap.set(option.value, option.label);
                options.push(option);
            }
        });

        options.sort((a, b) => a.label.localeCompare(b.label));

        if (options.length === 0) {
            return [
                { value: "all", label: "All classes" },
                { value: "__empty_classes", label: "No classes available", disabled: true },
            ];
        }

        return [{ value: "all", label: "All classes" }, ...options];
    }, [swimmers, fallbackClassOptions]);
*/

    const classFilterOptions = useMemo(() => {
        const classMap = new Map<string, { label: string; endDate: string }>();

        swimmers.forEach((swimmer) => {
            swimmer.classes.forEach((classItem) => {
                if (!isClassCurrentOrRecent(classItem.startDate, classItem.endDate)) {
                    return;
                }

                if (!classMap.has(classItem.id)) {
                    classMap.set(classItem.id, {
                        label: classItem.name,
                        endDate: classItem.endDate,
                    });
                }
            });
        });

        const options = Array.from(classMap.entries())
            .map(([value, data]) => ({
                value,
                label: data.label,
                endDate: data.endDate,
            }))
            .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());

        fallbackClassOptions.forEach((option) => {
            if (!classMap.has(option.value)) {
                if (!isClassCurrentOrRecent(option.startDate, option.endDate)) {
                    return;
                }

                classMap.set(option.value, {
                    label: option.label,
                    endDate: option.endDate,
                });

                options.push({
                    ...option,
                    endDate: option.endDate,
                });
            }
        });

        options.sort(
            (a, b) =>
                new Date(a.endDate).getTime() -
                new Date(b.endDate).getTime()
        );

        if (options.length === 0) {
            return [
                { value: "all", label: "All classes" },
                {
                    value: "__empty_classes",
                    label: "No classes available",
                    disabled: true,
                },
            ];
        }

        return [{ value: "all", label: "All classes" }, ...options];
    }, [swimmers, fallbackClassOptions]);

    

    const instructorFilterOptions = useMemo(() => {
        const optionMap = new Map<string, string>();

        // Track labels already covered by fallback (person_id-keyed) options
        // so we don't add a duplicate name-keyed entry for the same instructor.
        const knownLabels = new Set<string>();

        fallbackInstructorOptions.forEach((option) => {
            optionMap.set(option.value, option.label);
            knownLabels.add(option.label.trim().toLowerCase());
        });

        swimmers.forEach((swimmer) => {
            swimmer.evaluationSummary.instructors.forEach((instructorName) => {
                const normalized = instructorName.trim();
                if (!normalized || optionMap.has(normalized) || knownLabels.has(normalized.toLowerCase())) return;
                optionMap.set(normalized, normalized);
                knownLabels.add(normalized.toLowerCase());
            });

            (swimmer.classEvaluations ?? []).forEach((classSummary) => {
                classSummary.instructors.forEach((instructorName) => {
                    const normalized = instructorName.trim();
                    if (!normalized || optionMap.has(normalized) || knownLabels.has(normalized.toLowerCase())) return;
                    optionMap.set(normalized, normalized);
                    knownLabels.add(normalized.toLowerCase());
                });
            });
        });

        const options = Array.from(optionMap.entries())
            .map(([value, label]) => ({ value, label }))
            .sort((a, b) => a.label.localeCompare(b.label));

        if (options.length === 0) {
            return [
                { value: "all", label: "All instructors" },
                { value: "__empty_instructors", label: "No instructors available", disabled: true },
            ];
        }

        return [{ value: "all", label: "All instructors" }, ...options];
    }, [fallbackInstructorOptions, swimmers]);

    useEffect(() => {
        if (!classFilterOptions.some((option) => option.value === classFilter)) {
            setClassFilter("all");
        }
    }, [classFilter, classFilterOptions]);

    useEffect(() => {
        if (!instructorFilterOptions.some((option) => option.value === instructorFilter)) {
            setInstructorFilter("all");
        }
    }, [instructorFilter, instructorFilterOptions]);

    const groupFilterOptions = useMemo(() => {
        const optionMap = new Map<string, string>();

        fallbackGroupOptions.forEach((option) => {
            if (classFilter !== "all") {
                const groupClass = groupClassMap.get(option.value);
                if (groupClass && groupClass !== classFilter) return;
            }
            optionMap.set(option.value, option.label);
        });

        const options = Array.from(optionMap.entries())
            .map(([value, label]) => ({ value, label }))
            .sort((a, b) => a.label.localeCompare(b.label));

        if (options.length === 0) {
            return [
                { value: "all", label: "All groups" },
                { value: "__empty_groups", label: "No groups available", disabled: true },
            ];
        }

        return [{ value: "all", label: "All groups" }, ...options];
    }, [fallbackGroupOptions, groupClassMap, classFilter]);

    useEffect(() => {
        if (!groupFilterOptions.some((option) => option.value === groupFilter)) {
            setGroupFilter("all");
        }
    }, [groupFilter, groupFilterOptions]);

    const displayedSwimmers = useMemo(() => {
        const filtered = swimmers.filter((swimmer) => {
            const statusMatchedClasses = swimmer.classes.filter((classItem) =>
                matchesClassStatusFilter(classItem, statusFilter),
            );
            const activeClassCount = swimmer.classes.filter((classItem) => !isPastClass(classItem)).length;
            const pastClassCount = swimmer.classes.filter((classItem) => isPastClass(classItem)).length;

            if (listView === "active-classes" && activeClassCount === 0) {
                return false;
            }

            if (listView === "past-classes" && pastClassCount === 0) {
                return false;
            }

            if (listView === "recent-evals" && swimmer.evaluationSummary.evaluationCount === 0) {
                return false;
            }

            if (
                listView === "needs-evaluation" &&
                !swimmerNeedsEvaluation(swimmer, {
                    requireMySwimmer: shouldRequireMySwimmerForNeedsEvaluation,
                })
            ) {
                return false;
            }

            if (listView === "my-swimmers" && !swimmer.isMySwimmer) {
                return false;
            }

            if (statusFilter === "active" && swimmer.isActive === false) {
                return false;
            }

            if (statusFilter === "inactive" && swimmer.isActive === true) {
                return false;
            }

            if (classFilter !== "all") {
                const hasSelectedClass = statusMatchedClasses.some((classItem) => classItem.id === classFilter);
                if (!hasSelectedClass) return false;
            }

            //if (classFilter === "all" && statusFilter !== "all" && statusMatchedClasses.length === 0) {
            //    return false;
            //}

            if (instructorFilter !== "all") {
                const memberIdsForInstructor = memberIdsByInstructorId[instructorFilter];
                const hasInstructorAssignment = memberIdsForInstructor?.has(swimmer.id) ?? false;
                // instructorFilter may be a person_id (UUID) or a name string.
                // Resolve to a display name so we can match against evaluation summaries,
                // which store names rather than IDs.
                const resolvedInstructorName = (
                    instructorFilterOptions.find((o) => o.value === instructorFilter)?.label
                    ?? instructorFilter
                ).trim();
                const matchesName = (name: string) =>
                    name.trim() === resolvedInstructorName || name.trim() === instructorFilter;
                const hasInstructorEvaluation =
                    swimmer.evaluationSummary.instructors.some(matchesName) ||
                    (swimmer.classEvaluations ?? []).some((classSummary) =>
                        classSummary.instructors.some(matchesName),
                    );

                if (!hasInstructorAssignment && !hasInstructorEvaluation) {
                    return false;
                }
            }

            if (groupFilter !== "all") {
                const memberIdsForGroup = memberIdsByGroupId[groupFilter];
                if (!memberIdsForGroup?.has(swimmer.id)) {
                    return false;
                }
            }

            return true;
        });

        const sorted = [...filtered].sort((a, b) =>
            a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
        );

        return sorted;
    }, [classFilter, instructorFilter, groupFilter, listView, memberIdsByGroupId, memberIdsByInstructorId, shouldRequireMySwimmerForNeedsEvaluation, statusFilter, swimmers]);

    const needsEvaluationSwimmers = useMemo(() => {
        return displayedSwimmers.filter((swimmer) =>
            swimmerNeedsEvaluation(swimmer, { requireMySwimmer: true }),
        );
    }, [displayedSwimmers]);

    const totalFiltered = displayedSwimmers.length;
    const localTotalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
    const safeCurrentPage = Math.min(currentPage, localTotalPages);
    const pagedSwimmers = useMemo(() => {
        const start = (safeCurrentPage - 1) * PAGE_SIZE;
        return displayedSwimmers.slice(start, start + PAGE_SIZE);
    }, [displayedSwimmers, safeCurrentPage]);
    const shouldVirtualize = false;
    const swimmersForRender = shouldVirtualize ? displayedSwimmers : pagedSwimmers;

    const virtualWindow = useMemo(() => {
        if (!shouldVirtualize) {
            return {
                startIndex: 0,
                endIndex: swimmersForRender.length,
                totalHeight: 0,
            };
        }

        const estimatedVisibleCount = Math.ceil(virtualContainerHeight / VIRTUAL_ROW_HEIGHT);
        const startIndex = Math.max(
            0,
            Math.floor(virtualScrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN,
        );
        const endIndex = Math.min(
            swimmersForRender.length,
            startIndex + estimatedVisibleCount + VIRTUAL_OVERSCAN * 2,
        );

        return {
            startIndex,
            endIndex,
            totalHeight: swimmersForRender.length * VIRTUAL_ROW_HEIGHT,
        };
    }, [shouldVirtualize, swimmersForRender.length, virtualContainerHeight, virtualScrollTop]);

    const virtualSlice = useMemo(
        () => swimmersForRender.slice(virtualWindow.startIndex, virtualWindow.endIndex),
        [swimmersForRender, virtualWindow.startIndex, virtualWindow.endIndex],
    );

    useEffect(() => {
        if (currentPage > localTotalPages) {
            setCurrentPage(localTotalPages);
        }
    }, [currentPage, localTotalPages]);

    useEffect(() => {
        setPageInput(String(safeCurrentPage));
    }, [safeCurrentPage]);

    useEffect(() => {
        setPagination({
            page: safeCurrentPage,
            pageSize: PAGE_SIZE,
            total: totalFiltered,
            totalPages: localTotalPages,
            hasNextPage: safeCurrentPage < localTotalPages,
            hasPreviousPage: safeCurrentPage > 1,
        });
    }, [safeCurrentPage, totalFiltered, localTotalPages]);

    useEffect(() => {
        if (!shouldVirtualize) return;

        syncVirtualContainerHeight();
        if (typeof window === "undefined") return;

        const onResize = () => syncVirtualContainerHeight();
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, [shouldVirtualize]);

    useEffect(() => {
        if (!shouldVirtualize) {
            setVirtualScrollTop(0);
        }
    }, [shouldVirtualize]);

    const swimmersToRender = shouldVirtualize ? virtualSlice : swimmersForRender;
    const listViewTitle =
        listView === "my-swimmers"
            ? "My Swimmers"
            : listView === "needs-evaluation"
                ? "Needs Evaluation"
                : "All Swimmers";

    return (
        <div className="w-full min-h-[60vh] space-y-4">
            {showNeedsEvaluationSection && listView === "my-swimmers" && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-sm font-semibold text-blue-900">Needs Evaluation</p>
                            <p className="mt-1 text-sm text-blue-800">
                                Swimmers in your classes ending within 3 days or ended within the last 2 weeks.
                            </p>
                        </div>
                        <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-900">
                            {needsEvaluationSwimmers.length}
                        </span>
                    </div>

                    {needsEvaluationSwimmers.length > 0 ? (
                        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                            {needsEvaluationSwimmers.map((swimmer) => {
                                const closestClass = [...getClassesNeedingEvaluation(swimmer, { requireMySwimmer: true })]
                                    .sort((a, b) => {
                                        const aTime = toDateAtMidnight(a.endDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
                                        const bTime = toDateAtMidnight(b.endDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
                                        return aTime - bTime;
                                    })[0];

                                return (
                                    <button
                                        key={`needs-eval:${swimmer.id}`}
                                        type="button"
                                        onClick={() => {
                                            // Open the swimmer card
                                            handleSwimmerClick(swimmer.id);
                                            // Track that this swimmer was opened from the needs-eval section
                                            setNeedsEvalOpenSwimmerIds((prev) => new Set(prev).add(swimmer.id));
                                            // Jump the main paginated list to whatever page the
                                            // swimmer's row card sits on, so the form actually
                                            // becomes visible after we open it.
                                            const targetPage = findSwimmerPage(swimmer.id, displayedSwimmers);
                                            if (targetPage !== null && targetPage !== currentPage) {
                                                setCurrentPage(targetPage);
                                            }
                                            // Auto-open the eval form for the closest class and scroll to it
                                            if (closestClass?.id) {
                                                pendingScrollToSwimmerRef.current = swimmer.id;
                                                setActiveEvaluationClassIdBySwimmer((prev) => ({
                                                    ...prev,
                                                    [swimmer.id]: closestClass.id,
                                                }));
                                                setViewingEvaluationBySwimmer((prev) => ({
                                                    ...prev,
                                                    [swimmer.id]: null,
                                                }));
                                                setEditingEvaluationBySwimmer((prev) => ({
                                                    ...prev,
                                                    [swimmer.id]: null,
                                                }));
                                            }
                                        }}
                                        className="rounded-lg border border-blue-200 bg-white px-4 py-3 text-left transition hover:border-blue-300 hover:bg-blue-50"
                                    >
                                        <p className="text-sm font-semibold text-gray-900">{swimmer.name}</p>
                                        <div className="mt-1">
                                            <p className="text-xs font-medium text-gray-700">
                                                {closestClass?.name ?? "Class"}
                                                {closestClass?.slot !== undefined && closestClass?.slot !== null
                                                    ? ` - Slot ${closestClass.slot}`
                                                    : ""}
                                            </p>
                                            <p className="mt-1 text-[11px] uppercase tracking-wide text-gray-500">
                                                Ends {formatDateLabel(closestClass?.endDate)}
                                            </p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="mt-4 text-sm text-blue-800">No swimmers currently need an evaluation.</p>
                    )}
                </div>
            )}

            {showProficiencyScaleSection && (
                <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
                    <details className="group">
                        <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-600 hover:text-gray-800">
                            <span>Proficiency scale</span>
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
                        <ul className="mt-3 space-y-2">
                            <li className="flex gap-3 text-sm text-gray-700">
                                <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                                    0
                                </span>
                                <span>Unable to attempt the skill</span>
                            </li>
                            <li className="flex gap-3 text-sm text-gray-700">
                                <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                                    1
                                </span>
                                <span>Unable to show skill without significant support</span>
                            </li>
                            <li className="flex gap-3 text-sm text-gray-700">
                                <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                                    2
                                </span>
                                <span>Inconsistently or with support is able to demonstrate the skill</span>
                            </li>
                            <li className="flex gap-3 text-sm text-gray-700">
                                <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                                    3
                                </span>
                                <span>Consistently demonstrates application of the skill</span>
                            </li>
                            <li className="flex gap-3 text-sm text-gray-700">
                                <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                                    4
                                </span>
                                <span>Demonstrates complete understanding of the skill</span>
                            </li>
                        </ul>
                    </details>
                </section>
            )}

            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 sm:p-4">
                    {/* Row 1: search + filter toggle button */}
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            placeholder="Search swimmers..."
                            value={searchQuery}
                            onChange={(event) => {
                                setSearchQuery(event.target.value);
                                setCurrentPage(1);
                            }}
                            className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                            type="button"
                            onClick={() => setIsFiltersOpen((current) => !current)}
                            aria-expanded={isFiltersOpen}
                            aria-controls="evaluation-filters-panel"
                            aria-label={isFiltersOpen ? "Hide filters" : "Show filters"}
                            className={`flex flex-shrink-0 items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${isFiltersOpen
                                ? "border-blue-500 bg-blue-50 text-blue-700"
                                : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                                }`}
                        >
                            <svg className={`h-3.5 w-3.5 transition-transform ${isFiltersOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>

                        </button>
                    </div>

                    {/* Row 2: filter dropdowns */}
                    {isFiltersOpen && (
                        <div id="evaluation-filters-panel" className="mt-3 flex flex-wrap gap-3 border-t border-gray-200 pt-3">
                            <div className="min-w-[130px] flex-1 space-y-1">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">View</p>
                                <DropdownButton
                                    value={listView}
                                    onChange={(value) => {
                                        setListView(value as typeof listView);
                                        setCurrentPage(1);
                                    }}
                                    ui="app"
                                    options={[
                                        { value: "active-classes", label: "Active Classes" },
                                        { value: "past-classes", label: "Past Classes" },
                                        { value: "my-swimmers", label: "My Swimmers" },
                                        { value: "needs-evaluation", label: "Needs Evaluation" },
                                        { value: "recent-evals", label: "Recent Evals" },
                                        { value: "overview", label: "All Swimmers" },
                                    ]}
                                    ariaLabel="Select view"
                                />
                            </div>
                            <div className="min-w-[130px] flex-1 space-y-1">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Class</p>
                                <DropdownButton
                                    value={classFilter}
                                    onChange={(value) => {
                                        setClassFilter(value);
                                        setCurrentPage(1);
                                    }}
                                    ui="app"
                                    options={classFilterOptions}
                                    ariaLabel="Filter swimmers by class"
                                />
                            </div>
                            <div className="min-w-[130px] flex-1 space-y-1">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Instructor</p>
                                <DropdownButton
                                    value={instructorFilter}
                                    onChange={(value) => {
                                        setInstructorFilter(value);
                                        setCurrentPage(1);
                                    }}
                                    ui="app"
                                    options={instructorFilterOptions}
                                    ariaLabel="Filter swimmers by instructor"
                                />
                            </div>
                            <div className="min-w-[120px] flex-1 space-y-1">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Group</p>
                                <DropdownButton
                                    value={groupFilter}
                                    onChange={(value) => {
                                        setGroupFilter(value);
                                        setCurrentPage(1);
                                    }}
                                    ui="app"
                                    options={groupFilterOptions}
                                    ariaLabel="Filter swimmers by group"
                                />
                            </div>
                            <div className="min-w-[120px] flex-1 space-y-1">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Status</p>
                                <DropdownButton
                                    value={statusFilter}
                                    onChange={(value) => {
                                        setStatusFilter(value as "all" | "active" | "inactive");
                                        setCurrentPage(1);
                                    }}
                                    ui="app"
                                    options={[
                                        { value: "all", label: "All statuses" },
                                        { value: "active", label: "Active" },
                                        { value: "inactive", label: "Inactive" },
                                    ]}
                                    ariaLabel="Filter swimmers by status"
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Divider + list title */}
                <div className="mt-4 flex items-center gap-2 border-t border-gray-100 pt-4 pb-2">
                    <p className="text-sm font-semibold text-gray-900">{listViewTitle}</p>
                    {isLoading && (
                        <span className="inline-flex h-4 w-4 animate-spin rounded-full border-b-2 border-blue-600" aria-label="Loading" />
                    )}
                </div>

                {!isLoading && error && (
                    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 sm:p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 flex-1 items-start gap-2 sm:gap-3">
                                <svg
                                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600 sm:h-5 sm:w-5"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                    />
                                </svg>
                                <div className="min-w-0">
                                    <p className="text-xs font-medium text-red-800 sm:text-sm">
                                        Failed to load evaluations
                                    </p>
                                    <p className="mt-0.5 break-words text-[10px] text-red-700 sm:mt-1 sm:text-xs">
                                        {error}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() =>
                                    loadData(undefined, undefined, {
                                        forceRefresh: true,
                                    })
                                }
                                className="whitespace-nowrap rounded-md bg-red-100 px-2 py-1 text-[10px] text-red-800 transition-colors hover:bg-red-200 sm:px-3 sm:py-1.5 sm:text-xs"
                            >
                                Retry
                            </button>
                        </div>
                    </div>
                )}

                <div
                    ref={virtualListContainerRef}
                    onScroll={shouldVirtualize
                        ? (event) => setVirtualScrollTop(event.currentTarget.scrollTop)
                        : undefined}
                    className={shouldVirtualize ? "max-h-[70vh] overflow-y-auto" : ""}
                >
                    {isLoading && swimmersForRender.length === 0 && (
                        <div className="space-y-3 animate-pulse">
                            <div className="h-24 rounded-xl border border-gray-200 bg-gray-100"></div>
                            <div className="h-24 rounded-xl border border-gray-200 bg-gray-100"></div>
                            <div className="h-24 rounded-xl border border-gray-200 bg-gray-100"></div>
                        </div>
                    )}

                    {shouldVirtualize && (
                        <p className="mb-3 text-xs text-gray-500">
                            Virtualized view enabled for {displayedSwimmers.length} swimmers.
                        </p>
                    )}

                    <div
                        className="space-y-4"
                        style={shouldVirtualize
                            ? {
                                position: "relative",
                                height: `${virtualWindow.totalHeight}px`,
                                minHeight: "100%",
                            }
                            : undefined}
                    >
                        {swimmersToRender.map((swimmer, renderedIndex) => {
                            const mastered = swimmer.skillSummary?.masteredSkills ?? swimmer.skills.filter((skill) => skill.mastered).length;
                            const totalSkills = swimmer.skillSummary?.totalSkills ?? swimmer.skills.length;
                            const avgProficiency = swimmer.skillSummary?.averageProficiency ?? calculateAverageProficiency(swimmer.skills);
                            const isOpen = openSwimmerId === swimmer.id;
                            const activeClasses = swimmer.classes.filter((classItem) => !isPastClass(classItem));
                            const pastClasses = swimmer.classes.filter((classItem) => isPastClass(classItem));
                            const resolvedClasses = swimmer.classes;
                            const resolvedSkills = swimmer.skills;
                            const classEvaluationSummaryById = new Map(
                                (swimmer.classEvaluations ?? []).map((item) => [item.classId, item]),
                            );
                            const selectedEvaluationClassId = activeEvaluationClassIdBySwimmer[swimmer.id] ?? null;
                            const selectedEvaluationClass = resolvedClasses.find(
                                (classItem) => classItem.id === selectedEvaluationClassId,
                            ) ?? null;
                            const editingEvaluation = editingEvaluationBySwimmer[swimmer.id] ?? null;
                            const editingEvaluationClass = editingEvaluation
                                ? resolvedClasses.find((classItem) => classItem.id === editingEvaluation.classId) ?? null
                                : null;
                            const absoluteIndex = shouldVirtualize
                                ? virtualWindow.startIndex + renderedIndex
                                : renderedIndex;

                            return (
                                <div
                                    key={swimmer.id}
                                    className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
                                    style={shouldVirtualize
                                        ? {
                                            position: "absolute",
                                            left: 0,
                                            right: 0,
                                            top: `${absoluteIndex * VIRTUAL_ROW_HEIGHT}px`,
                                        }
                                        : undefined}
                                >
                                    <button
                                        ref={(element) => {
                                            swimmerRowRefs.current[swimmer.id] = element;
                                        }}
                                        className="w-full p-4 text-left transition hover:bg-gray-50 sm:p-6"
                                        onClick={() => {
                                            handleSwimmerClick(swimmer.id);
                                            // Track when the swimmer is opened from the dedicated
                                            // "Needs Evaluation" list view so Save/Close on the
                                            // resulting form scrolls back to the top of the list.
                                            if (listView === "needs-evaluation") {
                                                setNeedsEvalOpenSwimmerIds((prev) =>
                                                    new Set(prev).add(swimmer.id),
                                                );
                                            }
                                        }}
                                    >
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-700">
                                                    {getInitials(swimmer.name)}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <p className="text-sm font-semibold text-gray-900">
                                                            {swimmer.name}
                                                        </p>
                                                        <button
                                                            type="button"
                                                            className="text-[11px] text-blue-600 hover:text-blue-700 hover:underline"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                persistState(window.scrollY);
                                                                const returnTo =
                                                                    typeof window !== "undefined"
                                                                        ? `${window.location.pathname}${window.location.search}`
                                                                        : "/instructor/dashboard";
                                                                router.push(`/instructor/swimmers/${swimmer.id}?returnTo=${encodeURIComponent(returnTo)}`);
                                                            }}
                                                        >
                                                            View full profile
                                                        </button>
                                                    </div>
                                                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                                        <span>
                                                            {mastered}/{totalSkills} skills mastered
                                                        </span>
                                                        <span>Avg proficiency: {avgProficiency}%</span>
                                                        {activeClasses.map((classItem) => {
                                                            const tag = getClassTagColors(classItem.name);
                                                            return (
                                                                <span
                                                                    key={classItem.id}
                                                                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tag.bg} ${tag.text}`}
                                                                >
                                                                    {classItem.name}
                                                                </span>
                                                            );
                                                        })}
                                                        {pastClasses.map((classItem) => {
                                                            const tag = getClassTagColors(classItem.name);
                                                            return (
                                                                <span
                                                                    key={`past:${classItem.id}`}
                                                                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold opacity-50 ${tag.bg} ${tag.text}`}
                                                                >
                                                                    {classItem.name}
                                                                </span>
                                                            );
                                                        })}
                                                    </div>
                                                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                                                        <span>Active classes: {activeClasses.length}</span>
                                                        <span>Past classes: {pastClasses.length}</span>
                                                        <span>Evaluations: {swimmer.evaluationSummary.evaluationCount}</span>
                                                        <span>
                                                            Last eval: {swimmer.evaluationSummary.lastEvaluationDate || "N/A"}
                                                        </span>
                                                        <span className="break-words">
                                                            Instructors: {swimmer.evaluationSummary.instructors.length > 0
                                                                ? swimmer.evaluationSummary.instructors.join(", ")
                                                                : "N/A"}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            <svg
                                                className={`h-5 w-5 flex-shrink-0 self-end transform text-gray-500 transition-transform sm:self-auto ${isOpen ? "rotate-180" : ""}`}
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
                                        </div>
                                    </button>

                                    {isOpen && (
                                        <div className="border-t border-gray-100 p-5 sm:p-6">
                                            {resolvedSkills.length ? (
                                                <div className="space-y-4">
                                                    <div className="px-1">
                                                        <div>
                                                            <h3 className="text-sm font-semibold text-gray-900">Classes</h3>
                                                        </div>

                                                        <div className="mt-3 divide-y divide-gray-200">
                                                            {resolvedClasses.map((classItem) => {
                                                                const classSummary = classEvaluationSummaryById.get(classItem.id);
                                                                const isSelectedForEvaluation = selectedEvaluationClassId === classItem.id;
                                                                const latestEvaluationEntry = (classSummary?.recentEntries ?? []).find((entry) =>
                                                                    hasUsableEvaluationId(entry.evaluationId),
                                                                );
                                                                const isEditingThisClass =
                                                                    Boolean(editingEvaluation) &&
                                                                    editingEvaluation?.classId === classItem.id;
                                                                const isAddingThisClass =
                                                                    !editingEvaluation &&
                                                                    selectedEvaluationClassId === classItem.id;
                                                                const viewingEvaluation = viewingEvaluationBySwimmer[swimmer.id];
                                                                const isViewingThisClass =
                                                                    Boolean(viewingEvaluation) &&
                                                                    viewingEvaluation?.classId === classItem.id &&
                                                                    viewingEvaluation?.evaluationId === latestEvaluationEntry?.evaluationId;

                                                                return (
                                                                    <div
                                                                        key={classItem.id}
                                                                        className={`py-4 transition ${isSelectedForEvaluation || isEditingThisClass
                                                                            ? "bg-blue-50/20"
                                                                            : ""
                                                                            }`}
                                                                    >
                                                                        <div className="flex flex-col gap-4">
                                                                            <div className="min-w-0 flex-1">
                                                                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                                                                    <div className="flex flex-wrap items-center gap-2">
                                                                                        <h4 className="text-sm font-semibold text-gray-900">
                                                                                            {classItem.name}
                                                                                        </h4>
                                                                                        {isPastClass(classItem) ? (
                                                                                            <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-700">
                                                                                                Past class
                                                                                            </span>
                                                                                        ) : (
                                                                                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                                                                                Current class
                                                                                            </span>
                                                                                        )}
                                                                                        {classSummary ? (
                                                                                            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                                                                                                Evaluation recorded
                                                                                            </span>
                                                                                        ) : (
                                                                                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                                                                                No evaluation yet
                                                                                            </span>
                                                                                        )}
                                                                                    </div>
                                                                                    <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
                                                                                        {latestEvaluationEntry && (
                                                                                            <>
                                                                                                <button
                                                                                                    type="button"
                                                                                                    onClick={() => {
                                                                                                        setEditingEvaluationBySwimmer((prev) => ({
                                                                                                            ...prev,
                                                                                                            [swimmer.id]: null,
                                                                                                        }));
                                                                                                        setActiveEvaluationClassIdBySwimmer((prev) => ({
                                                                                                            ...prev,
                                                                                                            [swimmer.id]: null,
                                                                                                        }));
                                                                                                        setViewingEvaluationBySwimmer((prev) => ({
                                                                                                            ...prev,
                                                                                                            [swimmer.id]:
                                                                                                                isViewingThisClass
                                                                                                                    ? null
                                                                                                                    : {
                                                                                                                        classId: classItem.id,
                                                                                                                        evaluationId: latestEvaluationEntry.evaluationId,
                                                                                                                        isSkillNote: latestEvaluationEntry.isSkillNote,
                                                                                                                        skillId: latestEvaluationEntry.isSkillNote
                                                                                                                            ? resolvedSkills.find((skill) => skill.name === latestEvaluationEntry.skillName)?.id
                                                                                                                            : undefined,
                                                                                                                        feedback: latestEvaluationEntry.feedback,
                                                                                                                    },
                                                                                                        }));
                                                                                                    }}
                                                                                                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-blue-700 transition hover:bg-blue-100 sm:h-8 sm:w-8"
                                                                                                    aria-label="Show evaluation"
                                                                                                    title="Show evaluation"
                                                                                                >
                                                                                                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                                                                    </svg>
                                                                                                </button>
                                                                                                <button
                                                                                                    type="button"
                                                                                                    onClick={() => void openEvaluationEntryForEditing({
                                                                                                        swimmerId: swimmer.id,
                                                                                                        classId: classItem.id,
                                                                                                        entry: latestEvaluationEntry,
                                                                                                        skills: resolvedSkills,
                                                                                                    })}
                                                                                                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-amber-700 transition hover:bg-amber-100 sm:h-8 sm:w-8"
                                                                                                    aria-label="Edit evaluation"
                                                                                                    title="Edit evaluation"
                                                                                                >
                                                                                                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5" />
                                                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                                                                                                    </svg>
                                                                                                </button>
                                                                                                <button
                                                                                                    type="button"
                                                                                                    onClick={() => {
                                                                                                        setDeleteDialog({
                                                                                                            show: true,
                                                                                                            swimmerId: swimmer.id,
                                                                                                            classId: classItem.id,
                                                                                                            evaluationId: latestEvaluationEntry.evaluationId,
                                                                                                            swimmerName: swimmer.name,
                                                                                                            className: classItem.name,
                                                                                                        });
                                                                                                    }}
                                                                                                    disabled={deletingEvaluationKey === `${swimmer.id}:${classItem.id}:${latestEvaluationEntry.evaluationId}`}
                                                                                                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-red-200 bg-red-50 text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 sm:h-8 sm:w-8"
                                                                                                    aria-label="Delete evaluation"
                                                                                                    title="Delete evaluation"
                                                                                                >
                                                                                                    {deletingEvaluationKey === `${swimmer.id}:${classItem.id}:${latestEvaluationEntry.evaluationId}` ? (
                                                                                                        <span className="h-3 w-3 animate-spin rounded-full border-b-2 border-red-600" />
                                                                                                    ) : (
                                                                                                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3m-7 0h8" />
                                                                                                        </svg>
                                                                                                    )}
                                                                                                </button>
                                                                                            </>
                                                                                        )}
                                                                                        {!latestEvaluationEntry && !isSelectedForEvaluation && !(isAddingThisClass || isEditingThisClass) && !(classItem.startDate && new Date(classItem.startDate) > new Date()) && (
                                                                                            <button
                                                                                                type="button"
                                                                                                onClick={() => {
                                                                                                    setViewingEvaluationBySwimmer((prev) => ({
                                                                                                        ...prev,
                                                                                                        [swimmer.id]: null,
                                                                                                    }));
                                                                                                    setActiveEvaluationClassIdBySwimmer((prev) => ({
                                                                                                        ...prev,
                                                                                                        [swimmer.id]: classItem.id,
                                                                                                    }));
                                                                                                }}
                                                                                                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700"
                                                                                            >
                                                                                                {classSummary ? "Add Eval" : "Add Evaluation"}
                                                                                            </button>
                                                                                        )}
                                                                                        {isSelectedForEvaluation && !(isAddingThisClass || isEditingThisClass) && (
                                                                                            <button
                                                                                                type="button"
                                                                                                onClick={() => {
                                                                                                    if (!confirmDiscardEvaluation(swimmer.id)) return;
                                                                                                    setActiveEvaluationClassIdBySwimmer((prev) => ({
                                                                                                        ...prev,
                                                                                                        [swimmer.id]: null,
                                                                                                    }));
                                                                                                    setHistoryActionErrorBySwimmer((prev) => ({
                                                                                                        ...prev,
                                                                                                        [swimmer.id]: "",
                                                                                                    }));
                                                                                                    consumeNeedsEvalSwimmer(swimmer.id);
                                                                                                }}
                                                                                                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                                                                                            >
                                                                                                Close Form
                                                                                            </button>
                                                                                        )}
                                                                                    </div>
                                                                                </div>

                                                                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                                                                    <span>{getClassWindowLabel(classItem)}</span>
                                                                                    <span>{classItem.schedule || "Schedule TBD"}</span>
                                                                                </div>

                                                                                {(() => {
                                                                                    const entriesWithFeedback = (classSummary?.recentEntries ?? []).filter(
                                                                                        (entry) => Boolean(entry.feedback && entry.feedback.trim()),
                                                                                    );
                                                                                    if (entriesWithFeedback.length === 0) return null;
                                                                                    const skillEntries = entriesWithFeedback.filter((e) => e.isSkillNote);
                                                                                    const generalEntries = entriesWithFeedback.filter((e) => !e.isSkillNote);
                                                                                    return (
                                                                                        <div className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                                                                                            {generalEntries.length > 0 && (
                                                                                                <div>
                                                                                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                                                                                                        Class feedback
                                                                                                    </p>
                                                                                                    <ul className="mt-1 space-y-1.5">
                                                                                                        {generalEntries.map((entry) => (
                                                                                                            <li
                                                                                                                key={`gen:${entry.evaluationId}`}
                                                                                                                className="text-xs text-gray-700"
                                                                                                            >
                                                                                                                <p className="leading-snug">{entry.feedback}</p>
                                                                                                                <p className="mt-0.5 text-[11px] text-gray-500">
                                                                                                                    {entry.date} · {entry.instructor}
                                                                                                                </p>
                                                                                                            </li>
                                                                                                        ))}
                                                                                                    </ul>
                                                                                                </div>
                                                                                            )}
                                                                                            {skillEntries.length > 0 && (
                                                                                                <div>
                                                                                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                                                                                                        Skill notes
                                                                                                    </p>
                                                                                                    <ul className="mt-1 space-y-1.5">
                                                                                                        {skillEntries.map((entry) => (
                                                                                                            <li
                                                                                                                key={`skill:${entry.evaluationId}`}
                                                                                                                className="text-xs text-gray-700"
                                                                                                            >
                                                                                                                <p className="leading-snug">
                                                                                                                    <span className="font-semibold text-gray-900">
                                                                                                                        {entry.skillName ?? "Skill"}:
                                                                                                                    </span>{" "}
                                                                                                                    {entry.feedback}
                                                                                                                </p>
                                                                                                                <p className="mt-0.5 text-[11px] text-gray-500">
                                                                                                                    {entry.date} · {entry.instructor}
                                                                                                                </p>
                                                                                                            </li>
                                                                                                        ))}
                                                                                                    </ul>
                                                                                                </div>
                                                                                            )}
                                                                                        </div>
                                                                                    );
                                                                                })()}

                                                                                {(isEditingThisClass || isAddingThisClass) && (
                                                                                    <div className="mt-4 space-y-3 rounded-lg bg-blue-50/60 p-4">
                                                                                        <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
                                                                                            <div>
                                                                                                <p className="text-sm font-semibold text-blue-900">
                                                                                                    {isEditingThisClass
                                                                                                        ? `Edit evaluation for ${classItem.name}`
                                                                                                        : `New evaluation for ${classItem.name}`}
                                                                                                </p>
                                                                                                <p className="mt-1 text-xs text-blue-800">
                                                                                                    {isEditingThisClass
                                                                                                        ? "Update this existing class evaluation."
                                                                                                        : "Create a class evaluation here."}
                                                                                                </p>
                                                                                            </div>
                                                                                            <button
                                                                                                type="button"
                                                                                                onClick={() => {
                                                                                                    if (!confirmDiscardEvaluation(swimmer.id)) return;
                                                                                                    setEditingEvaluationBySwimmer((prev) => ({
                                                                                                        ...prev,
                                                                                                        [swimmer.id]: null,
                                                                                                    }));
                                                                                                    setViewingEvaluationBySwimmer((prev) => ({
                                                                                                        ...prev,
                                                                                                        [swimmer.id]: null,
                                                                                                    }));
                                                                                                    setActiveEvaluationClassIdBySwimmer((prev) => ({
                                                                                                        ...prev,
                                                                                                        [swimmer.id]: null,
                                                                                                    }));
                                                                                                    setHistoryActionErrorBySwimmer((prev) => ({
                                                                                                        ...prev,
                                                                                                        [swimmer.id]: "",
                                                                                                    }));
                                                                                                    consumeNeedsEvalSwimmer(swimmer.id);
                                                                                                }}
                                                                                                className="rounded-md border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-100"
                                                                                            >
                                                                                                Close
                                                                                            </button>
                                                                                        </div>

                                                                                        {historyActionErrorBySwimmer[swimmer.id] && (
                                                                                            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                                                                                {historyActionErrorBySwimmer[swimmer.id]}
                                                                                            </div>
                                                                                        )}

                                                                                        <EvaluationForm
                                                                                            swimmerId={swimmer.id}
                                                                                            skills={resolvedSkills}
                                                                                            classes={resolvedClasses}
                                                                                            initialClassId={classItem.id}
                                                                                            editingEvaluation={isEditingThisClass ? editingEvaluation ?? undefined : undefined}
                                                                                            onDirtyChange={(dirty) => setEvaluationFormDirty(swimmer.id, dirty)}
                                                                                            onSubmissionComplete={() => {
                                                                                                setEvaluationFormDirty(swimmer.id, false);
                                                                                                consumeNeedsEvalSwimmer(swimmer.id);
                                                                                                setEditingEvaluationBySwimmer((prev) => ({
                                                                                                    ...prev,
                                                                                                    [swimmer.id]: null,
                                                                                                }));
                                                                                                setActiveEvaluationClassIdBySwimmer((prev) => ({
                                                                                                    ...prev,
                                                                                                    [swimmer.id]: null,
                                                                                                }));
                                                                                                setHistoryActionErrorBySwimmer((prev) => ({
                                                                                                    ...prev,
                                                                                                    [swimmer.id]: "",
                                                                                                }));
                                                                                                void loadData(currentPage, debouncedSearchQuery, {
                                                                                                    forceRefresh: true,
                                                                                                });
                                                                                            }}
                                                                                        />
                                                                                    </div>
                                                                                )}

                                                                                {isViewingThisClass && latestEvaluationEntry && (
                                                                                    <div className="mt-4 space-y-3 rounded-lg border border-gray-200 bg-white p-4">
                                                                                        <div className="flex items-center justify-between gap-2">
                                                                                            <p className="text-sm font-semibold text-gray-900">Evaluation details</p>
                                                                                            <button
                                                                                                type="button"
                                                                                                onClick={() => {
                                                                                                    setViewingEvaluationBySwimmer((prev) => ({
                                                                                                        ...prev,
                                                                                                        [swimmer.id]: null,
                                                                                                    }));
                                                                                                }}
                                                                                                className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                                                                                            >
                                                                                                Close
                                                                                            </button>
                                                                                        </div>
                                                                                        <p className="mt-2 text-xs text-gray-500">
                                                                                            {latestEvaluationEntry.date} by {latestEvaluationEntry.instructor}
                                                                                        </p>
                                                                                        <EvaluationForm
                                                                                            swimmerId={swimmer.id}
                                                                                            skills={resolvedSkills}
                                                                                            classes={resolvedClasses}
                                                                                            initialClassId={classItem.id}
                                                                                            editingEvaluation={viewingEvaluation ?? undefined}
                                                                                            viewOnly
                                                                                            sessionEntries={(classSummary?.recentEntries ?? [])
                                                                                                .filter((entry) =>
                                                                                                    !latestEvaluationEntry?.date
                                                                                                        ? true
                                                                                                        : entry.date === latestEvaluationEntry.date,
                                                                                                )
                                                                                                .map((entry) => ({
                                                                                                    isSkillNote: entry.isSkillNote,
                                                                                                    skillName: entry.skillName,
                                                                                                    feedback: entry.feedback,
                                                                                                }))}
                                                                                        />
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>

                                                    {resolvedClasses.length === 0 ? (
                                                        <EvaluationForm
                                                            swimmerId={swimmer.id}
                                                            skills={resolvedSkills}
                                                            classes={resolvedClasses}
                                                            onDirtyChange={(dirty) => setEvaluationFormDirty(swimmer.id, dirty)}
                                                            onSubmissionComplete={() => {
                                                                setEvaluationFormDirty(swimmer.id, false);
                                                                consumeNeedsEvalSwimmer(swimmer.id);
                                                                setOpenSwimmerId((current) => (current === swimmer.id ? null : current));
                                                                void loadData(currentPage, debouncedSearchQuery, {
                                                                    forceRefresh: true,
                                                                });
                                                            }}
                                                        />
                                                    ) : null}
                                                </div>
                                            ) : (
                                                <div className="text-sm text-gray-500">No skills available for this swimmer.</div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {!isLoading && !error && !shouldVirtualize && totalFiltered > PAGE_SIZE && (
                    <div className="mt-6 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-gray-600 sm:text-sm">
                            Showing {(safeCurrentPage - 1) * PAGE_SIZE + 1}
                            {" - "}
                            {Math.min(safeCurrentPage * PAGE_SIZE, totalFiltered)}
                            {" of "}
                            {totalFiltered} swimmers
                        </p>
                        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                            <button
                                type="button"
                                disabled={safeCurrentPage <= 1 || isLoading}
                                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Previous
                            </button>
                            <span className="text-xs text-gray-600 sm:text-sm">
                                Page {safeCurrentPage} of {localTotalPages}
                            </span>
                            <input
                                type="number"
                                min={1}
                                max={localTotalPages}
                                value={pageInput}
                                onChange={(event) => setPageInput(event.target.value)}
                                onBlur={() => {
                                    const parsed = Number(pageInput);
                                    if (!Number.isFinite(parsed)) {
                                        setPageInput(String(safeCurrentPage));
                                        return;
                                    }

                                    const nextPage = Math.min(localTotalPages, Math.max(1, Math.floor(parsed)));
                                    setCurrentPage(nextPage);
                                }}
                                onKeyDown={(event) => {
                                    if (event.key !== "Enter") return;
                                    event.preventDefault();

                                    const parsed = Number(pageInput);
                                    if (!Number.isFinite(parsed)) {
                                        setPageInput(String(safeCurrentPage));
                                        return;
                                    }

                                    const nextPage = Math.min(localTotalPages, Math.max(1, Math.floor(parsed)));
                                    setCurrentPage(nextPage);
                                }}
                                className="w-16 rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm"
                                aria-label="Go to page"
                            />
                            <button
                                type="button"
                                disabled={safeCurrentPage >= localTotalPages || isLoading}
                                onClick={() => setCurrentPage((prev) => prev + 1)}
                                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}

                {!isLoading && !error && swimmersForRender.length === 0 && (
                    <div className="mt-4 py-6 text-sm text-gray-600">
                        {emptyStateText}
                    </div>
                )}
            </div>

            {deleteDialog.show && createPortal(
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 px-4">
                    <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-4 shadow-2xl">
                        <p className="text-sm font-semibold text-gray-900">Delete Evaluation Entry</p>
                        <p className="mt-1 text-xs text-gray-600 sm:text-sm">
                            Delete this evaluation for{" "}
                            <span className="font-medium">{deleteDialog.swimmerName}</span>
                            {deleteDialog.className ? (
                                <>
                                    {" "}in <span className="font-medium">{deleteDialog.className}</span>
                                </>
                            ) : null}
                            ?
                        </p>
                        <div className="mt-3 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() =>
                                    setDeleteDialog({
                                        show: false,
                                        swimmerId: null,
                                        classId: null,
                                        evaluationId: null,
                                        swimmerName: "",
                                        className: "",
                                    })
                                }
                                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 sm:text-sm"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={async () => {
                                    if (
                                        deleteDialog.swimmerId === null ||
                                        deleteDialog.classId === null ||
                                        deleteDialog.evaluationId === null
                                    )
                                        return;

                                    setDeletingEvaluationKey(`${deleteDialog.swimmerId}:${deleteDialog.classId}:${deleteDialog.evaluationId}`);

                                    const didDelete = await deleteEvaluationEntry({
                                        swimmerId: deleteDialog.swimmerId,
                                        classId: deleteDialog.classId,
                                        evaluationId: deleteDialog.evaluationId,
                                    });

                                    if (didDelete) {
                                        setDeleteDialog({
                                            show: false,
                                            swimmerId: null,
                                            classId: null,
                                            evaluationId: null,
                                            swimmerName: "",
                                            className: "",
                                        });
                                    }
                                }}
                                disabled={
                                    deleteDialog.swimmerId === null ||
                                    deleteDialog.classId === null ||
                                    deleteDialog.evaluationId === null ||
                                    deletingEvaluationKey === `${deleteDialog.swimmerId}:${deleteDialog.classId}:${deleteDialog.evaluationId}`
                                }
                                className="rounded-md bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
                            >
                                {deleteDialog.swimmerId !== null &&
                                    deleteDialog.classId !== null &&
                                    deleteDialog.evaluationId !== null &&
                                    deletingEvaluationKey === `${deleteDialog.swimmerId}:${deleteDialog.classId}:${deleteDialog.evaluationId}`
                                    ? "Deleting..."
                                    : "Delete"}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    )
}

