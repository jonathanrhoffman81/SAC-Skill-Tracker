/**
 * InstructorAssignmentManager Component
 * Purpose: Assign swimmers to instructors using an instructor-first workflow
 * Features: pick from unassigned swimmers, view assigned lists, class tags per swimmer
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface Instructor {
    person_id: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
}

interface Student {
    member_id: string;
    first_name: string | null;
    last_name: string | null;
    class_names?: string[];
}

interface Assignment {
    member_id: string;
    instructor_person_id: string;
}

interface StudentAssignment {
    member_id: string;
    first_name: string | null;
    last_name: string | null;
    class_names: string[];
    instructor_person_id?: string | null;
    instructor_name?: string;
}

interface InstructorAssignmentManagerProps {
    userEmail: string;
}

interface TagColor {
    bg: string;
    text: string;
}

export default function InstructorAssignmentManager({
    userEmail,
}: InstructorAssignmentManagerProps) {
    const formatDisplayName = (firstName?: string | null, lastName?: string | null) => {
        const first = firstName?.trim() || '';
        const last = lastName?.trim() || '';
        return [first, last].filter(Boolean).join(' ') || 'Unnamed';
    };

    const [instructors, setInstructors] = useState<Instructor[]>([]);
    const [students, setStudents] = useState<StudentAssignment[]>([]);
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedInstructorId, setSelectedInstructorId] = useState('');
    const [classFilter, setClassFilter] = useState('all');
    const [pendingStudentIds, setPendingStudentIds] = useState<Set<string>>(new Set());
    const [showInstructorDropdown, setShowInstructorDropdown] = useState(false);
    const [showClassFilterDropdown, setShowClassFilterDropdown] = useState(false);
    const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const instructorDropdownRef = useRef<HTMLDivElement>(null);
    const classFilterDropdownRef = useRef<HTMLDivElement>(null);

    const classTagPalette: TagColor[] = [
        { bg: 'bg-blue-100', text: 'text-blue-800' },
        { bg: 'bg-emerald-100', text: 'text-emerald-800' },
        { bg: 'bg-amber-100', text: 'text-amber-800' },
        { bg: 'bg-fuchsia-100', text: 'text-fuchsia-800' },
        { bg: 'bg-cyan-100', text: 'text-cyan-800' },
        { bg: 'bg-lime-100', text: 'text-lime-800' },
        { bg: 'bg-rose-100', text: 'text-rose-800' },
        { bg: 'bg-violet-100', text: 'text-violet-800' },
        { bg: 'bg-orange-100', text: 'text-orange-800' },
        { bg: 'bg-teal-100', text: 'text-teal-800' },
        { bg: 'bg-indigo-100', text: 'text-indigo-800' },
        { bg: 'bg-pink-100', text: 'text-pink-800' },
    ];

    const getClassTagColors = (className: string): TagColor => {
        if (className === 'No class') {
            return { bg: 'bg-gray-100', text: 'text-gray-700' };
        }

        const hash = className
            .toLowerCase()
            .split('')
            .reduce((total, char) => total + char.charCodeAt(0), 0);
        return classTagPalette[hash % classTagPalette.length];
    };

    // Fetch members, instructors, and assignments together from the stable endpoint
    const fetchAssignmentData = useCallback(async () => {
        if (!userEmail) return;
        setLoading(true);
        setErrorMessage(null);
        try {
            const response = await fetch(
                `/api/admin/instructor-member-assignments?email=${encodeURIComponent(userEmail)}`
            );
            if (!response.ok) {
                const errorPayload = await response.json().catch(() => ({}));
                const errorMessage = errorPayload?.error || 'Failed to load assignments';
                throw new Error(errorMessage);
            }
            const data = await response.json();

            const instructorsData: Instructor[] = data.instructors || [];
            const membersData: Student[] = data.members || [];
            const assignmentsData: Assignment[] = data.assignments || [];

            const instructorNameById = new Map(
                instructorsData.map((instructor) => [
                    instructor.person_id,
                    formatDisplayName(instructor.first_name, instructor.last_name),
                ])
            );

            const assignmentByMemberId = new Map(
                assignmentsData.map((assignment) => [assignment.member_id, assignment.instructor_person_id])
            );

            // Build student assignments without deduplication; handle duplicates at data source.
            const studentsWithAssignments = membersData.map((member) => {
                const assignedInstructorId = assignmentByMemberId.get(member.member_id) || null;
                return {
                    member_id: member.member_id,
                    first_name: member.first_name,
                    last_name: member.last_name,
                    class_names: member.class_names || [],
                    instructor_person_id: assignedInstructorId,
                    instructor_name: assignedInstructorId
                        ? instructorNameById.get(assignedInstructorId) || 'Unknown'
                        : undefined,
                };
            });

            setInstructors(instructorsData);
            if (instructorsData.length > 0) {
                setSelectedInstructorId((prev) =>
                    prev && instructorsData.some((inst) => inst.person_id === prev)
                        ? prev
                        : instructorsData[0].person_id
                );
            } else {
                setSelectedInstructorId('');
            }
            setStudents(studentsWithAssignments);
        } catch (err) {
            console.error('Error fetching assignments:', err);
            const message = err instanceof Error ? err.message : 'Failed to load swimmer assignments';
            setErrorMessage(message);
        } finally {
            setLoading(false);
        }
    }, [userEmail]);

    // Load data on mount
    useEffect(() => {
        fetchAssignmentData();
    }, [userEmail, fetchAssignmentData]);

    useEffect(() => {
        return () => {
            if (toastTimeoutRef.current) {
                clearTimeout(toastTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (instructorDropdownRef.current && !instructorDropdownRef.current.contains(event.target as Node)) {
                setShowInstructorDropdown(false);
            }
            if (classFilterDropdownRef.current && !classFilterDropdownRef.current.contains(event.target as Node)) {
                setShowClassFilterDropdown(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const showToast = useCallback((message: string) => {
        setToastMessage(message);
        if (toastTimeoutRef.current) {
            clearTimeout(toastTimeoutRef.current);
        }
        toastTimeoutRef.current = setTimeout(() => {
            setToastMessage(null);
        }, 2000);
    }, []);

    // Assign a student to an instructor
    const handleAssignInstructor = async (
        studentId: string,
        instructorId: string | null
    ) => {
        if (!userEmail) return;

        const previousStudent = students.find((s) => s.member_id === studentId);
        if (!previousStudent) return;
        if (pendingStudentIds.has(studentId)) return;

        const selectedInstructor = instructors.find((i) => i.person_id === instructorId);
        const nextInstructorName = instructorId
            ? selectedInstructor
                ? `${selectedInstructor.first_name} ${selectedInstructor.last_name}`
                : 'Unknown'
            : undefined;

        // Optimistic update: UI responds instantly, then confirms with API.
        setPendingStudentIds((prev) => new Set(prev).add(studentId));
        setStudents((prev) =>
            prev.map((s) =>
                s.member_id === studentId
                    ? {
                        ...s,
                        instructor_person_id: instructorId,
                        instructor_name: nextInstructorName,
                    }
                    : s
            )
        );

        try {
            const response = await fetch('/api/admin/instructor-member-assignments', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: userEmail,
                    member_id: studentId,
                    instructor_person_id: instructorId,
                }),
            });

            if (!response.ok) {
                const errorPayload = await response.json().catch(() => ({}));
                throw new Error(errorPayload?.error || 'Failed to update assignment');
            }

            if (instructorId) {
                showToast('Swimmer assigned successfully');
            }
        } catch (err) {
            console.error('Error updating assignment:', err);
            const message = err instanceof Error ? err.message : 'Failed to update assignment';
            setErrorMessage(message);

            // Roll back this student only if request fails.
            setStudents((prev) =>
                prev.map((s) => (s.member_id === studentId ? previousStudent : s))
            );
        } finally {
            setPendingStudentIds((prev) => {
                const next = new Set(prev);
                next.delete(studentId);
                return next;
            });
        }
    };

    const classFilterOptions = Array.from(
        new Set(
            students.flatMap((student) =>
                student.class_names.length ? student.class_names : ['No class']
            )
        )
    ).sort((a, b) => a.localeCompare(b));

    const matchesClassFilter = (student: StudentAssignment) => {
        if (classFilter === 'all') return true;
        if (classFilter === 'No class') return student.class_names.length === 0;
        return student.class_names.includes(classFilter);
    };

    const sortStudents = (list: StudentAssignment[]) => {
        return [...list].sort((a, b) => {
            const aName = formatDisplayName(a.first_name, a.last_name);
            const bName = formatDisplayName(b.first_name, b.last_name);
            return aName.localeCompare(bName);
        });
    };

    // Unassigned pool with search + class filter + sort.
    const unassignedStudents = sortStudents(
        students.filter(
            (s) =>
                !s.instructor_person_id &&
                matchesClassFilter(s) &&
                formatDisplayName(s.first_name, s.last_name)
                    .toLowerCase()
                    .includes(searchTerm.toLowerCase())
        )
    );

    const assignedCount = students.filter((s) => Boolean(s.instructor_person_id)).length;
    const selectedInstructor = instructors.find((inst) => inst.person_id === selectedInstructorId) || null;
    const selectedClassFilterLabel = classFilter === 'all' ? 'All classes' : classFilter;
    const selectedInstructorAssignedStudents = selectedInstructor
        ? sortStudents(
            students.filter(
                (s) =>
                    s.instructor_person_id === selectedInstructor.person_id &&
                    matchesClassFilter(s)
            )
        )
        : [];

    return (
        <div className="space-y-4 relative">
            {toastMessage && (
                <div className="fixed top-4 right-4 z-50 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm shadow-lg">
                    {toastMessage}
                </div>
            )}

            {/* Messages */}
            {errorMessage && (
                <div className="p-3 sm:p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-xs sm:text-sm text-red-800">{errorMessage}</p>
                </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4">
                <p className="text-xs sm:text-sm font-semibold text-blue-900 mb-1">How to use</p>
                <p className="text-xs sm:text-sm text-blue-800">
                    Pick an instructor at the top and search and assign swimmers directly.
                </p>
            </div>

            {/* Quick stats, instructor selector, and filter */}
            <div className="bg-white rounded-lg sm:rounded-xl border border-gray-200 shadow-sm p-4 sm:p-6">
                <div className="grid grid-cols-1 gap-3">
                    <div>
                        <p className="text-xs sm:text-sm font-medium text-gray-800 mb-1">
                            Instructor
                        </p>
                        <div ref={instructorDropdownRef} className="relative">
                            <button
                                type="button"
                                onClick={() => setShowInstructorDropdown((prev) => !prev)}
                                className="w-full px-3 py-2 text-xs sm:text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none flex items-center justify-between"
                            >
                                <span className="text-gray-900 truncate text-left">
                                    {selectedInstructor
                                        ? formatDisplayName(selectedInstructor.first_name, selectedInstructor.last_name)
                                        : 'No instructors available'}
                                </span>
                                <svg
                                    className={`w-4 h-4 text-gray-500 transition-transform ${showInstructorDropdown ? 'rotate-180' : ''}`}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>

                            {showInstructorDropdown && (
                                <div className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                                    {instructors.length === 0 ? (
                                        <div className="px-3 py-2 text-xs sm:text-sm text-gray-500">
                                            No instructors available
                                        </div>
                                    ) : (
                                        instructors.map((instructor) => {
                                            const isActive = instructor.person_id === selectedInstructorId;
                                            return (
                                                <button
                                                    key={instructor.person_id}
                                                    type="button"
                                                    onClick={() => {
                                                        setSelectedInstructorId(instructor.person_id);
                                                        setShowInstructorDropdown(false);
                                                    }}
                                                    className={`w-full text-left px-3 py-2 text-xs sm:text-sm transition ${isActive
                                                        ? 'bg-blue-50 text-blue-700'
                                                        : 'text-gray-900 hover:bg-gray-50'
                                                        }`}
                                                >
                                                    {formatDisplayName(instructor.first_name, instructor.last_name)}
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {selectedInstructor && (
                    <p className="text-xs text-gray-500 mt-3">
                        Assigning swimmers to: {formatDisplayName(selectedInstructor.first_name, selectedInstructor.last_name)}
                    </p>
                )}
            </div>

            {loading && (
                <div className="flex items-center justify-center py-10 bg-white rounded-lg border border-gray-200">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                </div>
            )}

            {!loading && instructors.length === 0 && (
                <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-sm text-gray-500">
                    No instructors found.
                </div>
            )}

            {/* Unassigned swimmers quick view */}
            {!loading && (
                <div className="bg-white rounded-lg sm:rounded-xl border border-gray-200 shadow-sm p-4 sm:p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                        <div>
                            <p className="text-xs sm:text-sm font-semibold text-gray-900">
                                Unassigned Swimmers ({unassignedStudents.length})
                            </p>
                            <div className="flex flex-wrap items-center gap-2 mt-2">
                                <span className="px-2 py-1 text-[10px] sm:text-xs bg-blue-100 text-blue-800 rounded-full">
                                    Assigned: {assignedCount}
                                </span>
                                <span className="px-2 py-1 text-[10px] sm:text-xs bg-orange-100 text-orange-800 rounded-full">
                                    Unassigned: {students.length - assignedCount}
                                </span>
                            </div>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Search swimmers..."
                                className="w-full sm:w-64 px-3 py-2 text-xs sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            />
                            <div ref={classFilterDropdownRef} className="relative w-full sm:w-56">
                                <button
                                    type="button"
                                    onClick={() => setShowClassFilterDropdown((prev) => !prev)}
                                    className="w-full px-3 py-2 text-xs sm:text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none flex items-center justify-between"
                                >
                                    <span className="text-gray-900 truncate text-left">{selectedClassFilterLabel}</span>
                                    <svg
                                        className={`w-4 h-4 text-gray-500 transition-transform ${showClassFilterDropdown ? 'rotate-180' : ''}`}
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </button>

                                {showClassFilterDropdown && (
                                    <div className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setClassFilter('all');
                                                setShowClassFilterDropdown(false);
                                            }}
                                            className={`w-full text-left px-3 py-2 text-xs sm:text-sm transition ${classFilter === 'all'
                                                ? 'bg-blue-50 text-blue-700'
                                                : 'text-gray-900 hover:bg-gray-50'
                                                }`}
                                        >
                                            All classes
                                        </button>
                                        {classFilterOptions.map((className) => {
                                            const isActive = classFilter === className;
                                            return (
                                                <button
                                                    key={className}
                                                    type="button"
                                                    onClick={() => {
                                                        setClassFilter(className);
                                                        setShowClassFilterDropdown(false);
                                                    }}
                                                    className={`w-full text-left px-3 py-2 text-xs sm:text-sm transition ${isActive
                                                        ? 'bg-blue-50 text-blue-700'
                                                        : 'text-gray-900 hover:bg-gray-50'
                                                        }`}
                                                >
                                                    {className}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    {unassignedStudents.length === 0 ? (
                        <p className="text-xs text-gray-500">No unassigned swimmers match your search.</p>
                    ) : (
                        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                            {unassignedStudents.map((student) => (
                                <div
                                    key={`unassigned-${student.member_id}`}
                                    className="flex items-center justify-between gap-2 p-2 border border-gray-200 rounded-lg"
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs sm:text-sm text-gray-900 truncate">
                                            {formatDisplayName(student.first_name, student.last_name)}
                                        </p>
                                        <div className="flex flex-wrap gap-1 mt-1">
                                            {(student.class_names.length ? student.class_names : ['No class']).map((className) => {
                                                const colors = getClassTagColors(className);
                                                return (
                                                    <span
                                                        key={`tag-${student.member_id}-${className}`}
                                                        className={`px-1.5 py-0.5 text-[10px] rounded-full ${colors.bg} ${colors.text}`}
                                                    >
                                                        {className}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => selectedInstructor && handleAssignInstructor(student.member_id, selectedInstructor.person_id)}
                                        disabled={!selectedInstructor || pendingStudentIds.has(student.member_id)}
                                        className="text-[10px] sm:text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                                    >
                                        {pendingStudentIds.has(student.member_id) ? 'Assigning...' : 'Assign'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Assigned swimmers for selected instructor */}
            {!loading && selectedInstructor && (
                <div className="bg-white rounded-lg sm:rounded-xl border border-gray-200 shadow-sm p-4 sm:p-6">
                    <p className="text-xs sm:text-sm font-semibold text-gray-900 mb-3">
                        Assigned to {formatDisplayName(selectedInstructor.first_name, selectedInstructor.last_name)} ({selectedInstructorAssignedStudents.length})
                    </p>
                    {selectedInstructorAssignedStudents.length === 0 ? (
                        <p className="text-xs text-gray-500">No swimmers assigned yet.</p>
                    ) : (
                        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                            {selectedInstructorAssignedStudents.map((student) => (
                                <div
                                    key={`assigned-${student.member_id}`}
                                    className="flex items-center justify-between gap-2 p-2 border border-gray-200 rounded-lg"
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs sm:text-sm font-medium text-gray-900 truncate">
                                            {formatDisplayName(student.first_name, student.last_name)}
                                        </p>
                                        <div className="flex flex-wrap gap-1 mt-1">
                                            {(student.class_names.length ? student.class_names : ['No class']).map((className) => {
                                                const colors = getClassTagColors(className);
                                                return (
                                                    <span
                                                        key={`assigned-tag-${student.member_id}-${className}`}
                                                        className={`px-1.5 py-0.5 text-[10px] rounded-full ${colors.bg} ${colors.text}`}
                                                    >
                                                        {className}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleAssignInstructor(student.member_id, null)}
                                        disabled={pendingStudentIds.has(student.member_id)}
                                        className="text-[10px] sm:text-xs px-2 py-1 border border-gray-300 rounded text-gray-700 hover:bg-gray-100 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                                    >
                                        {pendingStudentIds.has(student.member_id) ? 'Saving...' : 'Unassign'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
