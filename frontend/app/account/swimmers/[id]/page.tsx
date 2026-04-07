/**
 * Parent swimmer detail page
 * Purpose: display swimmer details and session-based progress history for a parent view.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  createAuthenticatedHeaders,
  getAuthenticatedSessionIdentity,
} from "@/lib/clientAuth";

interface SwimmerDetail {
  id: string;
  name: string;
  age: number | null;
  level: string;
  enrollmentDate: string;
}

interface NoteItem {
  id: string;
  date: string;
  content: string;
  author: string;
}

interface SessionClass {
  id: string;
  name: string;
  schedule: string;
}

interface SessionSkill {
  id: string;
  name: string;
  mastered: boolean;
  progress: number;
  dateAcquired?: string;
  obtainedInSession?: boolean;
  notes?: NoteItem[];
}

interface SessionView {
  id: string;
  name: string;
  startDate?: string;
  endDate?: string;
  isCurrent: boolean;
  isSynthetic: boolean;
  classes: SessionClass[];
  skills: SessionSkill[];
  sessionNotes: NoteItem[];
  summary: {
    progressPct: number;
    masteredCount: number;
    totalSkills: number;
    noteCount: number;
  };
}

interface SwimmerPayload {
  swimmer: SwimmerDetail;
  sessions: SessionView[];
  defaultSessionId: string;
  error?: string;
}

interface DashboardCachePayload {
  swimmers: Array<{
    id: string;
    name: string;
    level: string;
  }>;
  profilesBySwimmer?: Record<string, SwimmerPayload>;
}

const SWIMMER_PROFILE_CACHE_PREFIX = "account-swimmer-profile-cache:v2:";
const DASHBOARD_CACHE_PREFIX = "account-dashboard-cache:";

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

function getSessionWindowLabel(session: SessionView | null) {
  if (!session) return "";
  if (session.startDate && session.endDate) {
    return `${session.startDate} - ${session.endDate}`;
  }
  if (session.endDate) {
    return `Through ${session.endDate}`;
  }
  if (session.startDate) {
    return `After ${session.startDate}`;
  }
  return "Current snapshot";
}

export default function ParentSwimmerDetail() {
  const router = useRouter();
  const params = useParams();
  const swimmerId = params.id as string;

  const [swimmer, setSwimmer] = useState<SwimmerDetail | null>(null);
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
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
            const cachedPayload = JSON.parse(cachedProfileRaw) as SwimmerPayload;
            if (isMounted && cachedPayload.swimmer) {
              setSwimmer(cachedPayload.swimmer);
              setSessions(cachedPayload.sessions ?? []);
              setSelectedSessionId(
                cachedPayload.defaultSessionId ??
                  cachedPayload.sessions?.[0]?.id ??
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
                setSessions(cachedProfile.sessions ?? []);
                setSelectedSessionId(
                  cachedProfile.defaultSessionId ??
                    cachedProfile.sessions?.[0]?.id ??
                    "",
                );
                const profileCacheKey = `${SWIMMER_PROFILE_CACHE_PREFIX}${identity.authUserId}:${swimmerId}`;
                sessionStorage.setItem(
                  profileCacheKey,
                  JSON.stringify(cachedProfile),
                );
                hasCachedData = true;
                setIsLoading(false);
              }

              if (hasCachedData) {
                return;
              }

              const cachedSwimmer = (dashboardCache.swimmers ?? []).find(
                (item) => item.id === swimmerId,
              );
              if (isMounted && cachedSwimmer) {
                setSwimmer({
                  id: cachedSwimmer.id,
                  name: cachedSwimmer.name,
                  level: cachedSwimmer.level,
                  age: null,
                  enrollmentDate: "",
                });
                setSessions([]);
                setSelectedSessionId("");
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
        setSessions(payload.sessions ?? []);
        setSelectedSessionId(payload.defaultSessionId ?? payload.sessions?.[0]?.id ?? "");
        sessionStorage.setItem(profileCacheKey, JSON.stringify(payload));
      } catch (fetchError) {
        if (!isMounted) return;

        const message =
          fetchError instanceof Error ? fetchError.message : "Unexpected error";
        if (!hasCachedData) {
          setError(message);
          setSwimmer(null);
          setSessions([]);
          setSelectedSessionId("");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadSwimmerData();

    return () => {
      isMounted = false;
    };
  }, [swimmerId]);

  const selectedSession = useMemo(() => {
    return (
      sessions.find((session) => session.id === selectedSessionId) ??
      sessions[0] ??
      null
    );
  }, [selectedSessionId, sessions]);

  const sessionSkills = selectedSession?.skills ?? [];
  const sessionNotes = selectedSession?.sessionNotes ?? [];
  const sessionClasses = selectedSession?.classes ?? [];
  const sessionSummary = selectedSession?.summary ?? {
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
                <h1 className="truncate text-lg font-semibold text-gray-900 sm:text-xl">
                  {swimmer?.name}
                </h1>
                <p className="text-xs text-gray-500">Parent View</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:space-y-6 sm:px-6 sm:py-8">
        <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                Swimmer Profile
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                Current swimmer details stay visible while you browse session
                history.
              </p>
            </div>
            <button
              onClick={() =>
                router.push(`/account/swimmers/${swimmerId}/certificate`)
              }
              className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
            >
              View Certificate
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-xs text-gray-500">Level</p>
              <p className="text-sm text-gray-900">{swimmer?.level}</p>
            </div>
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
              <p className="text-xs text-gray-500">Session Progress</p>
              <p className="text-sm font-semibold text-gray-900">
                {sessionSummary.progressPct}%
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900">
                Session History
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                Switch sessions without reloading. Each view shows notes dated
                inside that session and skill progress as of the session end.
              </p>
            </div>

            <div className="w-full lg:max-w-sm">
              <label
                htmlFor="session-select"
                className="mb-1 block text-xs font-medium text-gray-700"
              >
                Select session
              </label>
              <select
                id="session-select"
                value={selectedSession?.id ?? ""}
                onChange={(event) => setSelectedSessionId(event.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.name}
                    {session.isCurrent ? " (Current)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedSession && (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                    Window
                  </p>
                  <p className="mt-1 text-sm text-gray-900">
                    {getSessionWindowLabel(selectedSession)}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                    Skills Acquired
                  </p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">
                    {sessionSummary.masteredCount}/{sessionSummary.totalSkills}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                    Progress
                  </p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">
                    {sessionSummary.progressPct}%
                  </p>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                    Notes
                  </p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">
                    {sessionSummary.noteCount}
                  </p>
                </div>
              </div>

              <div className="mt-5">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-gray-900">
                    Classes in this session
                  </h4>
                  {selectedSession.isSynthetic && (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                      Current snapshot
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {sessionClasses.length > 0 ? (
                    sessionClasses.map((classItem) => (
                      <div
                        key={classItem.id}
                        className="rounded-full border border-gray-200 bg-gray-50 px-3 py-2"
                      >
                        <p className="text-xs font-medium text-gray-900">
                          {classItem.name}
                        </p>
                        <p className="text-[11px] text-gray-500">
                          {classItem.schedule}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-gray-500">
                      No classes are linked to this session yet.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Skills</h3>
              <p className="mt-1 text-xs text-gray-500">
                Skill progress is shown as it stood by the end of the selected
                session.
              </p>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-xs text-gray-500">Selected session</p>
              <p className="text-sm font-semibold text-gray-900">
                {selectedSession?.name ?? "No session selected"}
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {sessionSkills.map((skill) => {
              const skillNotes = skill.notes ?? [];

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
                          {skill.progress} -{" "}
                          {getProgressStageLabel(skill.progress)}
                        </span>
                        {skill.dateAcquired && (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
                            Obtained on {skill.dateAcquired}
                          </span>
                        )}
                        {skill.obtainedInSession && (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">
                            Obtained in this session
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-lg border border-gray-100 bg-white px-4 py-3">
                    <p className="text-xs font-semibold text-gray-700">
                      Notes for this skill
                    </p>
                    <div className="mt-3 space-y-3">
                      {skillNotes.length > 0 ? (
                        skillNotes.map((entry) => (
                          <div
                            key={entry.id}
                            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3"
                          >
                            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                              <span>{entry.author}</span>
                              <span>{entry.date}</span>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">
                              {entry.content}
                            </p>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-gray-500">
                          No notes for this skill in the selected session.
                        </p>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}

            {sessionSkills.length === 0 && (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
                No skills are available for this session yet.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
          <div>
            <h4 className="text-sm font-semibold text-gray-900">
              Session Notes
            </h4>
            <p className="mt-1 text-xs text-gray-500">
              General notes recorded during the selected session.
            </p>
          </div>

          <div className="mt-4 space-y-3">
            {sessionNotes.length > 0 ? (
              sessionNotes.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span>{entry.author}</span>
                    <span>{entry.date}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">
                    {entry.content}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500">
                No general session notes recorded for this session.
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
