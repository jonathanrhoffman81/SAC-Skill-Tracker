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
}

interface AdminInstructorEvaluationsProps {
    initialFilters?: InitialEvaluationFilters;
    initialListView?: "overview" | "active-classes" | "past-classes" | "recent-evals" | "my-swimmers";
    lockInitialListView?: boolean;
    initialStatusFilter?: "all" | "active" | "inactive";
    lockInitialStatusFilter?: boolean;
}

interface SwimmerDetailPayload {
    classes: DashboardClass[];
    skills: DashboardSkill[];
    error?: string;
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
const PERSISTED_STATE_VERSION = 4;

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
    listView: "overview" | "active-classes" | "past-classes" | "recent-evals" | "my-swimmers";
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
    initialStatusFilter = "all",
    lockInitialStatusFilter = false,
}: AdminInstructorEvaluationsProps) {
    const router = useRouter();
    const [openSwimmerId, setOpenSwimmerId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
    const [classFilter, setClassFilter] = useState("all");
    const [instructorFilter, setInstructorFilter] = useState("all");
    const [groupFilter, setGroupFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">(initialStatusFilter);
    const [listView, setListView] = useState<"overview" | "active-classes" | "past-classes" | "recent-evals" | "my-swimmers">(initialListView);
    const [swimmers, setSwimmers] = useState<DashboardSwimmer[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
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
    const [detailBySwimmerId, setDetailBySwimmerId] = useState<
        Record<string, { classes: DashboardClass[]; skills: DashboardSkill[]; loading: boolean; error?: string }>
    >({});
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

            const payload: PersistedData = {
                version: PERSISTED_STATE_VERSION,
                savedAt: Date.now(),
                searchKey,
                swimmers,
                fallbackClassOptions,
                fallbackInstructorOptions,
                fallbackGroupOptions,
                memberIdsByGroupId: serializedMemberIdsByGroupId,
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
            // Try instructor endpoint first, fall back to admin endpoint
            let response = await fetch("/api/instructor/filters", { headers });
            
            if (!response.ok && response.status === 404) {
                response = await fetch("/api/admin/instructor-member-assignments", { headers });
            }
            
            const payload = (await response.json()) as AssignmentFiltersPayload & { error?: string };

            if (!response.ok) {
                throw new Error(payload.error || "Failed to load class/instructor filter options.");
            }

            const classMap = new Map<string, string>();
            const groupMap = new Map<string, string>();
            const enrollmentMap: Record<string, Set<string>> = {};
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

            const instructorList = (payload.instructors ?? [])
                .map((instructor) => {
                    const fullName = `${instructor.first_name ?? ""} ${instructor.last_name ?? ""}`.trim();
                    const label = fullName || instructor.label || instructor.email || "Instructor";
                    return label.trim();
                })
                .filter((label) => Boolean(label));

            setFallbackClassOptions(
                Array.from(classMap.entries())
                    .map(([value, label]) => ({ value, label }))
                    .sort((a, b) => a.label.localeCompare(b.label)),
            );

            setFallbackInstructorOptions(
                Array.from(new Set(instructorList))
                    .sort((a, b) => a.localeCompare(b))
                    .map((label) => ({ value: label, label })),
            );

            setFallbackGroupOptions(
                Array.from(groupMap.entries())
                    .map(([value, label]) => ({ value, label }))
                    .sort((a, b) => a.label.localeCompare(b.label)),
            );

            setMemberIdsByGroupId(enrollmentMap);
        } catch {
            setFallbackClassOptions([]);
            setFallbackInstructorOptions([]);
            setFallbackGroupOptions([]);
            setMemberIdsByGroupId({});
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
            setOpenSwimmerId(restoredState.openSwimmerId);
            setSearchQuery(restoredState.searchQuery);
            setDebouncedSearchQuery(restoredState.debouncedSearchQuery);
            setClassFilter(restoredState.classFilter ?? "all");
            setInstructorFilter(restoredState.instructorFilter ?? "all");
            setGroupFilter(restoredState.groupFilter ?? "all");
            setStatusFilter(lockInitialStatusFilter ? initialStatusFilter : (restoredState.statusFilter ?? initialStatusFilter));
            setListView(lockInitialListView ? initialListView : (restoredState.listView ?? initialListView));
            setCurrentPage(restoredState.currentPage || 1);

            if (typeof restoredState.scrollY === "number" && restoredState.scrollY > 0) {
                pendingRestoredScrollYRef.current = restoredState.scrollY;
                suppressAutoFocusRef.current = true;
            }
        }

        if (restoredData) {
            setSwimmers(restoredData.swimmers ?? []);
            setFallbackClassOptions(restoredData.fallbackClassOptions ?? []);
            setFallbackInstructorOptions(restoredData.fallbackInstructorOptions ?? []);
            setFallbackGroupOptions(restoredData.fallbackGroupOptions ?? []);

            const hydratedMemberIdsByGroupId = Object.fromEntries(
                Object.entries(restoredData.memberIdsByGroupId ?? {}).map(([groupId, memberIds]) => [
                    groupId,
                    new Set(memberIds),
                ]),
            ) as Record<string, Set<string>>;

            setMemberIdsByGroupId(hydratedMemberIdsByGroupId);
            allSearchCacheRef.current.set(
                buildSearchCacheKey(restoredData.searchKey ?? restoredState?.debouncedSearchQuery ?? ""),
                restoredData.swimmers ?? [],
            );
            setIsLoading(false);
        }

        setHasRestoredState(true);
    }, []);

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
        listView,
        swimmers,
        currentPage,
        pagination,
        detailBySwimmerId,
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
    ]);

    const loadSwimmerDetail = async (swimmerId: string, forceRefresh = false) => {
        const existing = detailBySwimmerId[swimmerId];
        if (!forceRefresh && existing?.skills?.length) return;

        setDetailBySwimmerId((prev) => ({
            ...prev,
            [swimmerId]: {
                classes: prev[swimmerId]?.classes ?? [],
                skills: prev[swimmerId]?.skills ?? [],
                loading: true,
                error: undefined,
            },
        }));

        try {
            const headers = await createAuthenticatedHeaders();
            const response = await fetch(`/api/instructor/swimmers/${swimmerId}`, { headers });
            const payload = (await response.json()) as SwimmerDetailPayload;

            if (!response.ok) {
                throw new Error(payload.error || "Failed to load swimmer details.");
            }

            setDetailBySwimmerId((prev) => ({
                ...prev,
                [swimmerId]: {
                    classes: payload.classes ?? [],
                    skills: payload.skills ?? [],
                    loading: false,
                    error: undefined,
                },
            }));

            setSwimmers((prev) => prev.map((swimmer) => {
                if (swimmer.id !== swimmerId) return swimmer;

                const resolvedSkills = payload.skills ?? [];
                const masteredSkills = resolvedSkills.filter((skill) => skill.mastered).length;
                const averageProficiency = resolvedSkills.length > 0
                    ? Math.round(
                        resolvedSkills.reduce(
                            (total, skill) => total + progressToPercent(skill.progress),
                            0,
                        ) / resolvedSkills.length,
                    )
                    : 0;

                return {
                    ...swimmer,
                    classes: payload.classes ?? swimmer.classes,
                    skillSummary: {
                        totalSkills: resolvedSkills.length,
                        masteredSkills,
                        averageProficiency,
                    },
                };
            }));
        } catch (loadError) {
            const message =
                loadError instanceof Error
                    ? loadError.message
                    : "Failed to load swimmer details.";

            setDetailBySwimmerId((prev) => ({
                ...prev,
                [swimmerId]: {
                    classes: prev[swimmerId]?.classes ?? [],
                    skills: prev[swimmerId]?.skills ?? [],
                    loading: false,
                    error: message,
                },
            }));
        }
    };

    const handleSwimmerClick = async (swimmerId: string) => {
        const willOpen = openSwimmerId !== swimmerId;
        setOpenSwimmerId((current) => (current === swimmerId ? null : swimmerId));

        if (!willOpen) return;

        await loadSwimmerDetail(swimmerId);
    };

    const applyOptimisticEvaluationPatch = (swimmerId: string) => {
        const now = formatDateForSummary(new Date());

        setSwimmers((prev) => prev.map((swimmer) => {
            if (swimmer.id !== swimmerId) return swimmer;

            return {
                ...swimmer,
                evaluationSummary: {
                    ...swimmer.evaluationSummary,
                    evaluationCount: (swimmer.evaluationSummary.evaluationCount ?? 0) + 1,
                    lastEvaluationDate: now,
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

    const emptyStateText = useMemo(() => {
        if (debouncedSearchQuery) {
            return "No swimmers found for this search.";
        }

        if (classFilter !== "all" || instructorFilter !== "all" || groupFilter !== "all") {
            return "No swimmers match the selected class/instructor/group filters.";
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

        if (listView === "my-swimmers") {
            return "No swimmers assigned to you found.";
        }

        return "No swimmers found.";
    }, [debouncedSearchQuery, classFilter, instructorFilter, groupFilter, listView]);

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
        const instructors = new Set<string>();

        swimmers.forEach((swimmer) => {
            (swimmer.evaluationSummary.instructors ?? []).forEach((name) => {
                const normalized = name.trim();
                if (normalized) {
                    instructors.add(normalized);
                }
            });
        });

        const options = Array.from(instructors)
            .sort((a, b) => a.localeCompare(b))
            .map((name) => ({ value: name, label: name }));

        fallbackInstructorOptions.forEach((option) => {
            if (!instructors.has(option.value)) {
                options.push(option);
            }
        });

        options.sort((a, b) => a.label.localeCompare(b.label));

        if (options.length === 0) {
            return [
                { value: "all", label: "All instructors" },
                { value: "__empty_instructors", label: "No instructors available", disabled: true },
            ];
        }

        return [{ value: "all", label: "All instructors" }, ...options];
    }, [swimmers, fallbackInstructorOptions]);

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
                const hasSelectedClass = swimmer.classes.some((classItem) => classItem.id === classFilter);
                if (!hasSelectedClass) return false;
            }

            if (instructorFilter !== "all") {
                const hasSelectedInstructor = (swimmer.evaluationSummary.instructors ?? []).some(
                    (instructorName) => instructorName === instructorFilter,
                );
                if (!hasSelectedInstructor) return false;
            }

            if (groupFilter !== "all") {
                const memberIdsForGroup = memberIdsByGroupId[groupFilter];
                if (!memberIdsForGroup?.has(swimmer.id)) {
                    return false;
                }
            }

            return true;
        });

        const sorted = [...filtered].sort((a, b) => {
            {
                const aDate = a.evaluationSummary.lastEvaluationDate
                    ? new Date(a.evaluationSummary.lastEvaluationDate).getTime()
                    : 0;
                const bDate = b.evaluationSummary.lastEvaluationDate
                    ? new Date(b.evaluationSummary.lastEvaluationDate).getTime()
                    : 0;
                if (bDate !== aDate) return bDate - aDate;
            }

            return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        });

        return sorted;
    }, [classFilter, instructorFilter, groupFilter, listView, memberIdsByGroupId, statusFilter, swimmers]);

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
    const listViewTitle = listView === "my-swimmers" ? "My Swimmers" : "All Swimmers";

    return (
        <div className="w-full min-h-[60vh] space-y-4">
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
                                    setListView(value as "overview" | "active-classes" | "past-classes" | "recent-evals" | "my-swimmers");
                                    setCurrentPage(1);
                                }}
                                ui="app"
                                options={[
                                    { value: "overview", label: "All swimmers" },
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
                        const detail = detailBySwimmerId[swimmer.id];
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
                                        {detail?.loading ? (
                                            <div className="text-sm text-gray-500">Loading swimmer evaluation details...</div>
                                        ) : detail?.error ? (
                                            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                                {detail.error}
                                            </div>
                                        ) : detail?.skills?.length ? (
                                            <EvaluationForm
                                                swimmerId={swimmer.id}
                                                skills={detail.skills}
                                                classes={detail.classes}
                                                onSubmissionComplete={async () => {
                                                    applyOptimisticEvaluationPatch(swimmer.id);
                                                    await loadSwimmerDetail(swimmer.id, true);
                                                }}
                                            />
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
