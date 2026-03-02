/**
 * Swimm/Adult Swimmer dashboard page
 * Purpose: overview dashboard focused on swimmer progress and instructor notes.
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface SwimmerCard {
  id: string;
  name: string;
  level: string;
  nextSession: string;
}

interface NoteItem {
  id: string;
  swimmerName: string;
  note: string;
  date: string;
}

interface SkillItem {
  id: string;
  name: string;
  mastered: boolean;
  dateAcquired?: string;
}

interface DashboardPayload {
  userName: string;
  swimmers: SwimmerCard[];
  skillsBySwimmer: Record<string, SkillItem[]>;
  notes: NoteItem[];
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export default function AccountDashboard() {
  const router = useRouter();
  const [userName, setUserName] = useState('Guest User');
  const [swimmers, setSwimmers] = useState<SwimmerCard[]>([]);
  const [skillsBySwimmer, setSkillsBySwimmer] = useState<Record<string, SkillItem[]>>({});
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadDashboardData() {
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

        // Fetch all parent dashboard data in one request.
        const response = await fetch(`/api/account/dashboard?email=${encodeURIComponent(email)}`);
        const payload = (await response.json()) as DashboardPayload & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error || 'Failed to load dashboard data.');
        }

        if (!isMounted) return;

        setUserName(payload.userName || localName);
        setSwimmers(payload.swimmers ?? []);
        setSkillsBySwimmer(payload.skillsBySwimmer ?? {});
        setNotes(payload.notes ?? []);
      } catch (fetchError) {
        if (!isMounted) return;
        const message = fetchError instanceof Error ? fetchError.message : 'Unexpected error';
        setError(message);
        setSwimmers([]);
        setSkillsBySwimmer({});
        setNotes([]);
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

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">SAC Skill Tracker</h1>
            <p className="text-sm text-gray-500">Parent/Adult Swimmer Dashboard</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-gray-900">{userName || 'Guest User'}</p>
              <span className="inline-flex items-center px-2 py-1 text-xs font-semibold bg-gray-100 text-gray-700 rounded-full">
                Parent/Adult Swimmer
              </span>
            </div>
            <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-sm font-semibold text-gray-700">
              {userName ? getInitials(userName) : 'GU'}
            </div>
            <button
              onClick={() => {
                localStorage.removeItem('user');
                router.push('/login');
              }}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {isLoading && (
          <div className="mb-6 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
            Loading dashboard data...
          </div>
        )}

        {!isLoading && error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {swimmers.map((swimmer) => (
            <div key={swimmer.id} className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center text-sm font-semibold text-gray-700">
                    {getInitials(swimmer.name)}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{swimmer.name}</p>
                    <p className="text-xs text-gray-500">{swimmer.level}</p>
                  </div>
                </div>
                <span className="inline-flex items-center px-3 py-1 text-xs font-semibold bg-gray-900 text-white rounded-full">
                  {(() => {
                    const skills = skillsBySwimmer[swimmer.id] || [];
                    const pct =
                      skills.length === 0
                        ? 0
                        : Math.round((skills.filter((s) => s.mastered).length / skills.length) * 100);
                    return `${pct}%`;
                  })()}
                </span>
              </div>

              <div className="mt-2">
                <p className="text-xs text-gray-500">Next Session</p>
                <p className="text-xs text-gray-700">{swimmer.nextSession}</p>
              </div>

              <div className="mt-4">
                {(() => {
                  const skills = skillsBySwimmer[swimmer.id] || [];
                  const pct =
                    skills.length === 0
                      ? 0
                      : Math.round((skills.filter((s) => s.mastered).length / skills.length) * 100);
                  return (
                    <>
                      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                        <span>
                          Overall Progress ({skills.filter((s) => s.mastered).length}/{skills.length} skills)
                        </span>
                        <span>{pct}%</span>
                      </div>
                      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gray-900" style={{ width: `${pct}%` }} />
                      </div>
                    </>
                  );
                })()}
              </div>

              <div className="mt-4">
                <p className="text-xs font-medium text-gray-500 mb-2">Skills</p>
                <div className="space-y-1">
                  {(skillsBySwimmer[swimmer.id] || []).map((skill) => (
                    <div key={skill.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-4 w-4 rounded-full flex items-center justify-center text-xs ${
                            skill.mastered ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
                          }`}
                        >
                          {skill.mastered ? '✓' : '○'}
                        </span>
                        <span className="text-xs text-gray-700">{skill.name}</span>
                      </div>
                      {skill.mastered && skill.dateAcquired && (
                        <span className="text-xs text-gray-400">{skill.dateAcquired}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </section>

        {!isLoading && !error && swimmers.length === 0 && (
          <div className="mt-6 rounded-lg border border-gray-200 bg-white px-4 py-6 text-sm text-gray-600">
            No linked swimmers found for this account yet.
          </div>
        )}

        <section className="mt-8">
          <div className="flex items-center gap-3 mb-4">
            <span className="inline-flex items-center px-3 py-1 text-xs font-semibold bg-white border border-gray-200 rounded-full">
              Instructor Notes
            </span>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">Recent Notes</h2>
              <p className="text-xs text-gray-500">Focus on feedback and updates from instructors.</p>
            </div>
            <div className="divide-y divide-gray-100">
              {notes.map((note) => (
                <div key={note.id} className="px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-7 w-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-semibold text-gray-700">
                        {getInitials(note.swimmerName)}
                      </span>
                      <p className="text-sm font-semibold text-gray-900">{note.swimmerName}</p>
                    </div>
                    <span className="text-xs text-gray-400">{note.date}</span>
                  </div>
                  <p className="text-sm text-gray-600 mt-2">{note.note}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
