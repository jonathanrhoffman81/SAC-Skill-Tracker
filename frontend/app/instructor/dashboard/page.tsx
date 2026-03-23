/**
 * SAC/Instructor dashboard page
 * Purpose: overview dashboard focused on instructor roster and skill evaluation.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import EvaluationForm from '@/components/EvaluationForm';

interface DashboardClass {
  id: string;
  name: string;
  schedule: string;
}

interface DashboardSkill {
  id: string;
  name: string;
  progress: 0 | 25 | 50 | 75 | 100;
  mastered: boolean;
  dateAcquired?: string;
}

interface DashboardSwimmer {
  id: string;
  name: string;
  level: string;
  classes: DashboardClass[];
  skills: DashboardSkill[];
}

interface DashboardPayload {
  userName: string;
  organizationName?: string;
  swimmers: DashboardSwimmer[];
  error?: string;
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function formatPct(mastered: number, total: number) {
  if (total === 0) return 0;
  return Math.round((mastered / total) * 100);
}

export default function InstructorDashboard() {
  const router = useRouter();
  const [userName, setUserName] = useState('Guest User');
  const [userEmail, setUserEmail] = useState('');
  const [organizationName, setOrganizationName] = useState('SAC Skill Tracker');
  const [openSwimmerId, setOpenSwimmerId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [swimmers, setSwimmers] = useState<DashboardSwimmer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadDashboardData(emailOverride?: string) {
    const email = emailOverride || userEmail;
    if (!email) return;

    try {
      setIsLoading(true);
      setError('');

      const response = await fetch(`/api/instructor/dashboard?email=${encodeURIComponent(email)}`);
      const payload = (await response.json()) as DashboardPayload;

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load instructor dashboard data.');
      }

      setUserName((prev) => payload.userName || prev);
      setOrganizationName(payload.organizationName || 'SAC Skill Tracker');
      setSwimmers(payload.swimmers ?? []);
    } catch (fetchError) {
      const message =
        fetchError instanceof Error ? fetchError.message : 'Unexpected error loading dashboard.';

      setError(message);
      setSwimmers([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (!stored) {
      setError('Missing local user session. Please log in again.');
      setIsLoading(false);
      return;
    }

    const userData = JSON.parse(stored);
    const localName = userData.name || 'Guest User';
    const email = userData.email || '';

    setUserName(localName);
    setUserEmail(email);

    if (!email) {
      setError('Missing user email from login session.');
      setIsLoading(false);
      return;
    }

    loadDashboardData(email);
  }, []);

  const visibleSwimmers = useMemo(() => {
    if (!searchQuery) {
      return swimmers;
    }

    const query = searchQuery.toLowerCase();
    return swimmers.filter((swimmer) => swimmer.name.toLowerCase().includes(query));
  }, [swimmers, searchQuery]);

  const handleSwimmerClick = (swimmerId: string) => {
    setOpenSwimmerId((current) => (current === swimmerId ? null : swimmerId));
  };

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
              <p className="hidden text-[10px] text-gray-500 sm:block sm:text-xs">Instructor Dashboard</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden text-right md:block">
              <p className="text-sm font-medium text-gray-900">{userName || 'Guest User'}</p>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">Instructor</span>
            </div>
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-800 text-[10px] font-semibold text-white sm:h-9 sm:w-9 sm:text-xs">
              {getInitials(userName)}
            </div>
            <button
              onClick={() => {
                localStorage.removeItem('user');
                router.push('/login');
              }}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 sm:h-9 sm:w-9"
            >
              <svg className="h-4 w-4 sm:h-5 sm:w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-3 py-4 sm:space-y-6 sm:px-6 sm:py-8">
        {isLoading && (
          <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 sm:gap-3 sm:p-4">
            <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-blue-600 sm:h-5 sm:w-5" />
            <p className="text-xs text-blue-800 sm:text-sm">Loading instructor dashboard...</p>
          </div>
        )}

        {!isLoading && error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 sm:p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-start gap-2 sm:gap-3">
                <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600 sm:h-5 sm:w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-red-800 sm:text-sm">Failed to load dashboard</p>
                  <p className="mt-0.5 break-words text-[10px] text-red-700 sm:mt-1 sm:text-xs">{error}</p>
                </div>
              </div>
              <button
                onClick={() => loadDashboardData()}
                className="whitespace-nowrap rounded-md bg-red-100 px-2 py-1 text-[10px] text-red-800 transition-colors hover:bg-red-200 sm:px-3 sm:py-1.5 sm:text-xs"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        <section>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold">
              My Swimmers
            </span>
            <div className="w-full max-w-xs">
              <input
                type="text"
                placeholder="Search swimmers..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="space-y-4">
            {visibleSwimmers.map((swimmer) => {
              const mastered = swimmer.skills.filter((skill) => skill.mastered).length;
              const pct = formatPct(mastered, swimmer.skills.length);
              const isOpen = openSwimmerId === swimmer.id;

              return (
                <div key={swimmer.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
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
                            <p className="text-sm font-semibold text-gray-900">{swimmer.name}</p>
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                              {swimmer.level}
                            </span>
                            <button
                              type="button"
                              className="text-[11px] text-blue-600 hover:text-blue-700 hover:underline"
                              onClick={(event) => {
                                event.stopPropagation();
                                router.push(`/instructor/swimmers/${swimmer.id}`);
                              }}
                            >
                              View full profile
                            </button>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                            <span>{mastered}/{swimmer.skills.length} skills acquired</span>
                            <span>{pct}% complete</span>
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
                        className={`h-5 w-5 flex-shrink-0 transform text-gray-500 transition-transform ${
                          isOpen ? 'rotate-180' : ''
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
                      <EvaluationForm
                        swimmerId={swimmer.id}
                        userEmail={userEmail}
                        skills={swimmer.skills}
                        classes={swimmer.classes}
                        onSubmissionComplete={() => loadDashboardData()}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {!isLoading && !error && visibleSwimmers.length === 0 && (
            <div className="mt-6 rounded-lg border border-gray-200 bg-white px-4 py-6 text-sm text-gray-600">
              No swimmers assigned to you yet.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
