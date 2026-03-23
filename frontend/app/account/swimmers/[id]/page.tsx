/**
 * Parent swimmer detail page
 * Purpose: display swimmer details and progress for a parent-view of a specific swimmer.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

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

interface Skill {
    id: string;
    name: string;
    mastered: boolean;
    progress: number;
    dateAcquired?: string;
    notes?: NoteItem[];
}

interface SwimmerPayload {
    swimmer: SwimmerDetail;
    skills: Skill[];
    sessionNotes: NoteItem[];
    error?: string;
}

interface DashboardCachePayload {
    swimmers: Array<{
        id: string;
        name: string;
        level: string;
    }>;
    skillsBySwimmer: Record<string, Skill[]>;
}

const SWIMMER_PROFILE_CACHE_PREFIX = 'account-swimmer-profile-cache:';
const DASHBOARD_CACHE_PREFIX = 'account-dashboard-cache:';

function getInitials(name: string) {
    return name
        .split(' ')
        .map((part) => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();
}

function getProgressBadgeClass(progress: number) {
    if (progress >= 100) return 'bg-emerald-100 text-emerald-700';
    if (progress >= 75) return 'bg-blue-100 text-blue-700';
    if (progress >= 50) return 'bg-amber-100 text-amber-700';
    if (progress >= 25) return 'bg-orange-100 text-orange-700';
    return 'bg-gray-100 text-gray-600';
}

function getProgressStageLabel(progress: number) {
    if (progress >= 100) return 'Acquired';
    if (progress >= 75) return 'Nearly there';
    if (progress >= 50) return 'Developing';
    if (progress >= 25) return 'Beginning';
    return 'Not started';
}

function isSkillFormattedFeedback(text: string) {
    return /skill\s*notes?:|^\s*skill\s*:/im.test(text);
}

export default function ParentSwimmerDetail() {
    const router = useRouter();
    const params = useParams();
    const swimmerId = params.id as string;

    const [swimmer, setSwimmer] = useState<SwimmerDetail | null>(null);
    const [skills, setSkills] = useState<Skill[]>([]);
    const [sessionNotes, setSessionNotes] = useState<NoteItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let isMounted = true;

        async function loadSwimmerData() {
            let hasCachedData = false;

            try {
                setIsLoading(true);
                setError('');

                const stored = localStorage.getItem('user');
                if (!stored) {
                    throw new Error('Missing local user session. Please log in again.');
                }

                const userData = JSON.parse(stored);
                const email = userData.email;

                if (!email) {
                    throw new Error('Missing user email from login session.');
                }

                const profileCacheKey = `${SWIMMER_PROFILE_CACHE_PREFIX}${email.toLowerCase()}:${swimmerId}`;
                const cachedProfileRaw = sessionStorage.getItem(profileCacheKey);
                if (cachedProfileRaw) {
                    try {
                        const cachedPayload = JSON.parse(cachedProfileRaw) as SwimmerPayload;
                        if (isMounted && cachedPayload.swimmer) {
                            setSwimmer(cachedPayload.swimmer);
                            setSkills(cachedPayload.skills ?? []);
                            setSessionNotes(cachedPayload.sessionNotes ?? []);
                            hasCachedData = true;
                            setIsLoading(false);
                        }
                    } catch {
                        sessionStorage.removeItem(profileCacheKey);
                    }
                }

                if (!hasCachedData) {
                    const dashboardCacheKey = `${DASHBOARD_CACHE_PREFIX}${email.toLowerCase()}`;
                    const cachedDashboardRaw = sessionStorage.getItem(dashboardCacheKey);
                    if (cachedDashboardRaw) {
                        try {
                            const dashboardCache = JSON.parse(cachedDashboardRaw) as DashboardCachePayload;
                            const cachedSwimmer = (dashboardCache.swimmers ?? []).find((item) => item.id === swimmerId);
                            const cachedSkills = dashboardCache.skillsBySwimmer?.[swimmerId] ?? [];
                            if (isMounted && cachedSwimmer) {
                                setSwimmer({
                                    id: cachedSwimmer.id,
                                    name: cachedSwimmer.name,
                                    level: cachedSwimmer.level,
                                    age: null,
                                    enrollmentDate: '',
                                });
                                setSkills(cachedSkills);
                                setSessionNotes([]);
                                hasCachedData = true;
                                setIsLoading(false);
                            }
                        } catch {
                            // Ignore malformed dashboard cache.
                        }
                    }
                }

                const response = await fetch(
                    `/api/account/swimmers/${swimmerId}?email=${encodeURIComponent(email)}`
                );
                const payload = (await response.json()) as SwimmerPayload;

                if (!response.ok) {
                    throw new Error(payload.error || 'Failed to load swimmer detail.');
                }

                if (!isMounted) return;

                setSwimmer(payload.swimmer ?? null);
                setSkills(payload.skills ?? []);
                setSessionNotes(payload.sessionNotes ?? []);
                sessionStorage.setItem(profileCacheKey, JSON.stringify(payload));
            } catch (fetchError) {
                if (!isMounted) return;

                const message = fetchError instanceof Error ? fetchError.message : 'Unexpected error';
                if (!hasCachedData) {
                    setError(message);
                    setSwimmer(null);
                    setSkills([]);
                    setSessionNotes([]);
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

    const masteredCount = useMemo(
        () => skills.filter((skill) => skill.mastered).length,
        [skills]
    );

    const progressPct = useMemo(
        () => (skills.length ? Math.round(skills.reduce((sum, skill) => sum + skill.progress, 0) / skills.length) : 0),
        [skills]
    );

    const cleanSessionNotes = useMemo(
        () => sessionNotes.filter((entry) => !isSkillFormattedFeedback(entry.content)),
        [sessionNotes]
    );

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-gray-50">
                <div className="text-sm text-gray-600">Loading swimmer details...</div>
            </div>
        );
    }

    if (!isLoading && (error || !swimmer)) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-gray-50">
                <div className="max-w-lg px-6 text-center">
                    <p className="text-sm text-red-700">{error || 'Swimmer not found.'}</p>
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
                <div className="mx-auto max-w-4xl px-6 py-4">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => router.back()}
                            className="-ml-2 rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                        >
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-lg font-semibold text-gray-700">
                                {getInitials(swimmer?.name ?? 'Unknown')}
                            </div>
                            <div>
                                <h1 className="text-xl font-semibold text-gray-900">{swimmer?.name}</h1>
                                <p className="text-xs text-gray-500">Parent View</p>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
                <section className="rounded-xl border border-gray-200 bg-white p-6">
                    <h3 className="mb-4 text-sm font-semibold text-gray-900">Swimmer Profile</h3>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                        <div>
                            <p className="text-xs text-gray-500">Level</p>
                            <p className="text-sm text-gray-900">{swimmer?.level}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500">Age</p>
                            <p className="text-sm text-gray-900">{swimmer?.age ?? 'Not available'}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500">Enrollment Date</p>
                            <p className="text-sm text-gray-900">{swimmer?.enrollmentDate || 'Not available'}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-500">Overall Progress</p>
                            <p className="text-sm font-semibold text-gray-900">{progressPct}%</p>
                        </div>
                    </div>
                </section>

                <section className="rounded-xl border border-gray-200 bg-white p-6">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <h3 className="text-sm font-semibold text-gray-900">Skills</h3>
                            <p className="mt-1 text-xs text-gray-500">Each skill includes its own instructor updates.</p>
                        </div>
                        <div className="text-right">
                            <p className="text-xs text-gray-500">Skills Acquired</p>
                            <p className="text-sm font-semibold text-gray-900">
                                {masteredCount}/{skills.length}
                            </p>
                        </div>
                    </div>

                    <div className="mt-6 -mx-6 border-t border-gray-100" />

                    <div className="mt-4 -mx-6 divide-y divide-gray-100">
                        {skills.map((skill) => {
                            const skillNotes = skill.notes ?? [];

                            return (
                                <div key={skill.id} className="space-y-3 px-6 py-4">
                                    <div className="flex items-center justify-between gap-4">
                                        <div>
                                            <p className={`text-sm ${skill.mastered ? 'text-gray-900' : 'text-gray-600'}`}>
                                                {skill.name}
                                            </p>
                                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                                <span
                                                    className={`rounded-full px-2 py-0.5 ${getProgressBadgeClass(skill.progress)}`}
                                                >
                                                    {skill.progress}% - {getProgressStageLabel(skill.progress)}
                                                </span>
                                            </div>
                                        </div>

                                        {skill.dateAcquired && (
                                            <span className="text-xs text-gray-500">Updated on {skill.dateAcquired}</span>
                                        )}
                                    </div>

                                    <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
                                        <p className="text-xs font-semibold text-gray-700">Notes for this skill</p>
                                        <div className="mt-3 space-y-3">
                                            {skillNotes.length > 0 ? (
                                                skillNotes.map((entry) => (
                                                    <div key={entry.id} className="rounded-lg border border-gray-200 bg-white px-3 py-3">
                                                        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                                            <span>{entry.author}</span>
                                                            <span>{entry.date}</span>
                                                        </div>
                                                        <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">{entry.content}</p>
                                                    </div>
                                                ))
                                            ) : (
                                                <p className="text-sm text-gray-500">No notes for this skill yet.</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {skills.length === 0 && (
                            <div className="px-6 py-6 text-sm text-gray-500">No skills tracked for this swimmer yet.</div>
                        )}
                    </div>

                    <div className="mt-6 -mx-6 border-t border-gray-100" />

                    <div className="mt-4 space-y-3">
                        <div>
                            <h4 className="text-sm font-semibold text-gray-900">Session Notes</h4>
                            <p className="mt-1 text-xs text-gray-500">General notes not tied to a specific skill.</p>
                        </div>

                        {cleanSessionNotes.length > 0 ? (
                            cleanSessionNotes.map((entry) => (
                                <div key={entry.id} className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
                                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                        <span>{entry.author}</span>
                                        <span>{entry.date}</span>
                                    </div>
                                    <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">{entry.content}</p>
                                </div>
                            ))
                        ) : (
                            <p className="text-sm text-gray-500">No session notes recorded yet.</p>
                        )}
                    </div>
                </section>
            </main>
        </div>
    );
}

