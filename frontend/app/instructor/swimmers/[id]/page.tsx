/**
 * Instructor swimmer detail page
 * Purpose: detailed view for a single swimmer (skills, notes, history) accessible by ID.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';

interface SwimmerDetail {
  id: string;
  name: string;
  age: number | null;
  level: string;
  enrollmentDate: string;
  guardianName: string;
  guardianEmail: string;
  guardianRelationship: string;
}

interface ClassInfo {
  id: string;
  name: string;
  schedule: string;
}

interface Skill {
  id: string;
  name: string;
  mastered: boolean;
  progress: number;
  dateAcquired?: string;
  notes: NoteItem[];
}

interface NoteItem {
  id: string;
  date: string;
  content: string;
  author: string;
}

interface SwimmerPayload {
  swimmer: SwimmerDetail;
  classes: ClassInfo[];
  skills: Skill[];
  sessionNotes: NoteItem[];
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

export default function InstructorSwimmerDetail() {
  const router = useRouter();
  const params = useParams();
  const swimmerId = params.id as string;

  const [skillNotes, setSkillNotes] = useState<Record<string, string>>({});

  const [swimmer, setSwimmer] = useState<SwimmerDetail | null>(null);
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [sessionNotes, setSessionNotes] = useState<NoteItem[]>([]);
  const [selectedClassId, setSelectedClassId] = useState('');

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [savingSkillId, setSavingSkillId] = useState<string | null>(null);

  const loadSwimmerData = async () => {
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

      const response = await fetch(
        `/api/instructor/swimmers/${swimmerId}?email=${encodeURIComponent(email)}`
      );
      const payload = (await response.json()) as SwimmerPayload;

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load swimmer detail.');
      }

      setSwimmer(payload.swimmer ?? null);
      setClasses(payload.classes ?? []);
      setSkills(payload.skills ?? []);
      setSessionNotes(payload.sessionNotes ?? []);
      setSelectedClassId((payload.classes ?? [])[0]?.id ?? '');
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : 'Unexpected error';
      setError(message);
      setSwimmer(null);
      setClasses([]);
      setSkills([]);
      setSessionNotes([]);
      setSelectedClassId('');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSwimmerData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swimmerId]);

  const masteredCount = useMemo(
    () => skills.filter((skill) => skill.mastered).length,
    [skills]
  );

  const progressPct = useMemo(
    () => (skills.length ? Math.round((masteredCount / skills.length) * 100) : 0),
    [masteredCount, skills.length]
  );

  const handleSubmitSkill = async (skill: Skill) => {
    try {
      const note = skillNotes[skill.id]?.trim() ?? '';
      if (!note) return;

      setSaveError('');
      setSavingSkillId(skill.id);

      const stored = localStorage.getItem('user');
      if (!stored) {
        throw new Error('Missing local user session. Please log in again.');
      }

      const userData = JSON.parse(stored);
      const email = userData.email;

      if (!email) {
        throw new Error('Missing user email from login session.');
      }

      const response = await fetch(`/api/instructor/swimmers/${swimmerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          note: undefined,
          classId: selectedClassId || undefined,
          skillNotes: [{ skillId: skill.id, note }],
        }),
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to save skill update.');
      }

      setSkillNotes((prev) => ({ ...prev, [skill.id]: '' }));
      await loadSwimmerData();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Failed to save skill update';
      setSaveError(message);
      await loadSwimmerData();
    } finally {
      setSavingSkillId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-sm text-gray-600">Loading swimmer details...</div>
      </div>
    );
  }

  if (!isLoading && (error || !swimmer)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-lg px-6">
          <p className="text-red-700 text-sm">{error || 'Swimmer not found.'}</p>
          <button
            onClick={() => router.back()}
            className="mt-4 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className="p-2 -ml-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center text-lg font-semibold text-gray-700">
                {getInitials(swimmer?.name ?? 'Unknown')}
              </div>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">{swimmer?.name}</h1>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {saveError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {saveError}
          </div>
        )}

        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Parent/Guardian Contact</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-gray-500">Name</p>
              <p className="text-sm text-gray-900">{swimmer?.guardianName}</p>
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
              <p className="text-sm text-gray-900">{swimmer?.guardianRelationship || 'Not available'}</p>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Session Notes</h3>
              <p className="text-xs text-gray-500 mt-1">General notes not tied to a specific skill.</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Progress</p>
              <p className="text-sm font-semibold text-gray-900">{progressPct}% overall</p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {sessionNotes.length > 0 ? (
              sessionNotes.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span>{entry.author}</span>
                    <span>{entry.date}</span>
                  </div>
                  <p className="mt-2 text-sm text-gray-800 whitespace-pre-wrap">{entry.content}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500">No session notes recorded yet.</p>
            )}
          </div>
        </section>

        <section className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
              {skills.map((skill) => (
                <div key={skill.id} className="px-6 py-4 space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className={`text-sm ${skill.mastered ? 'text-gray-900' : 'text-gray-600'}`}>
                        {skill.name}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        <span
                          className={`rounded-full px-2 py-0.5 ${
                            skill.progress === 100
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {skill.progress}% progress
                        </span>
                        {skill.mastered && skill.dateAcquired && (
                          <span>Mastered on {skill.dateAcquired}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
                    <p className="text-xs font-semibold text-gray-700">Notes for this skill</p>
                    <div className="mt-3 space-y-3">
                      {skill.notes.length > 0 ? (
                        skill.notes.map((entry) => (
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

                  <div className="flex flex-col gap-3 md:flex-row">
                    <input
                      type="text"
                      value={skillNotes[skill.id] ?? ''}
                      onChange={(e) =>
                        setSkillNotes((prev) => ({ ...prev, [skill.id]: e.target.value }))
                      }
                      placeholder="Add skill note..."
                      className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-200"
                    />
                    <button
                      onClick={() => handleSubmitSkill(skill)}
                      disabled={
                        savingSkillId === skill.id || !skillNotes[skill.id]?.trim()
                      }
                      className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed transition"
                    >
                      {savingSkillId === skill.id ? 'Saving...' : 'Submit'}
                    </button>
                  </div>
                </div>
              ))}

              {skills.length === 0 && (
                <div className="px-6 py-6 text-sm text-gray-500">No skills tracked for this swimmer yet.</div>
              )}
            </div>
          </section>
      </main>
    </div>
  );
}
