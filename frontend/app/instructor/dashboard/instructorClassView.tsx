/**
 * Instructor Dashboard - Class View
 * From the instructor dashboard, when an instructor clicks on a specific class, they are taken to this page which shows the roster of swimmers in that class
 * Instructors can take class attendance easily 
 * Instructors can click on a swimmer to update their individual progress and skill assessments
 */

'use client';

import { useState, useMemo } from 'react';

// Types
interface ClassInfo {
  id: string;
  time: string;
  level: string;
  location: string;
  date: string;
  dayOfWeek: string;
}

interface ClassSwimmer {
  id: string;
  name: string;
  age: number;
  skillProgress: number; // percentage
  lastAttended: string;
  notes?: string;
}

interface AttendanceRecord {
  swimmerId: string;
  status: 'present' | 'absent' | 'late' | 'excused' | null;
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

function getStatusColor(status: AttendanceRecord['status']) {
  switch (status) {
    case 'present':
      return 'bg-green-100 text-green-700 border-green-200';
    case 'absent':
      return 'bg-red-100 text-red-700 border-red-200';
    case 'late':
      return 'bg-yellow-100 text-yellow-700 border-yellow-200';
    case 'excused':
      return 'bg-blue-100 text-blue-700 border-blue-200';
    default:
      return 'bg-gray-100 text-gray-500 border-gray-200';
  }
}

function getStatusIcon(status: AttendanceRecord['status']) {
  switch (status) {
    case 'present':
      return '✓';
    case 'absent':
      return '✕';
    case 'late':
      return '⏰';
    case 'excused':
      return 'E';
    default:
      return '○';
  }
}

interface InstructorClassViewProps {
  classId: string;
  onBack: () => void;
  onSwimmerClick: (swimmerId: string) => void;
}

export default function InstructorClassView({ classId, onBack, onSwimmerClick }: InstructorClassViewProps) {
  // Hardcoded class data - TODO: Replace with actual data from Supabase
  const classData: Record<string, ClassInfo> = useMemo(
    () => ({
      c1: {
        id: 'c1',
        time: '4:00 PM',
        level: 'Level 1',
        location: 'Pool A',
        date: 'Feb 25, 2026',
        dayOfWeek: 'Wednesday',
      },
      c2: {
        id: 'c2',
        time: '5:00 PM',
        level: 'Level 2',
        location: 'Pool A',
        date: 'Feb 25, 2026',
        dayOfWeek: 'Wednesday',
      },
      c3: {
        id: 'c3',
        time: '6:00 PM',
        level: 'Level 3',
        location: 'Pool B',
        date: 'Feb 25, 2026',
        dayOfWeek: 'Wednesday',
      },
    }),
    []
  );

  // Hardcoded swimmers by class - TODO: Replace with actual data from Supabase
  const swimmersByClass: Record<string, ClassSwimmer[]> = useMemo(
    () => ({
      c1: [
        { id: 'sw-1', name: 'Noah Davis', age: 5, skillProgress: 25, lastAttended: 'Feb 23, 2026', notes: 'Working on water comfort' },
        { id: 'sw-2', name: 'Ava Wilson', age: 4, skillProgress: 15, lastAttended: 'Feb 23, 2026' },
        { id: 'sw-3', name: 'Mason Lee', age: 5, skillProgress: 40, lastAttended: 'Feb 21, 2026', notes: 'Ready to move to Level 2 soon' },
        { id: 'sw-4', name: 'Sophia Martinez', age: 6, skillProgress: 35, lastAttended: 'Feb 23, 2026' },
        { id: 'sw-5', name: 'Lucas Anderson', age: 5, skillProgress: 20, lastAttended: 'Feb 18, 2026', notes: 'Missed last session - sick' },
        { id: 'sw-6', name: 'Isabella Thomas', age: 4, skillProgress: 10, lastAttended: 'Feb 23, 2026' },
        { id: 'sw-7', name: 'Ethan Garcia', age: 6, skillProgress: 45, lastAttended: 'Feb 23, 2026' },
        { id: 'sw-8', name: 'Mia Rodriguez', age: 5, skillProgress: 30, lastAttended: 'Feb 23, 2026' },
      ],
      c2: [
        { id: 'sw-9', name: 'Emma Johnson', age: 7, skillProgress: 50, lastAttended: 'Feb 23, 2026', notes: 'Breathing timing improved' },
        { id: 'sw-10', name: 'Olivia Brown', age: 8, skillProgress: 65, lastAttended: 'Feb 23, 2026' },
        { id: 'sw-11', name: 'William Taylor', age: 7, skillProgress: 55, lastAttended: 'Feb 21, 2026' },
        { id: 'sw-12', name: 'Charlotte Harris', age: 6, skillProgress: 45, lastAttended: 'Feb 23, 2026' },
        { id: 'sw-13', name: 'James Clark', age: 8, skillProgress: 70, lastAttended: 'Feb 23, 2026', notes: 'Excellent freestyle form' },
        { id: 'sw-14', name: 'Amelia Lewis', age: 7, skillProgress: 60, lastAttended: 'Feb 23, 2026' },
        { id: 'sw-15', name: 'Benjamin Walker', age: 6, skillProgress: 40, lastAttended: 'Feb 18, 2026' },
        { id: 'sw-16', name: 'Harper Hall', age: 8, skillProgress: 75, lastAttended: 'Feb 23, 2026' },
        { id: 'sw-17', name: 'Elijah Allen', age: 7, skillProgress: 55, lastAttended: 'Feb 23, 2026' },
        { id: 'sw-18', name: 'Evelyn Young', age: 7, skillProgress: 50, lastAttended: 'Feb 21, 2026' },
        { id: 'sw-19', name: 'Alexander King', age: 8, skillProgress: 68, lastAttended: 'Feb 23, 2026' },
        { id: 'sw-20', name: 'Abigail Wright', age: 6, skillProgress: 42, lastAttended: 'Feb 23, 2026' },
      ],
      c3: [
        { id: 'sw-21', name: 'Liam Smith', age: 9, skillProgress: 80, lastAttended: 'Feb 23, 2026', notes: 'Strong kick set' },
        { id: 'sw-22', name: 'Emily Scott', age: 10, skillProgress: 85, lastAttended: 'Feb 23, 2026' },
        { id: 'sw-23', name: 'Michael Green', age: 9, skillProgress: 75, lastAttended: 'Feb 21, 2026' },
        { id: 'sw-24', name: 'Elizabeth Baker', age: 10, skillProgress: 90, lastAttended: 'Feb 23, 2026', notes: 'Ready for competitive team' },
        { id: 'sw-25', name: 'Daniel Adams', age: 9, skillProgress: 70, lastAttended: 'Feb 23, 2026' },
        { id: 'sw-26', name: 'Sofia Nelson', age: 8, skillProgress: 65, lastAttended: 'Feb 18, 2026' },
        { id: 'sw-27', name: 'Matthew Hill', age: 10, skillProgress: 88, lastAttended: 'Feb 23, 2026' },
        { id: 'sw-28', name: 'Avery Campbell', age: 9, skillProgress: 72, lastAttended: 'Feb 23, 2026' },
        { id: 'sw-29', name: 'Joseph Mitchell', age: 10, skillProgress: 82, lastAttended: 'Feb 21, 2026' },
        { id: 'sw-30', name: 'Scarlett Roberts', age: 9, skillProgress: 78, lastAttended: 'Feb 23, 2026' },
      ],
    }),
    []
  );

  const currentClass = classData[classId];
  const swimmers = swimmersByClass[classId] || [];

  // Attendance state
  const [attendance, setAttendance] = useState<AttendanceRecord[]>(
    swimmers.map((s) => ({ swimmerId: s.id, status: null }))
  );
  const [attendanceSaved, setAttendanceSaved] = useState(false);

  // Update attendance for a single swimmer
  const updateAttendance = (swimmerId: string, status: AttendanceRecord['status']) => {
    setAttendance((prev) =>
      prev.map((record) =>
        record.swimmerId === swimmerId ? { ...record, status } : record
      )
    );
    setAttendanceSaved(false);
  };

  // Mark all as present
  const markAllPresent = () => {
    setAttendance((prev) => prev.map((record) => ({ ...record, status: 'present' })));
    setAttendanceSaved(false);
  };

  // Save attendance (simulated)
  const saveAttendance = () => {
    // TODO: Save to Supabase
    console.log('Saving attendance:', attendance);
    setAttendanceSaved(true);
  };

  // Get attendance stats
  const attendanceStats = useMemo(() => {
    const present = attendance.filter((a) => a.status === 'present').length;
    const absent = attendance.filter((a) => a.status === 'absent').length;
    const late = attendance.filter((a) => a.status === 'late').length;
    const excused = attendance.filter((a) => a.status === 'excused').length;
    const unmarked = attendance.filter((a) => a.status === null).length;
    return { present, absent, late, excused, unmarked, total: swimmers.length };
  }, [attendance, swimmers.length]);

  if (!currentClass) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500">Class not found</p>
          <button
            onClick={onBack}
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
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={onBack}
                className="p-2 -ml-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">{currentClass.level}</h1>
                <p className="text-sm text-gray-500">
                  {currentClass.dayOfWeek}, {currentClass.date} at {currentClass.time} • {currentClass.location}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={markAllPresent}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
              >
                Mark All Present
              </button>
              <button
                onClick={saveAttendance}
                disabled={attendanceSaved}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
                  attendanceSaved
                    ? 'bg-green-100 text-green-700 cursor-default'
                    : 'bg-gray-900 text-white hover:bg-gray-800'
                }`}
              >
                {attendanceSaved ? '✓ Saved' : 'Save Attendance'}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Attendance Summary */}
        <section className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">{attendanceStats.total}</p>
            <p className="text-xs text-gray-500">Total</p>
          </div>
          <div className="bg-green-50 rounded-xl border border-green-200 p-4 text-center">
            <p className="text-2xl font-bold text-green-700">{attendanceStats.present}</p>
            <p className="text-xs text-green-600">Present</p>
          </div>
          <div className="bg-red-50 rounded-xl border border-red-200 p-4 text-center">
            <p className="text-2xl font-bold text-red-700">{attendanceStats.absent}</p>
            <p className="text-xs text-red-600">Absent</p>
          </div>
          <div className="bg-yellow-50 rounded-xl border border-yellow-200 p-4 text-center">
            <p className="text-2xl font-bold text-yellow-700">{attendanceStats.late}</p>
            <p className="text-xs text-yellow-600">Late</p>
          </div>
          <div className="bg-blue-50 rounded-xl border border-blue-200 p-4 text-center">
            <p className="text-2xl font-bold text-blue-700">{attendanceStats.excused}</p>
            <p className="text-xs text-blue-600">Excused</p>
          </div>
        </section>

        {/* Swimmer List with Attendance */}
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Class Roster</h2>
              <p className="text-xs text-gray-500">
                {attendanceStats.unmarked > 0
                  ? `${attendanceStats.unmarked} swimmer${attendanceStats.unmarked > 1 ? 's' : ''} unmarked`
                  : 'All swimmers marked'}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-green-100 border border-green-200"></span>
                Present
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-red-100 border border-red-200"></span>
                Absent
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-yellow-100 border border-yellow-200"></span>
                Late
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-blue-100 border border-blue-200"></span>
                Excused
              </span>
            </div>
          </div>

          <div className="divide-y divide-gray-100">
            {swimmers.map((swimmer) => {
              const record = attendance.find((a) => a.swimmerId === swimmer.id);
              const currentStatus = record?.status ?? null;

              return (
                <div key={swimmer.id} className="px-6 py-4 hover:bg-gray-50 transition">
                  <div className="flex items-center justify-between gap-4">
                    {/* Swimmer Info */}
                    <button
                      onClick={() => onSwimmerClick(swimmer.id)}
                      className="flex items-center gap-4 text-left flex-1 min-w-0"
                    >
                      <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center text-sm font-semibold text-gray-700 flex-shrink-0">
                        {getInitials(swimmer.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900 truncate">{swimmer.name}</p>
                        <p className="text-xs text-gray-500">Age {swimmer.age} • Last attended: {swimmer.lastAttended}</p>
                        {swimmer.notes && (
                          <p className="text-xs text-gray-400 mt-1 truncate">📝 {swimmer.notes}</p>
                        )}
                      </div>
                      <div className="hidden md:flex items-center gap-3 flex-shrink-0">
                        <div className="w-24">
                          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                            <span>Progress</span>
                            <span>{swimmer.skillProgress}%</span>
                          </div>
                          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gray-900 transition-all"
                              style={{ width: `${swimmer.skillProgress}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </button>

                    {/* Attendance Buttons */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {(['present', 'absent', 'late', 'excused'] as const).map((status) => (
                        <button
                          key={status}
                          onClick={() => updateAttendance(swimmer.id, currentStatus === status ? null : status)}
                          className={`h-9 w-9 rounded-lg border flex items-center justify-center text-sm font-medium transition ${
                            currentStatus === status
                              ? getStatusColor(status)
                              : 'bg-white border-gray-200 text-gray-400 hover:bg-gray-50 hover:text-gray-600'
                          }`}
                          title={status.charAt(0).toUpperCase() + status.slice(1)}
                        >
                          {getStatusIcon(status)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Quick Actions */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button className="bg-white rounded-xl border border-gray-200 p-6 text-left hover:border-gray-300 transition">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center text-lg">
                📊
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Class Progress Report</p>
                <p className="text-xs text-gray-500">View overall skill mastery for this class</p>
              </div>
            </div>
          </button>

          <button className="bg-white rounded-xl border border-gray-200 p-6 text-left hover:border-gray-300 transition">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center text-lg">
                📝
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Add Class Note</p>
                <p className="text-xs text-gray-500">Record observations for the whole class</p>
              </div>
            </div>
          </button>

          <button className="bg-white rounded-xl border border-gray-200 p-6 text-left hover:border-gray-300 transition">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center text-lg">
                📅
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Attendance History</p>
                <p className="text-xs text-gray-500">View past attendance records</p>
              </div>
            </div>
          </button>
        </section>
      </main>
    </div>
  );
}
