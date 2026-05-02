/**
 * Instructor swimmer detail page
 * Purpose: full profile view for a single swimmer, aligned to the parent-style profile layout.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { authFetch, SessionExpiredError } from "@/lib/clientAuth";

interface SwimmerDetail {
  id: string;
  name: string;
  age: number | null;
  enrollmentDate: string;
  organization: string;
  isActive: boolean;
  headerAccentColor?: string | null;
  guardianName: string;
  guardianEmail: string;
  guardianRelationship: string;
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

type ClassGroup = { label: string; items: ClassHistoryView[] };
const DEFAULT_HEADER_ACCENT_COLOR = "#ffffff";

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
  if (progress === 1) {
    return "Demonstrates the skill only with significant support";
  }
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

function getClassDropdownLabel(classHistory: ClassHistoryView) {
  if (classHistory.isGeneral) return classHistory.name;
  const window = getClassWindowLabel(classHistory);
  const suffix = classHistory.isCurrent ? " · Current" : "";
  return window ? `${classHistory.name} · ${window}${suffix}` : classHistory.name;
}

function groupClassHistories(
  classHistories: ClassHistoryView[],
  todayIso: string,
): ClassGroup[] {
  const active: ClassHistoryView[] = [];
  const upcoming: ClassHistoryView[] = [];
  const undated: ClassHistoryView[] = [];
  const general: ClassHistoryView[] = [];
  const pastByYear = new Map<string, ClassHistoryView[]>();

  classHistories.forEach((classHistory) => {
    if (classHistory.isGeneral) {
      general.push(classHistory);
      return;
    }
    if (classHistory.isCurrent) {
      active.push(classHistory);
      return;
    }
    if (classHistory.startDateIso && classHistory.startDateIso > todayIso) {
      upcoming.push(classHistory);
      return;
    }

    const yearSource = classHistory.endDateIso ?? classHistory.startDateIso;
    if (!yearSource) {
      undated.push(classHistory);
      return;
    }

    const year = yearSource.slice(0, 4);
    const bucket = pastByYear.get(year) ?? [];
    bucket.push(classHistory);
    pastByYear.set(year, bucket);
  });

  const groups: ClassGroup[] = [];
  if (active.length) groups.push({ label: "Active", items: active });
  if (upcoming.length) groups.push({ label: "Upcoming", items: upcoming });

  Array.from(pastByYear.keys())
    .sort((a, b) => b.localeCompare(a))
    .forEach((year) => {
      groups.push({ label: year, items: pastByYear.get(year) ?? [] });
    });

  if (undated.length) groups.push({ label: "Undated", items: undated });
  if (general.length) groups.push({ label: "General", items: general });

  return groups;
}

function NoteLine({ note }: { note: NoteItem }) {
  return (
    <div className="border-l-2 border-gray-200 pl-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
        <span className="font-medium text-gray-600">{note.author}</span>
        <span aria-hidden>·</span>
        <span>{note.date}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{note.content}</p>
    </div>
  );
}

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

export default function InstructorSwimmerDetailPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const swimmerId = params.id as string;
  const returnTo = searchParams.get("returnTo");

  const [swimmer, setSwimmer] = useState<SwimmerDetail | null>(null);
  const [classHistories, setClassHistories] = useState<ClassHistoryView[]>([]);
  const [selectedClassHistoryId, setSelectedClassHistoryId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const navigateBack = () => {
    const fallback = "/instructor/dashboard";

    if (!returnTo) {
      router.replace(fallback, { scroll: false });
      return;
    }

    try {
      const url = new URL(returnTo, window.location.origin);
      router.replace(`${url.pathname}${url.search}`, { scroll: false });
    } catch {
      router.replace(fallback, { scroll: false });
    }
  };

  useEffect(() => {
    let isMounted = true;

    async function loadSwimmerData() {
      try {
        setIsLoading(true);
        setError("");

        const response = await authFetch(`/api/instructor/swimmers/${swimmerId}`);
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
      } catch (fetchError) {
        if (!isMounted) return;
        if (fetchError instanceof SessionExpiredError) return;
        const message =
          fetchError instanceof Error ? fetchError.message : "Unexpected error";
        setError(message);
        setSwimmer(null);
        setClassHistories([]);
        setSelectedClassHistoryId("");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadSwimmerData();
    return () => {
      isMounted = false;
    };
  }, [swimmerId]);

  const selectedClassHistory = useMemo(
    () =>
      classHistories.find((item) => item.id === selectedClassHistoryId) ??
      classHistories[0] ??
      null,
    [classHistories, selectedClassHistoryId],
  );

  const classHistoryGroups = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    return groupClassHistories(classHistories, todayIso);
  }, [classHistories]);

  const masteredSkills = useMemo(() => {
    const skillMap = new Map<string, { id: string; name: string; dateAcquired: string }>();

    classHistories.forEach((classHistory) => {
      classHistory.skills.forEach((skill) => {
        const isMastered = skill.progress === 4 || Boolean(skill.dateAcquired);
        if (!isMastered) return;

        const existing = skillMap.get(skill.id);
        if (
          !existing ||
          (!existing.dateAcquired && skill.dateAcquired) ||
          (existing.dateAcquired &&
            skill.dateAcquired &&
            new Date(skill.dateAcquired) < new Date(existing.dateAcquired))
        ) {
          skillMap.set(skill.id, {
            id: skill.id,
            name: skill.name,
            dateAcquired: skill.dateAcquired ?? "",
          });
        }
      });
    });

    return Array.from(skillMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [classHistories]);

  const classSkills = selectedClassHistory?.skills ?? [];
  const classNotes = selectedClassHistory?.classNotes ?? [];
  const classSummary = selectedClassHistory?.summary ?? {
    progressPct: 0,
    masteredCount: 0,
    totalSkills: 0,
    noteCount: 0,
  };
  const resolvedHeaderAccentColor =
    swimmer?.headerAccentColor ?? DEFAULT_HEADER_ACCENT_COLOR;

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
          <p className="text-sm text-red-700">{error || "Swimmer not found."}</p>
          <button
            onClick={navigateBack}
            className="mt-4 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: resolvedHeaderAccentColor }}
    >
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6">
          <div className="flex items-center gap-4">
            <button
              onClick={navigateBack}
              className="-ml-2 rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
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
                <p className="text-xs text-gray-500">Instructor View</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:space-y-6 sm:px-6 sm:py-8">
        {swimmer && !swimmer.isActive && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-800">This swimmer is inactive</p>
            <p className="mt-1 text-xs text-amber-700">
              {swimmer.name || "This swimmer"} is no longer active. Past class history, notes, and
              skill progress remain viewable below.
            </p>
          </div>
        )}

        {/* Swimmer Profile */}
        <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Swimmer Profile</h3>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-xs text-gray-500">Age</p>
              <p className="text-sm text-gray-900">{swimmer?.age ?? "Not available"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Enrollment Date</p>
              <p className="text-sm text-gray-900">{swimmer?.enrollmentDate || "Not available"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Class Progress</p>
              <p className="text-sm font-semibold text-gray-900">{classSummary.progressPct}%</p>
            </div>
          </div>

          {masteredSkills.length > 0 && (
            <details className="group mt-8">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-700">
                <span>Completed Skills ({masteredSkills.length})</span>
                <ChevronIcon className="h-3 w-3" />
              </summary>
              <div className="mt-3 flex flex-wrap gap-2">
                {masteredSkills.map((skill) => (
                  <div
                    key={skill.id}
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700"
                  >
                    {skill.name}
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>

        {/* Class Activity */}
        <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900">Class activity</h3>
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
                onChange={(event) => setSelectedClassHistoryId(event.target.value)}
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
                {classHistoryGroups.length === 0 && <option value="">No classes available</option>}
              </select>
            </div>
          </div>

          {selectedClassHistory && (
            <>
              {/* Inline stats — no boxes */}
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

              {/* Skills — flat divide-y list */}
              <div className="mt-6">
                <h4 className="text-base font-semibold text-gray-900">Skills</h4>
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
                                    <span className="hidden group-open:inline">Hide older notes</span>
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
                                  <li key={entry.id} className="flex flex-wrap items-center gap-2">
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

              {/* Class notes — folded into this card */}
              <div className="mt-6 border-t border-gray-100 pt-4">
                <h4 className="text-base font-semibold text-gray-900">Class notes</h4>
                <p className="mt-1 text-[11px] text-gray-500">
                  General notes recorded for the selected class.
                </p>
                <div className="mt-3 space-y-3">
                  {classNotes.length === 0 ? (
                    <p className="text-sm text-gray-500">No general notes recorded for this class.</p>
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
                            <span className="hidden group-open:inline">Hide older notes</span>
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

        {/* Guardian contact — instructor-only */}
        <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
          <h3 className="text-sm font-semibold text-gray-900">Parent / Guardian Contact</h3>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <p className="text-xs text-gray-500">Name</p>
              <p className="text-sm text-gray-900">{swimmer?.guardianName || "Not available"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Email</p>
              {swimmer?.guardianEmail ? (
                <a href={`mailto:${swimmer.guardianEmail}`} className="text-sm text-blue-600 hover:underline">
                  {swimmer.guardianEmail}
                </a>
              ) : (
                <p className="text-sm text-gray-900">Not available</p>
              )}
            </div>
            <div>
              <p className="text-xs text-gray-500">Relationship</p>
              <p className="text-sm text-gray-900">
                {swimmer?.guardianRelationship || "Not available"}
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
