"use client";
// Proficiency descriptions for each progress value
const PROFICIENCY_LABELS: Record<SkillProgress, string> = {
  0: "Unable to attempt the skill",
  1: "Unable to demonstrate skill without significant support",
  2: "Inconsistently able to demonstrate the skill",
  3: "Consistently able to demonstrate of the skill",
  4: "Demonstrates complete understanding of the skill",
};
/**
 * Swimm/Adult Swimmer dashboard page
 * Purpose: overview dashboard focused on swimmer progress and skill-level updates.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createAuthenticatedHeaders,
  getAuthenticatedSessionIdentity,
  logoutAndRedirect,
} from "@/lib/clientAuth";

type SkillProgress = 0 | 1 | 2 | 3 | 4;

const SKILL_PROGRESS_STEPS: SkillProgress[] = [0, 1, 2, 3, 4];

const DASHBOARD_CACHE_PREFIX = "account-dashboard-cache:v5:";
const SWIMMER_PROFILE_CACHE_PREFIX = "account-swimmer-profile-cache:v5:";

interface SwimmerCard {
  id: string;
  name: string;
  nextClass: string;
  classIds: string[];
  isActive: boolean;
}

interface SkillItem {
  id: string;
  name: string;
  progress: SkillProgress;
  mastered?: boolean;
  dateAcquired?: string;
  progressHistory?: Array<{
    id: string;
    date: string;
    progress: number;
    dateAcquired?: string;
  }>;
  notes?: Array<{
    id: string;
    author: string;
    content: string;
    date: string;
  }>;
}

interface DashboardPayload {
  userName: string;
  organizationName?: string;
  swimmers: Array<
    Omit<SwimmerCard, "classIds" | "isActive"> & {
      classIds?: string[];
      isActive?: boolean;
    }
  >;
  skillsBySwimmer: Record<string, SkillItem[]>;
  profilesBySwimmer?: Record<
    string,
    {
      swimmer: {
        id: string;
        name: string;
        age: number | null;
        enrollmentDate: string;
        organization: string;
      };
      classHistories: Array<{
        id: string;
        classId: string | null;
        name: string;
        schedule: string;
        startDate?: string;
        endDate?: string;
        isCurrent: boolean;
        isGeneral: boolean;
        skills: SkillItem[];
        classNotes: Array<{
          id: string;
          author: string;
          content: string;
          date: string;
        }>;
        summary: {
          progressPct: number;
          masteredCount: number;
          totalSkills: number;
          noteCount: number;
        };
      }>;
      defaultClassHistoryId: string;
    }
  >;
}

function SkillNoteCard({
  note,
}: {
  note: { id: string; author: string; content: string; date: string };
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-2 py-2">
      <p className="text-[11px] text-gray-500">
        {note.date} by {note.author}
      </p>
      <p className="mt-1 text-xs text-gray-700">{note.content}</p>
    </div>
  );
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getProgressBadgeClasses(progress: SkillProgress) {
  switch (progress) {
    case 4:
      return "bg-emerald-100 text-emerald-700";
    case 3:
      return "bg-blue-100 text-blue-700";
    case 2:
      return "bg-amber-100 text-amber-700";
    case 1:
      return "bg-orange-100 text-orange-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

export default function AccountDashboard() {
  const router = useRouter();
  const [userName, setUserName] = useState("Guest User");
  const [organizationName, setOrganizationName] = useState("SAC Skill Tracker");
  const [openSwimmerIds, setOpenSwimmerIds] = useState<string[]>([]);
  const [swimmers, setSwimmers] = useState<SwimmerCard[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [skillsBySwimmer, setSkillsBySwimmer] = useState<
    Record<string, SkillItem[]>
  >({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    function normalizeSkillsBySwimmer(
      skillsBySwimmer?: DashboardPayload["skillsBySwimmer"],
    ) {
      return Object.fromEntries(
        Object.entries(skillsBySwimmer ?? {}).map(([swimmerId, skills]) => [
          swimmerId,
          (skills ?? []).map((skill) => ({
            ...skill,
            // progress is already 0-4, mastered is set by backend
          })),
        ]),
      ) as Record<string, SkillItem[]>;
    }

    function seedProfileCaches(authUserId: string, payload: DashboardPayload) {
      Object.entries(payload.profilesBySwimmer ?? {}).forEach(
        ([memberId, profile]) => {
          const profileCacheKey = `${SWIMMER_PROFILE_CACHE_PREFIX}${authUserId}:${memberId}`;
          sessionStorage.setItem(profileCacheKey, JSON.stringify(profile));
        },
      );
    }

    function applyPayload(payload: DashboardPayload, fallbackName: string) {
      setUserName(payload.userName || fallbackName);
      setOrganizationName(payload.organizationName || "SAC Skill Tracker");
      setSwimmers(
        (payload.swimmers ?? []).map((swimmer) => ({
          ...swimmer,
          classIds: swimmer.classIds ?? [],
          // Default missing isActive to true so pre-migration caches still render.
          isActive: swimmer.isActive ?? true,
        })),
      );
      setSkillsBySwimmer(normalizeSkillsBySwimmer(payload.skillsBySwimmer));
    }

    async function loadDashboardData() {
      let hasCachedData = false;

      try {
        setIsLoading(true);
        setError("");
        const identity = await getAuthenticatedSessionIdentity();
        const localName = identity.displayName || "Guest User";

        setUserName(localName);

        const cacheKey = `${DASHBOARD_CACHE_PREFIX}${identity.authUserId}`;
        const cachedRaw = sessionStorage.getItem(cacheKey);
        if (cachedRaw) {
          try {
            const cachedPayload = JSON.parse(cachedRaw) as DashboardPayload;
            if (isMounted) {
              applyPayload(cachedPayload, localName);
              hasCachedData = true;
              setIsLoading(false);
            }
          } catch {
            sessionStorage.removeItem(cacheKey);
          }
        }

        // Fetch all parent dashboard data in one request.
        const headers = await createAuthenticatedHeaders();
        const response = await fetch("/api/account/dashboard", { headers });
        const payload = (await response.json()) as DashboardPayload & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || "Failed to load dashboard data.");
        }

        if (!isMounted) return;

        applyPayload(payload, localName);
        sessionStorage.setItem(cacheKey, JSON.stringify(payload));
        seedProfileCaches(identity.authUserId, payload);
      } catch (fetchError) {
        if (!isMounted) return;
        const message =
          fetchError instanceof Error ? fetchError.message : "Unexpected error";
        if (!hasCachedData) {
          setError(message);
          setSwimmers([]);
          setSkillsBySwimmer({});
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadDashboardData();

    return () => {
      isMounted = false;
    };
  }, []);

  const uniqueSwimmers = useMemo(() => {
    const deduped = new Map<string, SwimmerCard>();
    swimmers.forEach((swimmer) => {
      if (!deduped.has(swimmer.id)) {
        deduped.set(swimmer.id, swimmer);
      }
    });
    return Array.from(deduped.values());
  }, [swimmers]);

  const activeSwimmers = useMemo(
    () => uniqueSwimmers.filter((s) => s.isActive),
    [uniqueSwimmers],
  );
  const inactiveSwimmers = useMemo(
    () => uniqueSwimmers.filter((s) => !s.isActive),
    [uniqueSwimmers],
  );
  const visibleSwimmers = useMemo(
    () => (showInactive ? uniqueSwimmers : activeSwimmers),
    [showInactive, uniqueSwimmers, activeSwimmers],
  );

  useEffect(() => {
    if (activeSwimmers.length === 0) {
      setOpenSwimmerIds([]);
    }
    // Otherwise leave openSwimmerIds as-is — all swimmer cards start collapsed;
    // parents expand the ones they want to view.
  }, [activeSwimmers]);

  useEffect(() => {
    async function fetchLogo() {
      try {
        // const identity = await getAuthenticatedSessionIdentity();
        const identity = await getAuthenticatedSessionIdentity();
        console.log("IDENTITY:", identity);
        // const orgId = identity.organizationId;

        // const res = await fetch(
        //   `/api/public/get-logo?orgId=${encodeURIComponent("123")}`,
        // );

        // const data = await res.json();

        // if (data.publicUrl) {
        //   setLogoUrl(data.publicUrl);
        // } else {
        //   setLogoUrl(null);
        // }
      } catch (err) {
        console.error("Failed to fetch logo", err);
        setLogoUrl(null);
      }
    }

    fetchLogo();
  }, []);

  function getOverallPct(skills: SkillItem[]) {
    if (skills.length === 0) return 0;
    return Math.round(
      (skills.reduce((sum, skill) => sum + skill.progress, 0) /
        (skills.length * 4)) *
      100,
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-3 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100 sm:h-9 sm:w-9 sm:rounded-xl">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Organization Logo"
                  className="h-full w-full object-cover"
                />
              ) : (
                <svg
                  className="h-4 w-4 text-gray-500 sm:h-5 sm:w-5"
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
                Parent Dashboard
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden text-right md:block">
              <p className="text-sm font-medium text-gray-900">
                {userName || "Guest User"}
              </p>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                Parent
              </span>
            </div>
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-800 text-[10px] font-semibold text-white sm:h-9 sm:w-9 sm:text-xs">
              {userName ? getInitials(userName) : "GU"}
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

      <main className="mx-auto max-w-7xl space-y-2 px-3 py-4 sm:space-y-6 sm:px-6 sm:py-8">
        {/* Loading Banner */}
        {isLoading && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4 flex items-center gap-2 sm:gap-3">
            <div className="animate-spin rounded-full h-4 w-4 sm:h-5 sm:w-5 border-b-2 border-green-600 flex-shrink-0"></div>
            <p className="text-xs sm:text-sm text-blue-800">
              Loading dashboard data...
            </p>
          </div>
        )}

        {/* Error Banner */}
        {!isLoading && error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 sm:p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 sm:gap-3 min-w-0 flex-1">
                <svg
                  className="w-4 h-4 sm:w-5 sm:h-5 text-red-600 mt-0.5 flex-shrink-0"
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
                  <p className="text-xs sm:text-sm font-medium text-red-800">
                    Failed to load data
                  </p>
                  <p className="text-[10px] sm:text-xs text-red-700 mt-0.5 sm:mt-1 break-words">
                    {error}
                  </p>
                </div>
              </div>
              <button
                onClick={() => window.location.reload()}
                className="text-[10px] sm:text-xs bg-red-100 hover:bg-red-200 text-red-800 px-2 sm:px-3 py-1 sm:py-1.5 rounded-md transition-colors whitespace-nowrap flex-shrink-0"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* My Swimmers Section */}
        <section>
          <div className="mb-4 flex items-center justify-between gap-3">
            <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold">
              My Swimmers
            </span>
            {inactiveSwimmers.length > 0 && (
              <button
                type="button"
                onClick={() => setShowInactive((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                {showInactive
                  ? `Hide ${inactiveSwimmers.length} inactive`
                  : `Show ${inactiveSwimmers.length} inactive`}
              </button>
            )}
          </div>

          <div className="space-y-4">
            {visibleSwimmers.map((swimmer) => {
              const skills = skillsBySwimmer[swimmer.id] || [];
              const acquiredCount = skills.filter(
                (s) => s.progress === 4,
              ).length;
              const pct = getOverallPct(skills);
              const isOpen = openSwimmerIds.includes(swimmer.id);

              return (
                <div
                  key={swimmer.id}
                  className={`overflow-hidden rounded-xl border bg-white shadow-sm ${
                    swimmer.isActive
                      ? "border-gray-200"
                      : "border-gray-200 opacity-75"
                  }`}
                >
                  <button
                    className="w-full p-4 text-left transition hover:bg-gray-50 sm:p-6"
                    onClick={() =>
                      setOpenSwimmerIds((current) =>
                        current.includes(swimmer.id)
                          ? current.filter((id) => id !== swimmer.id)
                          : [...current, swimmer.id],
                      )
                    }
                  >
                    <div className="flex items-start justify-between gap-3 sm:gap-4">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-700">
                          {getInitials(swimmer.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                            <p className="break-words text-sm font-semibold text-gray-900">
                              {swimmer.name}
                            </p>
                            {!swimmer.isActive && (
                              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                                Inactive
                              </span>
                            )}
                            <span
                              role="button"
                              tabIndex={0}
                              className="cursor-pointer text-[11px] font-medium text-blue-600 hover:text-blue-700 hover:underline"
                              onClick={(event) => {
                                event.stopPropagation();
                                router.push(`/account/swimmers/${swimmer.id}`);
                              }}
                              onKeyDown={(event) => {
                                if (
                                  event.key === "Enter" ||
                                  event.key === " "
                                ) {
                                  event.stopPropagation();
                                  router.push(
                                    `/account/swimmers/${swimmer.id}`,
                                  );
                                }
                              }}
                            >
                              View full profile
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                            <span>
                              {acquiredCount}/{skills.length} skills acquired
                            </span>
                            <span>{pct}% complete</span>
                            <span className="inline-flex max-w-full rounded-2xl bg-gray-100 px-2.5 py-1 text-[10px] leading-tight text-gray-600">
                              {swimmer.nextClass}
                            </span>
                            {swimmer.classIds.length === 0 && (
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">
                                Direct assignment only
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <svg
                        className={`h-5 w-5 flex-shrink-0 transform text-gray-500 transition-transform ${isOpen ? "rotate-180" : ""
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

                  {isOpen && (
                    <div className="border-t border-gray-100 p-5 sm:p-6">
                      <div>
                        <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
                          <span>Overall Progress</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                          <div
                            className="h-full bg-blue-600"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        {swimmer.classIds.length === 0 && (
                          <p className="mt-2 rounded px-2 py-1 text-xs text-amber-700 border border-amber-200 bg-amber-50">
                            No class enrollment linked to this swimmer record.
                          </p>
                        )}
                      </div>

                      <div className="mt-4">
                        <p className="mb-2 text-xs font-medium text-gray-500">
                          Skills
                        </p>
                        <div className="space-y-2">
                          {skills.length === 0 && (
                            <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                              No skills are attached to this member record yet.
                            </p>
                          )}
                          {skills.map((skill) => {
                            const skillNotes = skill.notes ?? [];

                            return (
                              <div
                                key={skill.id}
                                className="rounded-lg border border-gray-100 px-3 py-3"
                              >
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                  <span className="min-w-0 break-words text-xs text-gray-700 sm:max-w-[40%]">
                                    {skill.name}
                                  </span>
                                  <div className="flex min-w-0 flex-col items-start gap-2 sm:items-end">
                                    {skill.dateAcquired && (
                                      <span className="text-[11px] leading-tight text-gray-500">
                                        Updated: {skill.dateAcquired}
                                      </span>
                                    )}
                                    <span
                                      className={`inline-flex max-w-full rounded-2xl px-2.5 py-1 text-[11px] font-medium leading-tight ${getProgressBadgeClasses(skill.progress)}`}
                                      title={
                                        PROFICIENCY_LABELS[
                                        skill.progress as SkillProgress
                                        ]
                                      }
                                    >
                                      {skill.progress} -{" "}
                                      {
                                        PROFICIENCY_LABELS[
                                        skill.progress as SkillProgress
                                        ]
                                      }
                                    </span>
                                  </div>
                                </div>

                                {skillNotes.length > 0 && (
                                  <div className="mt-2 space-y-2">
                                    <SkillNoteCard note={skillNotes[0]} />
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
                                        <div className="mt-2 space-y-2">
                                          {skillNotes.slice(1).map((note) => (
                                            <SkillNoteCard key={note.id} note={note} />
                                          ))}
                                        </div>
                                      </details>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {!isLoading && !error && uniqueSwimmers.length === 0 && (
            <div className="mt-6 rounded-lg border border-gray-200 bg-white px-4 py-6 text-sm text-gray-600">
              No linked swimmers found for this account yet.
            </div>
          )}
        </section>

        {/* Proficiency Rating for Parents */}
        <section className="pt-2">
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 pt-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-900">
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
        </section>
      </main>
    </div>
  );
}
