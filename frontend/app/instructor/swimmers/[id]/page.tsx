/**
 * Instructor swimmer detail page
 * Purpose: detailed view for a single swimmer (skills, notes, history) accessible by ID.
 */

'use client';

import { useState, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';

// Types
interface SwimmerDetail {
  id: string;
  name: string;
  age: number;
  level: string;
  parentName: string;
  parentEmail: string;
  parentPhone: string;
  enrollmentDate: string;
  lastAttended: string;
  attendanceRate: number;
}

interface Skill {
  id: string;
  name: string;
  category: string;
  mastered: boolean;
  dateAcquired?: string;
}

interface Note {
  id: string;
  date: string;
  content: string;
  author: string;
}

interface AttendanceRecord {
  date: string;
  status: 'present' | 'absent' | 'late' | 'excused';
  className: string;
}

// Helper functions
function getInitials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function getStatusBadge(status: AttendanceRecord['status']) {
  switch (status) {
    case 'present':
      return 'bg-green-100 text-green-700';
    case 'absent':
      return 'bg-red-100 text-red-700';
    case 'late':
      return 'bg-yellow-100 text-yellow-700';
    case 'excused':
      return 'bg-blue-100 text-blue-700';
  }
}

export default function InstructorSwimmerDetail() {
  const router = useRouter();
  const params = useParams();
  const swimmerId = params.id as string;

  const [activeTab, setActiveTab] = useState<'skills' | 'notes' | 'attendance'>('skills');
  const [newNote, setNewNote] = useState('');

  // Hardcoded swimmer data - TODO: Replace with Supabase query
  const swimmerData: Record<string, SwimmerDetail> = useMemo(
    () => ({
      'sw-1': { id: 'sw-1', name: 'Noah Davis', age: 5, level: 'Level 1', parentName: 'Michael Davis', parentEmail: 'mdavis@email.com', parentPhone: '(555) 123-4567', enrollmentDate: 'Jan 15, 2026', lastAttended: 'Feb 23, 2026', attendanceRate: 92 },
      'sw-2': { id: 'sw-2', name: 'Ava Wilson', age: 4, level: 'Level 1', parentName: 'Sarah Wilson', parentEmail: 'swilson@email.com', parentPhone: '(555) 234-5678', enrollmentDate: 'Feb 1, 2026', lastAttended: 'Feb 23, 2026', attendanceRate: 100 },
      'sw-3': { id: 'sw-3', name: 'Mason Lee', age: 5, level: 'Level 1', parentName: 'Jennifer Lee', parentEmail: 'jlee@email.com', parentPhone: '(555) 345-6789', enrollmentDate: 'Dec 10, 2025', lastAttended: 'Feb 21, 2026', attendanceRate: 88 },
      'sw-9': { id: 'sw-9', name: 'Emma Johnson', age: 7, level: 'Level 2', parentName: 'David Johnson', parentEmail: 'djohnson@email.com', parentPhone: '(555) 456-7890', enrollmentDate: 'Sep 5, 2025', lastAttended: 'Feb 23, 2026', attendanceRate: 95 },
      'sw-10': { id: 'sw-10', name: 'Olivia Brown', age: 8, level: 'Level 2', parentName: 'Lisa Brown', parentEmail: 'lbrown@email.com', parentPhone: '(555) 567-8901', enrollmentDate: 'Aug 20, 2025', lastAttended: 'Feb 23, 2026', attendanceRate: 97 },
      'sw-21': { id: 'sw-21', name: 'Liam Smith', age: 9, level: 'Level 3', parentName: 'Robert Smith', parentEmail: 'rsmith@email.com', parentPhone: '(555) 678-9012', enrollmentDate: 'Jun 1, 2025', lastAttended: 'Feb 23, 2026', attendanceRate: 98 },
      'sw-22': { id: 'sw-22', name: 'Emily Scott', age: 10, level: 'Level 3', parentName: 'Amanda Scott', parentEmail: 'ascott@email.com', parentPhone: '(555) 789-0123', enrollmentDate: 'May 15, 2025', lastAttended: 'Feb 23, 2026', attendanceRate: 100 },
      // Default fallback swimmer
      'swimmer-1': { id: 'swimmer-1', name: 'Emma Johnson', age: 7, level: 'Level 2', parentName: 'David Johnson', parentEmail: 'djohnson@email.com', parentPhone: '(555) 456-7890', enrollmentDate: 'Sep 5, 2025', lastAttended: 'Feb 23, 2026', attendanceRate: 95 },
      'swimmer-2': { id: 'swimmer-2', name: 'Liam Smith', age: 9, level: 'Level 3', parentName: 'Robert Smith', parentEmail: 'rsmith@email.com', parentPhone: '(555) 678-9012', enrollmentDate: 'Jun 1, 2025', lastAttended: 'Feb 23, 2026', attendanceRate: 98 },
      'swimmer-3': { id: 'swimmer-3', name: 'Olivia Brown', age: 8, level: 'Level 2', parentName: 'Lisa Brown', parentEmail: 'lbrown@email.com', parentPhone: '(555) 567-8901', enrollmentDate: 'Aug 20, 2025', lastAttended: 'Feb 23, 2026', attendanceRate: 97 },
      'swimmer-4': { id: 'swimmer-4', name: 'Noah Davis', age: 5, level: 'Level 1', parentName: 'Michael Davis', parentEmail: 'mdavis@email.com', parentPhone: '(555) 123-4567', enrollmentDate: 'Jan 15, 2026', lastAttended: 'Feb 23, 2026', attendanceRate: 92 },
    }),
    []
  );

  // Hardcoded skills by level - TODO: Replace with Supabase query
  const skillsByLevel: Record<string, Skill[]> = useMemo(
    () => ({
      'Level 1': [
        { id: 'sk1', name: 'Water comfort', category: 'Water Safety', mastered: true, dateAcquired: 'Jan 20, 2026' },
        { id: 'sk2', name: 'Bubbles & breath control', category: 'Water Safety', mastered: true, dateAcquired: 'Jan 25, 2026' },
        { id: 'sk3', name: 'Front float (5 sec)', category: 'Body Position', mastered: true, dateAcquired: 'Feb 1, 2026' },
        { id: 'sk4', name: 'Back float (5 sec)', category: 'Body Position', mastered: false },
        { id: 'sk5', name: 'Kicking with board', category: 'Propulsion', mastered: false },
        { id: 'sk6', name: 'Submerge face', category: 'Water Safety', mastered: true, dateAcquired: 'Feb 10, 2026' },
        { id: 'sk7', name: 'Wall exit safely', category: 'Water Safety', mastered: true, dateAcquired: 'Jan 18, 2026' },
        { id: 'sk8', name: 'Jump in with assistance', category: 'Entries', mastered: false },
      ],
      'Level 2': [
        { id: 'sk9', name: 'Freestyle arms', category: 'Stroke Development', mastered: true, dateAcquired: 'Dec 15, 2025' },
        { id: 'sk10', name: 'Freestyle breathing', category: 'Stroke Development', mastered: true, dateAcquired: 'Feb 10, 2026' },
        { id: 'sk11', name: 'Backstroke arms', category: 'Stroke Development', mastered: true, dateAcquired: 'Jan 28, 2026' },
        { id: 'sk12', name: 'Backstroke kick', category: 'Stroke Development', mastered: false },
        { id: 'sk13', name: 'Front float (15 sec)', category: 'Body Position', mastered: true, dateAcquired: 'Nov 20, 2025' },
        { id: 'sk14', name: 'Back float (15 sec)', category: 'Body Position', mastered: true, dateAcquired: 'Dec 5, 2025' },
        { id: 'sk15', name: 'Streamline push-off', category: 'Body Position', mastered: false },
        { id: 'sk16', name: 'Treading water (30 sec)', category: 'Water Safety', mastered: false },
        { id: 'sk17', name: 'Jump in unassisted', category: 'Entries', mastered: true, dateAcquired: 'Jan 10, 2026' },
        { id: 'sk18', name: 'Retrieve object underwater', category: 'Water Safety', mastered: false },
      ],
      'Level 3': [
        { id: 'sk19', name: 'Freestyle 25 yards', category: 'Stroke Proficiency', mastered: true, dateAcquired: 'Jan 15, 2026' },
        { id: 'sk20', name: 'Backstroke 25 yards', category: 'Stroke Proficiency', mastered: true, dateAcquired: 'Feb 1, 2026' },
        { id: 'sk21', name: 'Breaststroke kick', category: 'Stroke Development', mastered: true, dateAcquired: 'Feb 8, 2026' },
        { id: 'sk22', name: 'Breaststroke timing', category: 'Stroke Development', mastered: false },
        { id: 'sk23', name: 'Butterfly kick', category: 'Stroke Development', mastered: false },
        { id: 'sk24', name: 'Flip turn', category: 'Turns', mastered: false },
        { id: 'sk25', name: 'Diving from blocks', category: 'Entries', mastered: true, dateAcquired: 'Jan 20, 2026' },
        { id: 'sk26', name: 'Treading water (2 min)', category: 'Water Safety', mastered: true, dateAcquired: 'Dec 10, 2025' },
        { id: 'sk27', name: 'Underwater dolphin kick', category: 'Stroke Development', mastered: false },
        { id: 'sk28', name: 'Streamline off wall (10 yards)', category: 'Body Position', mastered: true, dateAcquired: 'Jan 25, 2026' },
      ],
    }),
    []
  );

  // Hardcoded notes - TODO: Replace with Supabase query
  const [notes, setNotes] = useState<Note[]>([
    { id: 'n1', date: 'Feb 23, 2026', content: 'Great progress on breathing technique today. Encourage practice at home.', author: 'Coach Sarah' },
    { id: 'n2', date: 'Feb 21, 2026', content: 'Working on streamline position. Needs to keep arms tighter.', author: 'Coach Sarah' },
    { id: 'n3', date: 'Feb 18, 2026', content: 'Excellent attitude! Very encouraging to other swimmers.', author: 'Coach Mike' },
  ]);

  // Hardcoded attendance - TODO: Replace with Supabase query
  const attendanceHistory: AttendanceRecord[] = useMemo(
    () => [
      { date: 'Feb 23, 2026', status: 'present', className: 'Level 2' },
      { date: 'Feb 21, 2026', status: 'present', className: 'Level 2' },
      { date: 'Feb 18, 2026', status: 'late', className: 'Level 2' },
      { date: 'Feb 16, 2026', status: 'present', className: 'Level 2' },
      { date: 'Feb 14, 2026', status: 'present', className: 'Level 2' },
      { date: 'Feb 11, 2026', status: 'excused', className: 'Level 2' },
      { date: 'Feb 9, 2026', status: 'present', className: 'Level 2' },
      { date: 'Feb 7, 2026', status: 'absent', className: 'Level 2' },
    ],
    []
  );

  const swimmer = swimmerData[swimmerId];
  const skills = swimmer ? skillsByLevel[swimmer.level] || [] : [];
  const masteredCount = skills.filter((s) => s.mastered).length;
  const progressPct = skills.length > 0 ? Math.round((masteredCount / skills.length) * 100) : 0;

  // Group skills by category
  const skillsByCategory = useMemo(() => {
    const grouped: Record<string, Skill[]> = {};
    skills.forEach((skill) => {
      if (!grouped[skill.category]) {
        grouped[skill.category] = [];
      }
      grouped[skill.category].push(skill);
    });
    return grouped;
  }, [skills]);

  const handleAddNote = () => {
    if (newNote.trim()) {
      const note: Note = {
        id: `n${Date.now()}`,
        date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        content: newNote.trim(),
        author: 'You',
      };
      setNotes([note, ...notes]);
      setNewNote('');
    }
  };

  if (!swimmer) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500">Swimmer not found</p>
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
      {/* Header */}
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
                {getInitials(swimmer.name)}
              </div>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">{swimmer.name}</h1>
                <p className="text-sm text-gray-500">Age {swimmer.age} • {swimmer.level}</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Overview Cards */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">{progressPct}%</p>
            <p className="text-xs text-gray-500">Skills Mastered</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">{masteredCount}/{skills.length}</p>
            <p className="text-xs text-gray-500">Skills Complete</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">{swimmer.attendanceRate}%</p>
            <p className="text-xs text-gray-500">Attendance Rate</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-sm font-semibold text-gray-900">{swimmer.lastAttended}</p>
            <p className="text-xs text-gray-500">Last Attended</p>
          </div>
        </section>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-gray-200">
          {(['skills', 'notes', 'attendance'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
                activeTab === tab
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'skills' && (
          <section className="space-y-6">
            {/* Progress Bar */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-900">{swimmer.level} Progress</span>
                <span className="text-sm text-gray-500">{masteredCount} of {skills.length} skills</span>
              </div>
              <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-gray-900 transition-all" style={{ width: `${progressPct}%` }} />
              </div>
            </div>

            {/* Skills by Category */}
            {Object.entries(skillsByCategory).map(([category, categorySkills]) => (
              <div key={category} className="bg-white rounded-xl border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">{category}</h3>
                  <p className="text-xs text-gray-500">
                    {categorySkills.filter((s) => s.mastered).length} of {categorySkills.length} mastered
                  </p>
                </div>
                <div className="divide-y divide-gray-100">
                  {categorySkills.map((skill) => (
                    <div key={skill.id} className="px-6 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span
                          className={`h-6 w-6 rounded-full flex items-center justify-center text-sm ${
                            skill.mastered ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
                          }`}
                        >
                          {skill.mastered ? '✓' : '○'}
                        </span>
                        <span className={`text-sm ${skill.mastered ? 'text-gray-900' : 'text-gray-600'}`}>
                          {skill.name}
                        </span>
                      </div>
                      {skill.mastered && skill.dateAcquired && (
                        <span className="text-xs text-gray-400">{skill.dateAcquired}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {activeTab === 'notes' && (
          <section className="space-y-4">
            {/* Add Note */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Add a note about this swimmer..."
                className="w-full h-24 p-3 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-gray-200"
              />
              <div className="flex justify-end mt-2">
                <button
                  onClick={handleAddNote}
                  disabled={!newNote.trim()}
                  className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition"
                >
                  Add Note
                </button>
              </div>
            </div>

            {/* Notes List */}
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
              {notes.length === 0 ? (
                <div className="p-6 text-center text-gray-500 text-sm">No notes yet</div>
              ) : (
                notes.map((note) => (
                  <div key={note.id} className="px-6 py-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-900">{note.author}</span>
                      <span className="text-xs text-gray-400">{note.date}</span>
                    </div>
                    <p className="text-sm text-gray-600">{note.content}</p>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {activeTab === 'attendance' && (
          <section className="bg-white rounded-xl border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Attendance History</h3>
              <p className="text-xs text-gray-500">Last 8 sessions</p>
            </div>
            <div className="divide-y divide-gray-100">
              {attendanceHistory.map((record, index) => (
                <div key={index} className="px-6 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-900">{record.date}</p>
                    <p className="text-xs text-gray-500">{record.className}</p>
                  </div>
                  <span
                    className={`px-3 py-1 text-xs font-medium rounded-full ${getStatusBadge(record.status)}`}
                  >
                    {record.status.charAt(0).toUpperCase() + record.status.slice(1)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Contact Info */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Parent/Guardian Contact</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-gray-500">Name</p>
              <p className="text-sm text-gray-900">{swimmer.parentName}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Email</p>
              <a href={`mailto:${swimmer.parentEmail}`} className="text-sm text-blue-600 hover:underline">
                {swimmer.parentEmail}
              </a>
            </div>
            <div>
              <p className="text-xs text-gray-500">Phone</p>
              <a href={`tel:${swimmer.parentPhone}`} className="text-sm text-blue-600 hover:underline">
                {swimmer.parentPhone}
              </a>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

