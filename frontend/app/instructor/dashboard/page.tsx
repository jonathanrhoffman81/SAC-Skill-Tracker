/**
 * SAC/Instructor dashboard page
 * Purpose: overview dashboard focused on instructor roster and skill evaluation.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import EvaluationForm from "@/components/EvaluationForm";
import {
  createAuthenticatedHeaders,
  logoutAndRedirect,
} from "@/lib/clientAuth";

interface DashboardClass {
  id: string;
  name: string;
  schedule: string;
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
  userName: string;
  organizationName?: string;
  organizationLogoUrl: string | null;
  swimmers: DashboardSwimmer[];
  pagination?: PaginationState;
  error?: string;
}

interface CachedDashboardEntry {
  userName: string;
  organizationName: string;
  organizationLogoUrl: string | null;
  swimmers: DashboardSwimmer[];
  pagination: PaginationState;
}

const PAGE_SIZE = 25;

function buildCacheKey(tab: "my" | "all", page: number, search: string) {
  return `${tab}|${page}|${search.toLowerCase()}`;
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
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

export default function InstructorDashboard() {
  const [organizationLogo, setOrganizationLogo] = useState<string | null>(null);
  const router = useRouter();
  const [userName, setUserName] = useState("Guest User");
  const [organizationName, setOrganizationName] = useState("SAC Skill Tracker");
  const [swimmerTab, setSwimmerTab] = useState<"my" | "all">("my");
  const [openSwimmerId, setOpenSwimmerId] = useState<string | null>(null);
  const [isInstructionsOpen, setIsInstructionsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [swimmers, setSwimmers] = useState<DashboardSwimmer[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const cacheRef = useRef<Map<string, CachedDashboardEntry>>(new Map());

  async function loadDashboardData(
    tab?: "my" | "all",
    page?: number,
    search?: string,
    options?: { forceRefresh?: boolean },
  ) {
    const activeTab = tab || swimmerTab;
    const activePage = page || currentPage;
    const activeSearch = search ?? debouncedSearchQuery;
    const cacheKey = buildCacheKey(activeTab, activePage, activeSearch);

    if (!options?.forceRefresh) {
      const cached = cacheRef.current.get(cacheKey);
      if (cached) {
        setError("");
        setUserName((prev) => cached.userName || prev);
        setOrganizationName(cached.organizationName || "SAC Skill Tracker");
        setSwimmers(cached.swimmers);
        setPagination(cached.pagination);
        setOrganizationLogo(cached.organizationLogoUrl);
        setIsLoading(false);
        return;
      }
    }

    try {
      setIsLoading(true);
      setError("");

      const endpoint =
        activeTab === "all"
          ? "/api/instructor/all-swimmers"
          : "/api/instructor/dashboard";
      const params = new URLSearchParams({
        page: String(activePage),
        pageSize: String(PAGE_SIZE),
      });
      if (activeSearch) {
        params.set("q", activeSearch);
      }

      const headers = await createAuthenticatedHeaders();
      const response = await fetch(`${endpoint}?${params.toString()}`, {
        headers,
      });
      const payload = (await response.json()) as DashboardPayload;

      if (!response.ok) {
        throw new Error(
          payload.error || "Failed to load instructor dashboard data.",
        );
      }

      const resolvedUserName = payload.userName || userName;
      const resolvedOrganizationName =
        payload.organizationName || "SAC Skill Tracker";
      const resolvedSwimmers = payload.swimmers ?? [];
      const resolvedPagination = payload.pagination ?? {
        page: activePage,
        pageSize: PAGE_SIZE,
        total: resolvedSwimmers.length,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: activePage > 1,
      };

      setUserName((prev) => resolvedUserName || prev);
      setOrganizationName(resolvedOrganizationName);
      setSwimmers(resolvedSwimmers);
      setPagination(resolvedPagination);
      setOrganizationLogo(payload.organizationLogoUrl ?? null);

      cacheRef.current.set(cacheKey, {
        userName: resolvedUserName,
        organizationName: resolvedOrganizationName,
        organizationLogoUrl: payload.organizationLogoUrl ?? null,
        swimmers: resolvedSwimmers,
        pagination: resolvedPagination,
      });

      if (resolvedPagination.page !== activePage) {
        setCurrentPage(resolvedPagination.page);
      }

      // Warm opposite tab page 1 for instant tab switching after initial load.
      if (!activeSearch && activePage === 1) {
        const oppositeTab: "my" | "all" = activeTab === "my" ? "all" : "my";
        const oppositeCacheKey = buildCacheKey(oppositeTab, 1, "");

        if (!cacheRef.current.has(oppositeCacheKey)) {
          const oppositeEndpoint =
            oppositeTab === "all"
              ? "/api/instructor/all-swimmers"
              : "/api/instructor/dashboard";
          const oppositeParams = new URLSearchParams({
            page: "1",
            pageSize: String(PAGE_SIZE),
          });

          fetch(`${oppositeEndpoint}?${oppositeParams.toString()}`, { headers })
            .then(async (prefetchResponse) => {
              if (!prefetchResponse.ok) return;
              const prefetchPayload =
                (await prefetchResponse.json()) as DashboardPayload;
              const prefetchSwimmers = prefetchPayload.swimmers ?? [];
              const prefetchPagination = prefetchPayload.pagination ?? {
                page: 1,
                pageSize: PAGE_SIZE,
                total: prefetchSwimmers.length,
                totalPages: 1,
                hasNextPage: false,
                hasPreviousPage: false,
              };

              cacheRef.current.set(oppositeCacheKey, {
                userName: prefetchPayload.userName || resolvedUserName,
                organizationName:
                  prefetchPayload.organizationName || "SAC Skill Tracker",
                organizationLogoUrl: payload.organizationLogoUrl ?? null,
                swimmers: prefetchSwimmers,
                pagination: prefetchPagination,
              });
            })
            .catch(() => {
              // Ignore prefetch failures; normal fetch path still covers this.
            });
        }
      }
    } catch (fetchError) {
      const message =
        fetchError instanceof Error
          ? fetchError.message
          : "Unexpected error loading dashboard.";
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
    const handle = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 250);

    return () => window.clearTimeout(handle);
  }, [searchQuery]);

  useEffect(() => {
    loadDashboardData(swimmerTab, currentPage, debouncedSearchQuery);
  }, [swimmerTab, currentPage, debouncedSearchQuery]);

  const handleSwimmerClick = (swimmerId: string) => {
    setOpenSwimmerId((current) => (current === swimmerId ? null : swimmerId));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-3 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100 sm:h-9 sm:w-9 sm:rounded-xl">
              {organizationLogo ? (
                <img
                  src={organizationLogo}
                  alt="Organization Logo"
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <svg
                  className="h-4 w-4 text-gray-600 sm:h-5 sm:w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-gray-900 sm:text-sm">
                {organizationName}
              </p>
              <p className="hidden text-[10px] text-gray-500 sm:block sm:text-xs">
                Instructor Dashboard
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden text-right md:block">
              <p className="text-sm font-medium text-gray-900">
                {userName || "Guest User"}
              </p>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                Instructor
              </span>
            </div>
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-800 text-[10px] font-semibold text-white sm:h-9 sm:w-9 sm:text-xs">
              {getInitials(userName)}
            </div>
            <button
              onClick={async () => {
                await logoutAndRedirect("/login");
              }}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 sm:h-9 sm:w-9"
            >
              <svg
                className="h-4 w-4 sm:h-5 sm:w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-3 py-4 sm:space-y-6 sm:px-6 sm:py-8">
        {isLoading && (
          <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 sm:gap-3 sm:p-4">
            <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-blue-600 sm:h-5 sm:w-5" />
            <p className="text-xs text-blue-800 sm:text-sm">
              Loading instructor dashboard...
            </p>
          </div>
        )}

        {!isLoading && error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 sm:p-4">
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
                    Failed to load dashboard
                  </p>
                  <p className="mt-0.5 break-words text-[10px] text-red-700 sm:mt-1 sm:text-xs">
                    {error}
                  </p>
                </div>
              </div>
              <button
                onClick={() =>
                  loadDashboardData(undefined, undefined, undefined, {
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

        {!isLoading && !error && (
          <div className="rounded-lg border border-blue-200 bg-blue-50">
            <button
              onClick={() => setIsInstructionsOpen(!isInstructionsOpen)}
              className="w-full p-4 text-left transition hover:bg-blue-100 sm:p-6"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-gray-900">
                  Proficiency Rating Instructions
                </p>
                <svg
                  className={`h-5 w-5 flex-shrink-0 transform text-gray-600 transition-transform ${
                    isInstructionsOpen ? "rotate-180" : ""
                  }`}
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

            {isInstructionsOpen && (
              <div className="border-t border-blue-200 px-4 py-4 sm:px-6 sm:py-5">
                <p className="text-sm text-gray-700">
                  For each of the skills listed, provide a proficiency rating and
                  comments for the student's progress. To evaluate a swimmer, click
                  on their row to see the dropdown evaluation form.
                </p>

                <div className="mt-4">
                  <p className="text-xs font-semibold text-gray-900 uppercase tracking-wide">
                    Proficiency Scale
                  </p>
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
                      <span>
                        Inconsistently or with support is able to demonstrate the
                        skill
                      </span>
                    </li>
                    <li className="flex gap-3 text-sm text-gray-700">
                      <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                        3
                      </span>
                      <span>
                        Consistently demonstrates application of the skill
                      </span>
                    </li>
                    <li className="flex gap-3 text-sm text-gray-700">
                      <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                        4
                      </span>
                      <span>Demonstrates complete understanding of the skill</span>
                    </li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}

        <section>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex items-center rounded-full border border-gray-200 bg-white p-1">
              <button
                onClick={() => {
                  setSwimmerTab("my");
                  setCurrentPage(1);
                  setOpenSwimmerId(null);
                }}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  swimmerTab === "my"
                    ? "bg-blue-100 text-blue-700"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                My Swimmers
              </button>
              <button
                onClick={() => {
                  setSwimmerTab("all");
                  setCurrentPage(1);
                  setOpenSwimmerId(null);
                }}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  swimmerTab === "all"
                    ? "bg-blue-100 text-blue-700"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                All Swimmers
              </button>
            </div>
            <div className="w-full max-w-xs">
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
          </div>

          <div className="space-y-4">
            {swimmers.map((swimmer) => {
              const mastered = swimmer.skills.filter(
                (skill) => skill.mastered,
              ).length;
              const avgProficiency = calculateAverageProficiency(
                swimmer.skills,
              );
              const isOpen = openSwimmerId === swimmer.id;

              return (
                <div
                  key={swimmer.id}
                  className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
                >
                  <button
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
                                router.push(
                                  `/instructor/swimmers/${swimmer.id}`,
                                );
                              }}
                            >
                              View full profile
                            </button>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                            <span>
                              {mastered}/{swimmer.skills.length} skills mastered
                            </span>
                            <span>Avg proficiency: {avgProficiency}%</span>
                            {swimmer.classes.map((classItem) => (
                              <span
                                key={classItem.id}
                                className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600"
                              >
                                {classItem.name}
                              </span>
                            ))}
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
                      <EvaluationForm
                        swimmerId={swimmer.id}
                        skills={swimmer.skills}
                        classes={swimmer.classes}
                        onSubmissionComplete={() =>
                          loadDashboardData(
                            swimmerTab,
                            currentPage,
                            debouncedSearchQuery,
                            { forceRefresh: true },
                          )
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {!isLoading && !error && pagination.total > PAGE_SIZE && (
            <div className="mt-6 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-gray-600 sm:text-sm">
                Showing {(pagination.page - 1) * pagination.pageSize + 1}
                {" - "}
                {Math.min(
                  pagination.page * pagination.pageSize,
                  pagination.total,
                )}
                {" of "}
                {pagination.total} swimmers
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!pagination.hasPreviousPage || isLoading}
                  onClick={() =>
                    setCurrentPage((prev) => Math.max(1, prev - 1))
                  }
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="text-xs text-gray-600 sm:text-sm">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <button
                  type="button"
                  disabled={!pagination.hasNextPage || isLoading}
                  onClick={() => setCurrentPage((prev) => prev + 1)}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {!isLoading && !error && swimmers.length === 0 && (
            <div className="mt-6 rounded-lg border border-gray-200 bg-white px-4 py-6 text-sm text-gray-600">
              No swimmers found.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
