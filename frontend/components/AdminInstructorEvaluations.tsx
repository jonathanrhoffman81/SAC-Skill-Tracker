"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import EvaluationForm from "@/components/EvaluationForm";
import DropdownButton from "@/components/DropdownButton";
import { createAuthenticatedHeaders } from "@/lib/clientAuth";

interface DashboardClass {
    id: string;
    name: string;
    schedule: string;
    startDate?: string;
    endDate?: string;
}

interface DashboardSkill {
    id: string;
    name: string;
    progress: 0 | 1 | 2 | 3 | 4;
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

function readPersistedState(): PersistedState | null {
    if (typeof window === "undefined") return null;

    try {
        const raw = window.sessionStorage.getItem(PERSISTED_STATE_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as PersistedState;
        if (!parsed?.savedAt) return null;
        if (parsed.version !== PERSISTED_STATE_VERSION) {
            window.sessionStorage.removeItem(PERSISTED_STATE_KEY);
            return null;
        }

        if (Date.now() - parsed.savedAt > PERSISTED_STATE_TTL_MS) {
            window.sessionStorage.removeItem(PERSISTED_STATE_KEY);
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}

function readPersistedData(): PersistedData | null {
    if (typeof window === "undefined") return null;

    try {
        const raw = window.sessionStorage.getItem(PERSISTED_DATA_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as PersistedData;
        if (!parsed?.savedAt) return null;
        if (parsed.version !== PERSISTED_STATE_VERSION) {
            window.sessionStorage.removeItem(PERSISTED_DATA_KEY);
            return null;
        }

        if (Date.now() - parsed.savedAt > PERSISTED_STATE_TTL_MS) {
            window.sessionStorage.removeItem(PERSISTED_DATA_KEY);
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
    const parsed = new Date(dateValue);
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

    const isActive = (!start || start <= today) && (!end || end >= today);
    const endedRecently = Boolean(end && end < today && end >= recentCutoff);

    return isActive || endedRecently;
}

function matchesClassStatusFilter(
    classItem: DashboardClass,
    statusFilter: "all" | "active" | "inactive",
) {
    if (statusFilter === "all") return true;

    const isCurrentOrRecent = isClassCurrentOrRecent(classItem.startDate, classItem.endDate);
    return statusFilter === "active" ? isCurrentOrRecent : !isCurrentOrRecent;
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
}: AdminInstructorEvaluationsProps) {
    const router = useRouter();
    const [openSwimmerId, setOpenSwimmerId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
    const [classFilter, setClassFilter] = useState("all");
    const [instructorFilter, setInstructorFilter] = useState(initialInstructorFilter ?? "all");
    const [groupFilter, setGroupFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">(initialStatusFilter);
    const [listView, setListView] = useState<"overview" | "active-classes" | "past-classes" | "recent-evals" | "my-swimmers" | "needs-evaluation">(initialListView);
    const [swimmers, setSwimmers] = useState<DashboardSwimmer[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageInput, setPageInput] = useState("1");
    const [isProficiencyScaleOpen, setIsProficiencyScaleOpen] = useState(false);
    const [activeEvaluationClassIdBySwimmer, setActiveEvaluationClassIdBySwimmer] = useState<Record<string, string | null>>({});
    const [editingEvaluationBySwimmer, setEditingEvaluationBySwimmer] = useState<Record<string, {
        evaluationId: string;
        classId: string;
        isSkillNote: boolean;
        skillId?: string;
        feedback?: string;
    } | null>>({});
    const [historyActionErrorBySwimmer, setHistoryActionErrorBySwimmer] = useState<Record<string, string>>({});
    const [deletingEvaluationKey, setDeletingEvaluationKey] = useState<string | null>(null);
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
    const virtualListContainerRef = useRef<HTMLDivElement | null>(null);
    const [virtualScrollTop, setVirtualScrollTop] = useState(0);
    const [virtualContainerHeight, setVirtualContainerHeight] = useState(720);

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

            window.sessionStorage.setItem(PERSISTED_DATA_KEY, JSON.stringify(payload));
        } catch {
            window.sessionStorage.removeItem(PERSISTED_DATA_KEY);
        }
    }

    function persistState(scrollYOverride?: number) {
        if (typeof window === "undefined") return;

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

            window.sessionStorage.setItem(PERSISTED_STATE_KEY, JSON.stringify(stateToPersist));
        } catch {
            window.sessionStorage.removeItem(PERSISTED_STATE_KEY);
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

            const headers = await createAuthenticatedHeaders();
            const response = await fetch(`/api/instructor/all-swimmers?${params.toString()}`, {
                headers,
            });
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
            const headers = await createAuthenticatedHeaders();
            const endpointCandidates = [
                "/api/instructor/filters",
                "/api/admin/instructor-member-assignments",
            ];

            let payload: (AssignmentFiltersPayload & { error?: string }) | null = null;
            let lastErrorMessage = "Failed to load class/instructor filter options.";

            for (const endpoint of endpointCandidates) {
                const response = await fetch(endpoint, { headers });
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
                    const label = fullName || instructor.label || instructor.email || "Instructor";
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
            if (typeof window !== "undefined") {
                window.sessionStorage.removeItem(PERSISTED_DATA_KEY);
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
        const restoredState = readPersistedState();
        const restoredData = readPersistedData();

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
    }, [initialInstructorFilter, initialListView, initialStatusFilter, lockInitialListView, lockInitialStatusFilter, restoreOpenSwimmerId]);

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
        setHistoryActionErrorBySwimmer((prev) => ({
            ...prev,
            [swimmerId]: "",
        }));
        setOpenSwimmerId((current) => (current === swimmerId ? null : swimmerId));
    };

    const deleteEvaluationEntry = async (args: {
        swimmerId: string;
        classId: string;
        evaluationId: string;
    }) => {
        if (!hasUsableEvaluationId(args.evaluationId)) {
            await loadData(currentPage, debouncedSearchQuery, {
                forceRefresh: true,
            });
            setHistoryActionErrorBySwimmer((prev) => ({
                ...prev,
                [args.swimmerId]: "This evaluation entry was out of sync. The list was refreshed; please try again.",
            }));
            return;
        }

        const confirmed = window.confirm("Delete this evaluation entry?");
        if (!confirmed) return;

        const deleteKey = `${args.swimmerId}:${args.classId}:${args.evaluationId}`;

        try {
            setDeletingEvaluationKey(deleteKey);
            setHistoryActionErrorBySwimmer((prev) => ({
                ...prev,
                [args.swimmerId]: "",
            }));

            const headers = await createAuthenticatedHeaders({
                "Content-Type": "application/json",
            });

            const response = await fetch(
                `/api/instructor/swimmers/${args.swimmerId}?evaluationId=${encodeURIComponent(args.evaluationId)}`,
                {
                method: "DELETE",
                headers,
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

            setEditingEvaluationBySwimmer((prev) => ({
                ...prev,
                [args.swimmerId]: prev[args.swimmerId]?.evaluationId === args.evaluationId
                    ? null
                    : prev[args.swimmerId],
            }));

            void loadData(currentPage, debouncedSearchQuery, {
                forceRefresh: true,
            }).catch((refreshError) => {
                console.warn("Failed to refresh evaluations after delete:", refreshError);
            });
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

    const swimmerNeedsEvaluation = (
        swimmer: DashboardSwimmer,
        options?: { requireMySwimmer?: boolean },
    ) => {
        if (options?.requireMySwimmer && !swimmer.isMySwimmer) return false;
        if (swimmer.hasCurrentInstructorEvaluation) return false;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const upcomingCutoff = new Date(today);
        upcomingCutoff.setDate(upcomingCutoff.getDate() + 3);

        const recentPastCutoff = new Date(today);
        recentPastCutoff.setDate(recentPastCutoff.getDate() - 14);

        return swimmer.classes.some((classItem) => {
            const endDate = toDateAtMidnight(classItem.endDate);
            if (!endDate) return false;
            return endDate >= recentPastCutoff && endDate <= upcomingCutoff;
        });
    };

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

    const instructorFilterOptions = useMemo(() => {
        const optionMap = new Map<string, string>();

        fallbackInstructorOptions.forEach((option) => {
            optionMap.set(option.value, option.label);
        });

        swimmers.forEach((swimmer) => {
            swimmer.evaluationSummary.instructors.forEach((instructorName) => {
                const normalized = instructorName.trim();
                if (!normalized || optionMap.has(normalized)) return;
                optionMap.set(normalized, normalized);
            });

            (swimmer.classEvaluations ?? []).forEach((classSummary) => {
                classSummary.instructors.forEach((instructorName) => {
                    const normalized = instructorName.trim();
                    if (!normalized || optionMap.has(normalized)) return;
                    optionMap.set(normalized, normalized);
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
    }, [fallbackGroupOptions]);

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

            if (statusFilter === "inactive" && swimmer.isActive !== false) {
                return false;
            }

            if (classFilter !== "all") {
                const hasSelectedClass = statusMatchedClasses.some((classItem) => classItem.id === classFilter);
                if (!hasSelectedClass) return false;
            }

            if (classFilter === "all" && statusFilter !== "all" && statusMatchedClasses.length === 0) {
                return false;
            }

            if (instructorFilter !== "all") {
                const memberIdsForInstructor = memberIdsByInstructorId[instructorFilter];
                const hasInstructorAssignment = memberIdsForInstructor?.has(swimmer.id) ?? false;
                const hasInstructorEvaluation =
                    swimmer.evaluationSummary.instructors.some(
                        (instructorName) => instructorName.trim() === instructorFilter,
                    ) ||
                    (swimmer.classEvaluations ?? []).some((classSummary) =>
                        classSummary.instructors.some(
                            (instructorName) => instructorName.trim() === instructorFilter,
                        ),
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
                                const closestClass = [...swimmer.classes]
                                    .filter((classItem) => toDateAtMidnight(classItem.endDate))
                                    .sort((a, b) => {
                                        const aTime = toDateAtMidnight(a.endDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
                                        const bTime = toDateAtMidnight(b.endDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
                                        return aTime - bTime;
                                    })[0];

                                return (
                                    <button
                                        key={`needs-eval:${swimmer.id}`}
                                        type="button"
                                        onClick={() => handleSwimmerClick(swimmer.id)}
                                        className="rounded-lg border border-blue-200 bg-white px-4 py-3 text-left transition hover:border-blue-300 hover:bg-blue-50"
                                    >
                                        <p className="text-sm font-semibold text-gray-900">{swimmer.name}</p>
                                        <p className="mt-1 text-xs text-gray-600">
                                            {closestClass?.name ?? "Class"} ends {formatDateLabel(closestClass?.endDate)}
                                        </p>
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
                <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
                    <button
                        type="button"
                        onClick={() => setIsProficiencyScaleOpen((current) => !current)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left sm:px-5"
                    >
                        <div>
                            <p className="text-sm font-semibold text-gray-900">Proficiency Scale</p>
                            <p className="mt-1 text-xs text-gray-500">
                                Reference guide for the 0 to 4 evaluation ratings.
                            </p>
                        </div>
                        <svg
                            className={`h-5 w-5 flex-shrink-0 text-gray-500 transition-transform ${isProficiencyScaleOpen ? "rotate-180" : ""}`}
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

                    {isProficiencyScaleOpen && (
                        <div className="border-t border-gray-100 px-4 py-4 sm:px-5">
                            <ul className="space-y-2">
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
                        </div>
                    )}
                </div>
            )}

            <div className="relative overflow-visible rounded-xl border border-gray-200 bg-white p-4 sm:p-6 shadow-sm">
                <div className="mb-4 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:p-4">
                    <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900">{listViewTitle}</p>
                        {isLoading && (
                            <span className="inline-flex h-4 w-4 animate-spin rounded-full border-b-2 border-blue-600" aria-label="Loading" />
                        )}
                    </div>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                        <div className="space-y-1 lg:col-span-2">
                            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Search</p>
                            <input
                                type="text"
                                placeholder="Search swimmers..."
                                value={searchQuery}
                                onChange={(event) => {
                                    setSearchQuery(event.target.value);
                                    setCurrentPage(1);
                                }}
                                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        <div className="space-y-1">
                            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">View</p>
                            <DropdownButton
                                value={listView}
                                onChange={(value) => {
                                    setListView(value as "overview" | "active-classes" | "past-classes" | "recent-evals" | "my-swimmers" | "needs-evaluation");
                                    setCurrentPage(1);
                                }}
                                ui="app"
                                options={[
                                    { value: "overview", label: "All swimmers" },
                                    { value: "needs-evaluation", label: "Needs evaluation" },
                                    { value: "my-swimmers", label: "My swimmers" },
                                    { value: "active-classes", label: "Active classes" },
                                    { value: "past-classes", label: "Past classes" },
                                    { value: "recent-evals", label: "Recent evaluations" },
                                ]}
                                ariaLabel="Select swimmer list view"
                            />
                        </div>

                        <div className="space-y-1">
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

                        <div className="space-y-1">
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

                        <div className="space-y-1">
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

                        <div className="space-y-1">
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
                                    className="w-full p-5 text-left transition hover:bg-gray-50 sm:p-6"
                                    onClick={() => handleSwimmerClick(swimmer.id)}
                                >
                                    <div className="flex items-start justify-between gap-4">
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
                                                            router.push(`/instructor/swimmers/${swimmer.id}?returnTo=${encodeURIComponent("/admin/dashboard?tab=evaluations")}`);
                                                        }}
                                                    >
                                                        View full history
                                                    </button>
                                                </div>
                                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                                    <span>
                                                        {mastered}/{totalSkills} skills mastered
                                                    </span>
                                                    <span>Avg proficiency: {avgProficiency}%</span>
                                                    {activeClasses.map((classItem) => (
                                                        <span
                                                            key={classItem.id}
                                                            className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700"
                                                        >
                                                            {classItem.name}
                                                        </span>
                                                    ))}
                                                    {pastClasses.map((classItem) => (
                                                        <span
                                                            key={`past:${classItem.id}`}
                                                            className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600"
                                                        >
                                                            {classItem.name}
                                                        </span>
                                                    ))}
                                                </div>
                                                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                                                    <span>Active classes: {activeClasses.length}</span>
                                                    <span>Past classes: {pastClasses.length}</span>
                                                    <span>Evaluations: {swimmer.evaluationSummary.evaluationCount}</span>
                                                    <span>
                                                        Last eval: {swimmer.evaluationSummary.lastEvaluationDate || "N/A"}
                                                    </span>
                                                    <span>
                                                        Instructors: {swimmer.evaluationSummary.instructors.length > 0
                                                            ? swimmer.evaluationSummary.instructors.join(", ")
                                                            : "N/A"}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        <svg
                                            className={`h-5 w-5 flex-shrink-0 transform text-gray-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
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
                                            <div className="space-y-5">
                                                <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
                                                    <div>
                                                        <h3 className="text-sm font-semibold text-gray-900">
                                                            Classes
                                                        </h3>
                                                    </div>

                                                    <div className="mt-4 space-y-3">
                                                        {resolvedClasses.map((classItem) => {
                                                            const classSummary = classEvaluationSummaryById.get(classItem.id);
                                                            const isSelectedForEvaluation = selectedEvaluationClassId === classItem.id;

                                                            return (
                                                                <div
                                                                    key={classItem.id}
                                                                    className={`rounded-xl border p-4 transition ${isSelectedForEvaluation
                                                                        ? "border-blue-200 bg-blue-50/60"
                                                                        : "border-gray-200 bg-gray-50"
                                                                        }`}
                                                                >
                                                                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                                                        <div className="min-w-0 flex-1">
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

                                                                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                                                                <span>{getClassWindowLabel(classItem)}</span>
                                                                                <span>{classItem.schedule || "Schedule TBD"}</span>
                                                                            </div>

                                                                            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                                                                                <span>
                                                                                    Last evaluation: {classSummary?.lastEvaluationDate || "None yet"}
                                                                                </span>
                                                                                <span>
                                                                                    Instructors: {classSummary?.instructors?.length
                                                                                        ? classSummary.instructors.join(", ")
                                                                                        : "No instructor note recorded yet"}
                                                                                </span>
                                                                                <span>
                                                                                    Entries: {classSummary?.evaluationCount ?? 0}
                                                                                </span>
                                                                            </div>

                                                                            {classSummary?.recentEntries?.length ? (
                                                                                <div className="mt-4 rounded-lg border border-gray-200 bg-white px-4 py-3">
                                                                                    <div className="flex items-center justify-between gap-3">
                                                                                        <p className="text-xs font-semibold text-gray-700">
                                                                                            Evaluation History
                                                                                        </p>
                                                                                        <p className="text-[11px] text-gray-500">
                                                                                            {classItem.name} · {getClassWindowLabel(classItem)}
                                                                                        </p>
                                                                                    </div>

                                                                                    <div className="mt-3 space-y-3">
                                                                                        {classSummary.recentEntries.slice(0, 2).map((entry) => (
                                                                                            <div
                                                                                                key={entry.evaluationId}
                                                                                                className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-3"
                                                                                            >
                                                                                                <div className="flex items-start justify-between gap-3">
                                                                                                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                                                                                        <span>{entry.date}</span>
                                                                                                        <span>by {entry.instructor}</span>
                                                                                                        <span className={`rounded-full px-2 py-0.5 ${entry.isSkillNote
                                                                                                            ? "bg-blue-100 text-blue-700"
                                                                                                            : "bg-slate-100 text-slate-700"
                                                                                                            }`}>
                                                                                                            {entry.isSkillNote
                                                                                                                ? entry.skillName
                                                                                                                    ? `${entry.skillName} note`
                                                                                                                    : "Skill note"
                                                                                                                : "Class note"}
                                                                                                        </span>
                                                                                                    </div>
                                                                                                    <div className="flex items-center gap-3">
                                                                                                        <button
                                                                                                            type="button"
                                                                                                            onClick={async () => {
                                                                                                                if (!hasUsableEvaluationId(entry.evaluationId)) {
                                                                                                                    await loadData(currentPage, debouncedSearchQuery, {
                                                                                                                        forceRefresh: true,
                                                                                                                    });
                                                                                                                    setHistoryActionErrorBySwimmer((prev) => ({
                                                                                                                        ...prev,
                                                                                                                        [swimmer.id]: "This evaluation entry was out of sync. The list was refreshed; please try again.",
                                                                                                                    }));
                                                                                                                    return;
                                                                                                                }
                                                                                                                setActiveEvaluationClassIdBySwimmer((prev) => ({
                                                                                                                    ...prev,
                                                                                                                    [swimmer.id]: null,
                                                                                                                }));
                                                                                                                setEditingEvaluationBySwimmer((prev) => ({
                                                                                                                    ...prev,
                                                                                                                    [swimmer.id]: {
                                                                                                                        evaluationId: entry.evaluationId,
                                                                                                                        classId: classItem.id,
                                                                                                                        isSkillNote: entry.isSkillNote,
                                                                                                                        skillId: entry.isSkillNote
                                                                                                                            ? resolvedSkills.find((skill) => skill.name === entry.skillName)?.id
                                                                                                                            : undefined,
                                                                                                                        feedback: entry.feedback,
                                                                                                                    },
                                                                                                                }));
                                                                                                                setHistoryActionErrorBySwimmer((prev) => ({
                                                                                                                    ...prev,
                                                                                                                    [swimmer.id]: "",
                                                                                                                }));
                                                                                                            }}
                                                                                                            className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
                                                                                                        >
                                                                                                            Edit
                                                                                                        </button>
                                                                                                        <button
                                                                                                            type="button"
                                                                                                            disabled={deletingEvaluationKey === `${swimmer.id}:${classItem.id}:${entry.evaluationId}`}
                                                                                                            onClick={() => void deleteEvaluationEntry({
                                                                                                                swimmerId: swimmer.id,
                                                                                                                classId: classItem.id,
                                                                                                                evaluationId: entry.evaluationId,
                                                                                                            })}
                                                                                                            className="text-xs font-medium text-red-600 hover:text-red-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                                                                                                        >
                                                                                                            {deletingEvaluationKey === `${swimmer.id}:${classItem.id}:${entry.evaluationId}` ? "Deleting..." : "Delete"}
                                                                                                        </button>
                                                                                                    </div>
                                                                                                </div>
                                                                                                <p className="mt-2 text-sm text-gray-700">
                                                                                                    {entry.feedback?.trim() || "No note text recorded."}
                                                                                                </p>
                                                                                            </div>
                                                                                        ))}

                                                                                        {classSummary.recentEntries.length > 2 && (
                                                                                            <details className="group">
                                                                                                <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-700">
                                                                                                    <span className="group-open:hidden">
                                                                                                        Show {classSummary.recentEntries.length - 2} older entry
                                                                                                        {classSummary.recentEntries.length - 2 === 1 ? "" : "s"}
                                                                                                    </span>
                                                                                                    <span className="hidden group-open:inline">
                                                                                                        Hide older entries
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
                                                                                                    {classSummary.recentEntries.slice(2).map((entry) => (
                                                                                                        <div
                                                                                                            key={entry.evaluationId}
                                                                                                            className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-3"
                                                                                                        >
                                                                                                            <div className="flex items-start justify-between gap-3">
                                                                                                                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                                                                                                    <span>{entry.date}</span>
                                                                                                                    <span>by {entry.instructor}</span>
                                                                                                                    <span className={`rounded-full px-2 py-0.5 ${entry.isSkillNote
                                                                                                                        ? "bg-blue-100 text-blue-700"
                                                                                                                        : "bg-slate-100 text-slate-700"
                                                                                                                        }`}>
                                                                                                                        {entry.isSkillNote
                                                                                                                            ? entry.skillName
                                                                                                                                ? `${entry.skillName} note`
                                                                                                                                : "Skill note"
                                                                                                                            : "Class note"}
                                                                                                                    </span>
                                                                                                                </div>
                                                                                                                <div className="flex items-center gap-3">
                                                                                                                    <button
                                                                                                                        type="button"
                                                                                                                        onClick={async () => {
                                                                                                                            if (!hasUsableEvaluationId(entry.evaluationId)) {
                                                                                                                                await loadData(currentPage, debouncedSearchQuery, {
                                                                                                                                    forceRefresh: true,
                                                                                                                                });
                                                                                                                                setHistoryActionErrorBySwimmer((prev) => ({
                                                                                                                                    ...prev,
                                                                                                                                    [swimmer.id]: "This evaluation entry was out of sync. The list was refreshed; please try again.",
                                                                                                                                }));
                                                                                                                                return;
                                                                                                                            }
                                                                                                                            setActiveEvaluationClassIdBySwimmer((prev) => ({
                                                                                                                                ...prev,
                                                                                                                                [swimmer.id]: null,
                                                                                                                            }));
                                                                                                                            setEditingEvaluationBySwimmer((prev) => ({
                                                                                                                                ...prev,
                                                                                                                                [swimmer.id]: {
                                                                                                                                    evaluationId: entry.evaluationId,
                                                                                                                                    classId: classItem.id,
                                                                                                                                    isSkillNote: entry.isSkillNote,
                                                                                                                                    skillId: entry.isSkillNote
                                                                                                                                        ? resolvedSkills.find((skill) => skill.name === entry.skillName)?.id
                                                                                                                                        : undefined,
                                                                                                                                    feedback: entry.feedback,
                                                                                                                                },
                                                                                                                            }));
                                                                                                                            setHistoryActionErrorBySwimmer((prev) => ({
                                                                                                                                ...prev,
                                                                                                                                [swimmer.id]: "",
                                                                                                                            }));
                                                                                                                        }}
                                                                                                                        className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
                                                                                                                    >
                                                                                                                        Edit
                                                                                                                    </button>
                                                                                                                    <button
                                                                                                                        type="button"
                                                                                                                        disabled={deletingEvaluationKey === `${swimmer.id}:${classItem.id}:${entry.evaluationId}`}
                                                                                                                        onClick={() => void deleteEvaluationEntry({
                                                                                                                            swimmerId: swimmer.id,
                                                                                                                            classId: classItem.id,
                                                                                                                            evaluationId: entry.evaluationId,
                                                                                                                        })}
                                                                                                                        className="text-xs font-medium text-red-600 hover:text-red-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                                                                                                                    >
                                                                                                                        {deletingEvaluationKey === `${swimmer.id}:${classItem.id}:${entry.evaluationId}` ? "Deleting..." : "Delete"}
                                                                                                                    </button>
                                                                                                                </div>
                                                                                                            </div>
                                                                                                            <p className="mt-2 text-sm text-gray-700">
                                                                                                                {entry.feedback?.trim() || "No note text recorded."}
                                                                                                            </p>
                                                                                                        </div>
                                                                                                    ))}
                                                                                                </div>
                                                                                            </details>
                                                                                        )}
                                                                                    </div>
                                                                                </div>
                                                                            ) : (
                                                                                <div className="mt-4 rounded-lg border border-dashed border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
                                                                                    No recorded evaluation history for this class yet.
                                                                                </div>
                                                                            )}
                                                                        </div>

                                                                        <div className="flex w-full flex-col gap-2 lg:w-auto lg:min-w-[190px]">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => {
                                                                                    setActiveEvaluationClassIdBySwimmer((prev) => ({
                                                                                        ...prev,
                                                                                        [swimmer.id]: classItem.id,
                                                                                    }));
                                                                                }}
                                                                                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
                                                                            >
                                                                                {classSummary ? "Add Another Evaluation" : "Add Evaluation"}
                                                                            </button>
                                                                            {isSelectedForEvaluation && (
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => {
                                                                                        setActiveEvaluationClassIdBySwimmer((prev) => ({
                                                                                            ...prev,
                                                                                            [swimmer.id]: null,
                                                                                        }));
                                                                                        setHistoryActionErrorBySwimmer((prev) => ({
                                                                                            ...prev,
                                                                                            [swimmer.id]: "",
                                                                                        }));
                                                                                    }}
                                                                                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                                                                                >
                                                                                    Close Form
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>

                                                {historyActionErrorBySwimmer[swimmer.id] && !editingEvaluationBySwimmer[swimmer.id] && (
                                                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                                        {historyActionErrorBySwimmer[swimmer.id]}
                                                    </div>
                                                )}

                                                {editingEvaluationClass && editingEvaluation ? (
                                                    <div className="space-y-3">
                                                        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                                                            <p className="text-sm font-semibold text-blue-900">
                                                                Edit evaluation for {editingEvaluationClass.name}
                                                            </p>
                                                            <p className="mt-1 text-xs text-blue-800">
                                                                This opens the full evaluation form with the selected history entry loaded for editing.
                                                            </p>
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
                                                            initialClassId={editingEvaluation.classId}
                                                            editingEvaluation={editingEvaluation}
                                                            onSubmissionComplete={async () => {
                                                                await loadData(currentPage, debouncedSearchQuery, {
                                                                    forceRefresh: true,
                                                                });
                                                                setEditingEvaluationBySwimmer((prev) => ({
                                                                    ...prev,
                                                                    [swimmer.id]: null,
                                                                }));
                                                                setOpenSwimmerId((current) => (current === swimmer.id ? null : current));
                                                            }}
                                                        />
                                                    </div>
                                                ) : selectedEvaluationClass ? (
                                                    <div className="space-y-3">
                                                        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                                                            <p className="text-sm font-semibold text-blue-900">
                                                                New evaluation for {selectedEvaluationClass.name}
                                                            </p>
                                                            <p className="mt-1 text-xs text-blue-800">
                                                                The class selector is preloaded so the note and skill updates save against this class.
                                                            </p>
                                                        </div>
                                                        <EvaluationForm
                                                            swimmerId={swimmer.id}
                                                            skills={resolvedSkills}
                                                            classes={resolvedClasses}
                                                            initialClassId={selectedEvaluationClass.id}
                                                            onSubmissionComplete={async () => {
                                                                await loadData(currentPage, debouncedSearchQuery, {
                                                                    forceRefresh: true,
                                                                });
                                                                setActiveEvaluationClassIdBySwimmer((prev) => ({
                                                                    ...prev,
                                                                    [swimmer.id]: null,
                                                                }));
                                                                setOpenSwimmerId((current) => (current === swimmer.id ? null : current));
                                                            }}
                                                        />
                                                    </div>
                                                ) : resolvedClasses.length === 0 ? (
                                                    <EvaluationForm
                                                        swimmerId={swimmer.id}
                                                        skills={resolvedSkills}
                                                        classes={resolvedClasses}
                                                        onSubmissionComplete={async () => {
                                                            await loadData(currentPage, debouncedSearchQuery, {
                                                                forceRefresh: true,
                                                            });
                                                            setOpenSwimmerId((current) => (current === swimmer.id ? null : current));
                                                        }}
                                                    />
                                                ) : (
                                                    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">
                                                        Choose a class or history entry above to open the evaluation form.
                                                    </div>
                                                )}
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
                        <div className="flex items-center gap-2">
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
                    <div className="mt-6 rounded-lg border border-gray-200 bg-white px-4 py-6 text-sm text-gray-600">
                        {emptyStateText}
                    </div>
                )}
            </div>
        </div>
    );
}
