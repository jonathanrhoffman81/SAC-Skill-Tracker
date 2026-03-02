/**
 * SAC/Instructor dashboard page
 * Purpose: overview dashboard focused on instructor roster, progress, schedule, and recent notes.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import InstructorClassView from './instructorClassView';

interface InstructorClass {
  id: string;
  time: string;
  level: string;
  swimmers: number;
  location: string;
}

interface RosterSwimmerCard {
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
  mastered: boolean; // true if date_acquired is not null in member_skill
  dateAcquired?: string;
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
  const [userName, setUserName] = useState('');
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (stored) {
      const userData = JSON.parse(stored);
      setUserName(userData.name || '');
    }

    // TODO: using person_id from user data, query instructor assignments
    // e.g., instructor_class + enrollment -> members for roster
  }, []);

  // TODO: query instructor_class for today's schedule,
  // join class_entity for time/location/level,
  // join enrollment for swimmer counts

  const todayClasses: InstructorClass[] = useMemo(
    () => [
      { id: 'c1', time: '4:00 PM', level: 'Level 1', swimmers: 8, location: 'Pool A' },
      { id: 'c2', time: '5:00 PM', level: 'Level 2', swimmers: 12, location: 'Pool A' },
      { id: 'c3', time: '6:00 PM', level: 'Level 3', swimmers: 10, location: 'Pool B' },
    ],
    []
  );

  // TODO: roster should come from instructor roster (all members assigned to instructor)
  // join member -> person for swimmer names, join enrollment/class_entity for nextSession
  // for now we can hardcode a few swimmers and their next session times

  const swimmers: RosterSwimmerCard[] = useMemo(
    () => [
      { id: 'swimmer-1', name: 'Emma Johnson', level: 'Level 2', nextSession: 'Feb 12, 2026 at 5:00 PM' },
      { id: 'swimmer-2', name: 'Liam Smith', level: 'Level 3', nextSession: 'Feb 12, 2026 at 6:00 PM' },
      { id: 'swimmer-3', name: 'Olivia Brown', level: 'Level 2', nextSession: 'Feb 12, 2026 at 5:00 PM' },
      { id: 'swimmer-4', name: 'Noah Davis', level: 'Level 1', nextSession: 'Feb 12, 2026 at 4:00 PM' },
    ],
    []
  );

  // TODO: query member_skill joined with skill by member_id
  // to get individual skill names, progress, and date_acquired
  // for now we can hardcode some skills for each swimmer, with a mix of mastered/unmastered and dates

  const skillsBySwimmer: Record<string, SkillItem[]> = useMemo(
    () => ({
      'swimmer-1': [
        { id: 's1', name: 'Freestyle breathing', mastered: true, dateAcquired: 'Feb 10, 2026' },
        { id: 's2', name: 'Backstroke arms', mastered: true, dateAcquired: 'Jan 28, 2026' },
        { id: 's3', name: 'Flip turn', mastered: false },
        { id: 's4', name: 'Butterfly kick', mastered: false },
      ],
      'swimmer-2': [
        { id: 's5', name: 'Streamline push-off', mastered: true, dateAcquired: 'Feb 6, 2026' },
        { id: 's6', name: 'Breaststroke timing', mastered: false },
        { id: 's7', name: 'Underwater dolphin', mastered: false },
      ],
      'swimmer-3': [
        { id: 's8', name: 'Water comfort', mastered: true, dateAcquired: 'Feb 8, 2026' },
        { id: 's9', name: 'Freestyle arms', mastered: true, dateAcquired: 'Feb 1, 2026' },
        { id: 's10', name: 'Backstroke kick', mastered: false },
      ],
      'swimmer-4': [
        { id: 's11', name: 'Bubbles & breath control', mastered: false },
        { id: 's12', name: 'Front float', mastered: true, dateAcquired: 'Feb 9, 2026' },
        { id: 's13', name: 'Back float', mastered: false },
      ],
    }),
    []
  );

  // TODO: query evaluation/notes by instructor_id (or by members assigned),
  // order by date desc

  const notes: NoteItem[] = useMemo(
    () => [
      { id: 'n1', swimmerName: 'Emma Johnson', note: 'Breathing timing improved; needs tighter streamline.', date: 'Feb 10, 2026' },
      { id: 'n2', swimmerName: 'Noah Davis', note: 'Great effort today. Still hesitant to put face in water.', date: 'Feb 9, 2026' },
      { id: 'n3', swimmerName: 'Liam Smith', note: 'Strong kick set; work on breaststroke coordination next.', date: 'Feb 8, 2026' },
    ],
    []
  );

  // If a class is selected, show the class view
  if (selectedClassId) {
    return (
      <InstructorClassView
        classId={selectedClassId}
        onBack={() => setSelectedClassId(null)}
        onSwimmerClick={(swimmerId) => router.push(`/instructor/swimmers/${swimmerId}`)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">SAC Skill Tracker</h1>
            <p className="text-sm text-gray-500">Instructor Dashboard</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-gray-900">{userName || 'Guest User'}</p>
              <span className="inline-flex items-center px-2 py-1 text-xs font-semibold bg-gray-100 text-gray-700 rounded-full">
                Instructor
              </span>
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

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Top row: Today’s schedule + quick stats */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Today’s classes - embed the date next to todays classes */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">Today's Classes <time className="text-xs text-gray-500">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</time></h2> 
              <p className="text-xs text-gray-500">Tap a class to take attendance or review roster.</p>
            </div>

            <div className="divide-y divide-gray-100">
              {todayClasses.map((cls) => (
                <button
                  key={cls.id}
                  className="w-full text-left px-6 py-4 hover:bg-gray-50 transition"
                  onClick={() => setSelectedClassId(cls.id)}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="px-3 py-2 rounded-lg bg-gray-100">
                        <p className="text-sm font-semibold text-gray-900">{cls.time}</p>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{cls.level}</p>
                        <p className="text-xs text-gray-500">{cls.location}</p>
                      </div>
                    </div>
                    <span className="inline-flex items-center px-3 py-1 text-xs font-semibold bg-gray-900 text-white rounded-full">
                      {cls.swimmers} swimmers
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Quick stats */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            {(() => {
              const totalSwimmers = swimmers.length;
              const totalSkills = swimmers.reduce((acc, s) => acc + (skillsBySwimmer[s.id]?.length ?? 0), 0);
              const masteredSkills = swimmers.reduce(
                (acc, s) => acc + (skillsBySwimmer[s.id]?.filter((x) => x.mastered).length ?? 0),
                0
              );
              const pct = formatPct(masteredSkills, totalSkills);

              return (
                <>
                  <p className="text-xs font-medium text-gray-500">Overview</p>
                  <p className="mt-1 text-lg font-semibold text-gray-900">My Roster</p>

                  <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Swimmers</span>
                      <span className="text-sm font-semibold text-gray-900">{totalSwimmers}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Skills Mastered</span>
                      <span className="text-sm font-semibold text-gray-900">
                        {masteredSkills}/{totalSkills}
                      </span>
                    </div>

                    <div className="pt-2">
                      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                        <span>Overall mastery</span>
                        <span>{pct}%</span>
                      </div>
                      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gray-900" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </section>

        {/* Swimmer roster cards */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <span className="inline-flex items-center px-3 py-1 text-xs font-semibold bg-white border border-gray-200 rounded-full">
              My Swimmers
            </span>

            {/* Optional lightweight search input (pure UI for now) */}
            <div className="hidden md:flex items-center gap-2">
              <input
                className="h-9 w-64 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-gray-200"
                placeholder="Search swimmers..."
                // TODO: wire to state filter
              />
              <button className="h-9 px-3 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">
                Filter
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {swimmers.map((swimmer) => {
              const skills = skillsBySwimmer[swimmer.id] || [];
              const mastered = skills.filter((s) => s.mastered).length;
              const pct = formatPct(mastered, skills.length);

              return (
                <button
                  key={swimmer.id}
                  className="text-left bg-white rounded-xl border border-gray-200 p-6 shadow-sm hover:border-gray-300 transition"
                  onClick={() => router.push(`/instructor/swimmers/${swimmer.id}`)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center text-sm font-semibold text-gray-700">
                        {getInitials(swimmer.name)}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{swimmer.name}</p>
                        <p className="text-xs text-gray-500">{swimmer.level}</p>
                        <p className="text-xs text-gray-400 mt-1">Next: {swimmer.nextSession}</p>
                      </div>
                    </div>

                    <span className="inline-flex items-center px-3 py-1 text-xs font-semibold bg-gray-900 text-white rounded-full">
                      {pct}%
                    </span>
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                      <span>
                        Overall Progress ({mastered}/{skills.length} skills)
                      </span>
                      <span>{pct}%</span>
                    </div>
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gray-900" style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="text-xs font-medium text-gray-500 mb-2">Skills</p>
                    <div className="space-y-1">
                      {skills.slice(0, 4).map((skill) => (
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

                      {skills.length > 4 && (
                        <p className="text-xs text-gray-400 pt-1">+ {skills.length - 4} more…</p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Recent notes */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <span className="inline-flex items-center px-3 py-1 text-xs font-semibold bg-white border border-gray-200 rounded-full">
              Recent Notes
            </span>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">Instructor Notes</h2>
              <p className="text-xs text-gray-500">Recent feedback you’ve logged across swimmers.</p>
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