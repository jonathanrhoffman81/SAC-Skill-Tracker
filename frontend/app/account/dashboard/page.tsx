/**
 * Swimm/Adult Swimmer dashboard page
 * Purpose: overview dashboard focused on swimmer progress and skill-level updates.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type SkillProgress = 0 | 25 | 50 | 75 | 100;

const SKILL_PROGRESS_STEPS: SkillProgress[] = [0, 25, 50, 75, 100];

const SKILL_PROGRESS_LABELS: Record<SkillProgress, string> = {
  0: 'Not started',
  25: 'Beginning',
  50: 'Developing',
  75: 'Nearly there',
  100: 'Acquired',
};

const DASHBOARD_CACHE_PREFIX = 'account-dashboard-cache:';

interface SwimmerCard {
  id: string;
  name: string;
  level: string;
  nextSession: string;
  classIds: string[];
}

interface SkillItem {
  id: string;
  name: string;
  progress: SkillProgress;
  mastered?: boolean;
  dateAcquired?: string;
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
  swimmers: Array<Omit<SwimmerCard, 'classIds'> & { classIds?: string[] }>;
  skillsBySwimmer: Record<string, SkillItem[]>;
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function normalizeSkillProgress(value: unknown, mastered?: boolean): SkillProgress {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (SKILL_PROGRESS_STEPS.includes(numericValue as SkillProgress)) {
    return numericValue as SkillProgress;
  }

  return mastered ? 100 : 0;
}

function getProgressBadgeClasses(progress: SkillProgress) {
  if (progress === 100) {
    return 'bg-emerald-100 text-emerald-700';
  }
  if (progress >= 75) {
    return 'bg-blue-100 text-blue-700';
  }
  if (progress >= 50) {
    return 'bg-amber-100 text-amber-700';
  }
  if (progress >= 25) {
    return 'bg-orange-100 text-orange-700';
  }
  return 'bg-gray-100 text-gray-600';
}

export default function AccountDashboard() {
  const router = useRouter();
  const [userName, setUserName] = useState('Guest User');
  const [organizationName, setOrganizationName] = useState('SAC Skill Tracker');
  const [openSwimmerIds, setOpenSwimmerIds] = useState<string[]>([]);
  const [swimmers, setSwimmers] = useState<SwimmerCard[]>([]);
  const [skillsBySwimmer, setSkillsBySwimmer] = useState<Record<string, SkillItem[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    function normalizeSkillsBySwimmer(skillsBySwimmer?: DashboardPayload['skillsBySwimmer']) {
      return Object.fromEntries(
        Object.entries(skillsBySwimmer ?? {}).map(([swimmerId, skills]) => [
          swimmerId,
          (skills ?? []).map((skill) => {
            const progress = normalizeSkillProgress(skill.progress, skill.mastered);
            return {
              ...skill,
              progress,
              mastered: progress === 100,
            };
          }),
        ])
      ) as Record<string, SkillItem[]>;
    }

    function applyPayload(payload: DashboardPayload, fallbackName: string) {
      setUserName(payload.userName || fallbackName);
      setOrganizationName(payload.organizationName || 'SAC Skill Tracker');
      setSwimmers(
        (payload.swimmers ?? []).map((swimmer) => ({
          ...swimmer,
          classIds: swimmer.classIds ?? [],
        }))
      );
      setSkillsBySwimmer(normalizeSkillsBySwimmer(payload.skillsBySwimmer));
    }

    async function loadDashboardData() {
      let hasCachedData = false;

      try {
        setIsLoading(true);
        setError('');

        const stored = localStorage.getItem('user');
        if (!stored) {
          throw new Error('Missing local user session. Please log in again.');
        }

        const userData = JSON.parse(stored);
        const localName = userData.name || 'Guest User';
        const email = userData.email;

        setUserName(localName);

        if (!email) {
          throw new Error('Missing user email from login session.');
        }

        const cacheKey = `${DASHBOARD_CACHE_PREFIX}${email.toLowerCase()}`;
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
        const response = await fetch(`/api/account/dashboard?email=${encodeURIComponent(email)}`);
        const payload = (await response.json()) as DashboardPayload & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error || 'Failed to load dashboard data.');
        }

        if (!isMounted) return;

        applyPayload(payload, localName);
        sessionStorage.setItem(cacheKey, JSON.stringify(payload));
      } catch (fetchError) {
        if (!isMounted) return;
        const message = fetchError instanceof Error ? fetchError.message : 'Unexpected error';
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

  useEffect(() => {
    if (uniqueSwimmers.length === 0) {
      setOpenSwimmerIds([]);
      return;
    }

    setOpenSwimmerIds((current) => {
      if (current.length > 0) {
        return current;
      }
      return uniqueSwimmers.map((swimmer) => swimmer.id);
    });
  }, [uniqueSwimmers]);

  function getOverallPct(skills: SkillItem[]) {
    if (skills.length === 0) return 0;
    return Math.round(skills.reduce((sum, skill) => sum + skill.progress, 0) / skills.length);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-3 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-600 sm:h-9 sm:w-9 sm:rounded-xl">
              <svg className="h-4 w-4 text-white sm:h-5 sm:w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-gray-900 sm:text-sm">{organizationName}</p>
              <p className="hidden text-[10px] text-gray-500 sm:block sm:text-xs">Parent Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden text-right md:block">
              <p className="text-sm font-medium text-gray-900">{userName || 'Guest User'}</p>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">Parent</span>
            </div>
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-800 text-[10px] font-semibold text-white sm:h-9 sm:w-9 sm:text-xs">
              {userName ? getInitials(userName) : 'GU'}
            </div>
            <button
              onClick={() => {
                localStorage.removeItem('user');
                router.push('/login');
              }}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 sm:h-9 sm:w-9"
            >
              <svg className="h-4 w-4 sm:h-5 sm:w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-3 py-4 sm:space-y-6 sm:px-6 sm:py-8">
        {/* Loading Banner */}
        {isLoading && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4 flex items-center gap-2 sm:gap-3">
            <div className="animate-spin rounded-full h-4 w-4 sm:h-5 sm:w-5 border-b-2 border-green-600 flex-shrink-0"></div>
            <p className="text-xs sm:text-sm text-blue-800">Loading dashboard data...</p>
          </div>
        )}

        {/* Error Banner */}
        {!isLoading && error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 sm:p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 sm:gap-3 min-w-0 flex-1">
                <svg className="w-4 h-4 sm:w-5 sm:h-5 text-red-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-red-800">Failed to load data</p>
                  <p className="text-[10px] sm:text-xs text-red-700 mt-0.5 sm:mt-1 break-words">{error}</p>
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
          <div className="mb-4 flex items-center justify-between">
            <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold">
              My Swimmers
            </span>
          </div>

          <div className="space-y-4">
            {uniqueSwimmers.map((swimmer) => {
              const skills = skillsBySwimmer[swimmer.id] || [];
              const acquiredCount = skills.filter((s) => s.progress === 100).length;
              const pct = getOverallPct(skills);
              const isOpen = openSwimmerIds.includes(swimmer.id);

              return (
                <div key={swimmer.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                  <button
                    className="w-full p-5 text-left transition hover:bg-gray-50 sm:p-6"
                    onClick={() =>
                      setOpenSwimmerIds((current) =>
                        current.includes(swimmer.id)
                          ? current.filter((id) => id !== swimmer.id)
                          : [...current, swimmer.id]
                      )
                    }
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-700">
                          {getInitials(swimmer.name)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-gray-900">{swimmer.name}</p>
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                              {swimmer.level}
                            </span>
                            <button
                              type="button"
                              className="text-[11px] text-blue-600 hover:text-blue-700 hover:underline"
                              onClick={(event) => {
                                event.stopPropagation();
                                router.push(`/account/swimmers/${swimmer.id}`);
                              }}
                            >
                              View full profile
                            </button>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                            <span>{acquiredCount}/{skills.length} skills acquired</span>
                            <span>{pct}% complete</span>
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">
                              {swimmer.nextSession}
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
                        className={`h-5 w-5 flex-shrink-0 transform text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''
                          }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
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
                          <div className="h-full bg-blue-600" style={{ width: `${pct}%` }} />
                        </div>
                        {swimmer.classIds.length === 0 && (
                          <p className="mt-2 rounded px-2 py-1 text-xs text-amber-700 border border-amber-200 bg-amber-50">
                            No class enrollment linked to this swimmer record.
                          </p>
                        )}
                      </div>

                      <div className="mt-4">
                        <p className="mb-2 text-xs font-medium text-gray-500">Skills</p>
                        <div className="space-y-2">
                          {skills.length === 0 && (
                            <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                              No skills are attached to this member record yet.
                            </p>
                          )}
                          {skills.map((skill) => {
                            const skillNotes = skill.notes ?? [];

                            return (
                              <div key={skill.id} className="rounded-lg border border-gray-100 px-3 py-3">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="min-w-0 text-xs text-gray-700">{skill.name}</span>
                                  <div className="flex items-center gap-2 pl-2">
                                    {skill.dateAcquired && (
                                      <span className="whitespace-nowrap text-[11px] text-gray-500">
                                        Updated: {skill.dateAcquired}
                                      </span>
                                    )}
                                    <span
                                      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${getProgressBadgeClasses(
                                        skill.progress
                                      )}`}
                                    >
                                      {skill.progress}% - {SKILL_PROGRESS_LABELS[skill.progress]}
                                    </span>
                                  </div>
                                </div>

                                {skillNotes.length > 0 && (
                                  <div className="mt-2 space-y-2">
                                    {skillNotes.map((note) => (
                                      <div key={note.id} className="rounded-md border border-gray-200 bg-gray-50 px-2 py-2">
                                        <p className="text-[11px] text-gray-500">{note.date} by {note.author}</p>
                                        <p className="mt-1 text-xs text-gray-700">{note.content}</p>
                                      </div>
                                    ))}
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
      </main>
    </div>
  );
}
