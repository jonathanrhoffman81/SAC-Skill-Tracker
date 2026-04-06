'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createAuthenticatedHeaders } from '@/lib/clientAuth';

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
    instructor_ids: string[];
    instructor_names: string[];
}

interface ClassGroup {
    className: string;
    students: StudentAssignment[];
    assignedToSelectedCount: number;
}

interface InstructorAssignmentManagerProps {}

interface TagColor {
    bg: string;
    text: string;
}

export default function InstructorAssignmentManager({}: InstructorAssignmentManagerProps) {
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
    const [selectedClassNames, setSelectedClassNames] = useState<Set<string>>(new Set());
    const [pendingStudentIds, setPendingStudentIds] = useState<Set<string>>(new Set());
    const [assigningClasses, setAssigningClasses] = useState(false);
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

    const showToast = useCallback((message: string) => {
        setToastMessage(message);
        if (toastTimeoutRef.current) {
            clearTimeout(toastTimeoutRef.current);
        }
        toastTimeoutRef.current = setTimeout(() => {
            setToastMessage(null);
        }, 2200);
    }, []);

    const fetchAssignmentData = useCallback(async () => {
        setLoading(true);
        setErrorMessage(null);

        try {
            const headers = await createAuthenticatedHeaders();
            const response = await fetch('/api/admin/instructor-member-assignments', { headers });
            if (!response.ok) {
                const errorPayload = await response.json().catch(() => ({}));
                throw new Error(errorPayload?.error || 'Failed to load assignments');
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

            const assignmentsByMemberId = new Map<string, string[]>();
            assignmentsData.forEach((assignment) => {
                const existing = assignmentsByMemberId.get(assignment.member_id) || [];
                if (!existing.includes(assignment.instructor_person_id)) {
                    existing.push(assignment.instructor_person_id);
                    assignmentsByMemberId.set(assignment.member_id, existing);
                }
            });

            const studentsWithAssignments: StudentAssignment[] = membersData.map((member) => {
                const instructorIds = assignmentsByMemberId.get(member.member_id) || [];
                return {
                    member_id: member.member_id,
                    first_name: member.first_name,
                    last_name: member.last_name,
                    class_names: member.class_names || [],
                    instructor_ids: instructorIds,
                    instructor_names: instructorIds
                        .map((instructorId) => instructorNameById.get(instructorId))
                        .filter((name): name is string => Boolean(name)),
                };
            });

            setInstructors(instructorsData);
            setSelectedInstructorId((prev) =>
                prev && instructorsData.some((inst) => inst.person_id === prev)
                    ? prev
                    : instructorsData[0]?.person_id || ''
            );
            setStudents(studentsWithAssignments);
        } catch (err) {
            console.error('Error fetching assignments:', err);
            setErrorMessage(err instanceof Error ? err.message : 'Failed to load swimmer assignments');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAssignmentData();
    }, [fetchAssignmentData]);

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

    const selectedInstructor =
        instructors.find((inst) => inst.person_id === selectedInstructorId) || null;

    const classFilterOptions = useMemo(
        () =>
            Array.from(
                new Set(
                    students.flatMap((student) =>
                        student.class_names.length ? student.class_names : ['No class']
                    )
                )
            ).sort((a, b) => a.localeCompare(b)),
        [students]
    );

    const matchesSearch = useCallback(
        (student: StudentAssignment) =>
            formatDisplayName(student.first_name, student.last_name)
                .toLowerCase()
                .includes(searchTerm.toLowerCase()),
        [searchTerm]
    );

    const matchesClassFilter = useCallback(
        (className: string) => classFilter === 'all' || classFilter === className,
        [classFilter]
    );

    const sortStudents = (list: StudentAssignment[]) =>
        [...list].sort((a, b) =>
            formatDisplayName(a.first_name, a.last_name).localeCompare(
                formatDisplayName(b.first_name, b.last_name)
            )
        );

    const classGroups = useMemo<ClassGroup[]>(() => {
        const classToStudents = new Map<string, StudentAssignment[]>();

        students.forEach((student) => {
            const classes = student.class_names.length ? student.class_names : ['No class'];
            classes.forEach((className) => {
                if (!matchesClassFilter(className) || !matchesSearch(student)) return;
                const existing = classToStudents.get(className) || [];
                existing.push(student);
                classToStudents.set(className, existing);
            });
        });

        return Array.from(classToStudents.entries())
            .map(([className, groupStudents]) => {
                const sorted = sortStudents(groupStudents);
                const assignedToSelectedCount = selectedInstructor
                    ? sorted.filter((student) =>
                        student.instructor_ids.includes(selectedInstructor.person_id)
                    ).length
                    : 0;
                return {
                    className,
                    students: sorted,
                    assignedToSelectedCount,
                };
            })
            .sort((a, b) => a.className.localeCompare(b.className));
    }, [students, matchesClassFilter, matchesSearch, selectedInstructor]);

    const selectedInstructorStudents = useMemo(
        () =>
            selectedInstructor
                ? sortStudents(
                    students.filter((student) =>
                        student.instructor_ids.includes(selectedInstructor.person_id)
                    )
                )
                : [],
        [students, selectedInstructor]
    );

    useEffect(() => {
        setSelectedClassNames((prev) => {
            const next = new Set(
                Array.from(prev).filter((className) =>
                    classGroups.some((group) => group.className === className)
                )
            );

            if (next.size === prev.size) {
                return prev;
            }

            return next;
        });
    }, [classGroups]);

    const setStudentPending = (memberIds: string[], pending: boolean) => {
        setPendingStudentIds((prev) => {
            const next = new Set(prev);
            memberIds.forEach((memberId) => {
                if (pending) next.add(memberId);
                else next.delete(memberId);
            });
            return next;
        });
    };

    const applyAssignmentChange = (
        memberIds: string[],
        instructorId: string,
        action: 'assign' | 'remove'
    ) => {
        const memberIdSet = new Set(memberIds);
        const instructorNameById = new Map(
            instructors.map((item) => [
                item.person_id,
                formatDisplayName(item.first_name, item.last_name),
            ])
        );
        setStudents((prev) =>
            prev.map((student) => {
                if (!memberIdSet.has(student.member_id)) return student;

                const nextInstructorIds =
                    action === 'assign'
                        ? Array.from(new Set([...student.instructor_ids, instructorId]))
                        : student.instructor_ids.filter((id) => id !== instructorId);

                const nextInstructorNames = Array.from(
                    new Set(
                        nextInstructorIds
                            .map((id) => instructorNameById.get(id))
                            .filter((name): name is string => Boolean(name))
                    )
                );

                return {
                    ...student,
                    instructor_ids: nextInstructorIds,
                    instructor_names: nextInstructorNames,
                };
            })
        );
    };

    const sendAssignmentRequest = async (
        memberIds: string[],
        instructorId: string,
        action: 'assign' | 'remove'
    ) => {
        const previousStudents = students;
        setStudentPending(memberIds, true);
        applyAssignmentChange(memberIds, instructorId, action);

        try {
            const response = await fetch('/api/admin/instructor-member-assignments', {
                headers: await createAuthenticatedHeaders({ 'Content-Type': 'application/json' }),
                method: action === 'assign' ? 'PUT' : 'DELETE',
                body: JSON.stringify({
                    member_ids: memberIds,
                    instructor_person_id: instructorId,
                }),
            });

            if (!response.ok) {
                const errorPayload = await response.json().catch(() => ({}));
                throw new Error(errorPayload?.error || 'Failed to update assignments');
            }

            if (action === 'assign') {
                showToast(memberIds.length === 1 ? 'Swimmer assigned successfully' : 'Classes assigned successfully');
            } else {
                showToast(memberIds.length === 1 ? 'Instructor access removed' : 'Class access removed');
            }
        } catch (err) {
            console.error('Error updating assignments:', err);
            setStudents(previousStudents);
            setErrorMessage(err instanceof Error ? err.message : 'Failed to update assignments');
        } finally {
            setStudentPending(memberIds, false);
        }
    };

    const handleAssignStudent = async (student: StudentAssignment) => {
        if (!selectedInstructor) return;
        await sendAssignmentRequest([student.member_id], selectedInstructor.person_id, 'assign');
    };

    const handleRemoveStudent = async (student: StudentAssignment) => {
        if (!selectedInstructor) return;
        await sendAssignmentRequest([student.member_id], selectedInstructor.person_id, 'remove');
    };

    const toggleClassSelection = (className: string) => {
        setSelectedClassNames((prev) => {
            const next = new Set(prev);
            if (next.has(className)) {
                next.delete(className);
            } else {
                next.add(className);
            }
            return next;
        });
    };

    const selectedClassGroups = useMemo(
        () => classGroups.filter((group) => selectedClassNames.has(group.className)),
        [classGroups, selectedClassNames]
    );

    const selectedClassMemberIds = useMemo(() => {
        if (!selectedInstructor) return [];

        return Array.from(
            new Set(
                selectedClassGroups.flatMap((group) =>
                    group.students
                        .filter((student) => !student.instructor_ids.includes(selectedInstructor.person_id))
                        .map((student) => student.member_id)
                )
            )
        );
    }, [selectedClassGroups, selectedInstructor]);

    const handleAssignSelectedClasses = async () => {
        if (!selectedInstructor || selectedClassMemberIds.length === 0) return;

        setAssigningClasses(true);
        try {
            await sendAssignmentRequest(selectedClassMemberIds, selectedInstructor.person_id, 'assign');
        } finally {
            setAssigningClasses(false);
        }
    };

    const manualAddStudents = useMemo(
        () =>
            selectedInstructor
                ? sortStudents(
                    students.filter(
                        (student) =>
                            !student.instructor_ids.includes(selectedInstructor.person_id) &&
                            matchesSearch(student)
                    )
                )
                : [],
        [matchesSearch, selectedInstructor, students]
    );

    const selectedClassFilterLabel = classFilter === 'all' ? 'All classes' : classFilter;

    return (
        <div className="space-y-4 relative">
            {toastMessage && (
                <div className="fixed top-4 right-4 z-50 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white shadow-lg">
                    {toastMessage}
                </div>
            )}

            {errorMessage && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 sm:p-4">
                    <p className="text-xs text-red-800 sm:text-sm">{errorMessage}</p>
                </div>
            )}

            <div className="rounded-2xl border border-sky-200 bg-gradient-to-r from-sky-50 to-cyan-50 p-4 sm:p-5">
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-sky-800">Class Assignment</p>
                <p className="text-sm font-semibold text-slate-900 sm:text-base">
                    Pick an instructor and assign them to one or more classes.
                </p>
                <p className="mt-2 text-xs text-slate-600 sm:text-sm">
                    You can select multiple classes at once, then manually add swimmers below if needed.
                </p>
            </div>

            <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Step 1</p>
                        <p className="mb-1 text-sm font-semibold text-slate-900">Choose Instructor</p>
                        <p className="mb-3 text-xs text-slate-500">Everything on this page updates for the selected instructor.</p>
                        <div ref={instructorDropdownRef} className="relative">
                            <button
                                type="button"
                                onClick={() => setShowInstructorDropdown((prev) => !prev)}
                                className="flex w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-3 py-3 text-xs outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500 sm:text-sm"
                            >
                                <span className="truncate text-left text-gray-900">
                                    {selectedInstructor
                                        ? formatDisplayName(selectedInstructor.first_name, selectedInstructor.last_name)
                                        : 'No instructors available'}
                                </span>
                                <svg
                                    className={`h-4 w-4 text-gray-500 transition-transform ${showInstructorDropdown ? 'rotate-180' : ''}`}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>

                            {showInstructorDropdown && (
                                <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                                    {instructors.length === 0 ? (
                                        <div className="px-3 py-2 text-xs text-gray-500 sm:text-sm">
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
                                                    className={`w-full px-3 py-2 text-left text-xs transition sm:text-sm ${isActive
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
                        {selectedInstructor && (
                            <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2">
                                <p className="text-xs text-slate-600">Working on</p>
                                <p className="text-sm font-medium text-slate-900">
                                    {formatDisplayName(selectedInstructor.first_name, selectedInstructor.last_name)}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                    {selectedClassNames.size} classes selected
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Step 2</p>
                                <p className="text-sm font-semibold text-slate-900">Choose Classes</p>
                                <p className="mt-1 text-xs text-slate-500">Click as many classes as you want, then assign them together.</p>
                            </div>
                            <div ref={classFilterDropdownRef} className="relative">
                                <button
                                    type="button"
                                    onClick={() => setShowClassFilterDropdown((prev) => !prev)}
                                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500 sm:text-sm"
                                >
                                    <span className="truncate text-left text-slate-900">{selectedClassFilterLabel}</span>
                                    <svg
                                        className={`h-4 w-4 text-slate-500 transition-transform ${showClassFilterDropdown ? 'rotate-180' : ''}`}
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </button>

                                {showClassFilterDropdown && (
                                    <div className="absolute right-0 z-30 mt-1 max-h-64 w-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setClassFilter('all');
                                                setShowClassFilterDropdown(false);
                                            }}
                                            className={`w-full px-3 py-2 text-left text-xs transition sm:text-sm ${classFilter === 'all'
                                                ? 'bg-sky-50 text-sky-700'
                                                : 'text-slate-900 hover:bg-slate-50'
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
                                                    className={`w-full px-3 py-2 text-left text-xs transition sm:text-sm ${isActive
                                                        ? 'bg-sky-50 text-sky-700'
                                                        : 'text-slate-900 hover:bg-slate-50'
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

                        <div className="mt-4 max-h-[420px] space-y-2 overflow-y-auto pr-1">
                            {classGroups.length === 0 ? (
                                <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-xs text-slate-500">
                                    No classes match the current filters.
                                </p>
                            ) : (
                                classGroups.map((group) => {
                                    const isSelected = selectedClassNames.has(group.className);
                                    return (
                                        <button
                                            key={group.className}
                                            type="button"
                                            onClick={() => toggleClassSelection(group.className)}
                                            className={`w-full rounded-2xl border px-3 py-3 text-left transition ${isSelected
                                                ? 'border-sky-300 bg-sky-50 shadow-sm'
                                                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                                                }`}
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className={`truncate text-sm font-semibold ${isSelected ? 'text-sky-900' : 'text-slate-900'}`}>
                                                        {group.className}
                                                    </p>
                                                    <p className="mt-1 text-xs text-slate-500">
                                                        {group.students.length} swimmers
                                                    </p>
                                                </div>
                                                <div className="text-right">
                                                    <p className={`text-xs font-semibold ${isSelected ? 'text-sky-700' : 'text-slate-700'}`}>
                                                        {group.assignedToSelectedCount}/{group.students.length}
                                                    </p>
                                                    <p className="text-[10px] text-slate-500">assigned</p>
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Step 3</p>
                                <p className="text-sm font-semibold text-slate-900">Assign Selected Classes</p>
                                <p className="mt-1 text-xs text-slate-500">
                                    Pick one or more classes on the left, then assign them together.
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={handleAssignSelectedClasses}
                                    disabled={selectedClassNames.size === 0 || selectedClassMemberIds.length === 0 || assigningClasses}
                                    className="rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:text-sm"
                                >
                                    {assigningClasses ? 'Assigning classes...' : 'Assign Selected Classes'}
                                </button>
                                <button
                                    onClick={() => setSelectedClassNames(new Set())}
                                    disabled={selectedClassNames.size === 0}
                                    className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 sm:text-sm"
                                >
                                    Clear
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {loading && (
                <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-white py-10">
                    <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-blue-600"></div>
                </div>
            )}

            {!loading && instructors.length === 0 && (
                <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
                    No instructors found.
                </div>
            )}

            {!loading && selectedInstructor && (
                <div className="bg-white rounded-lg sm:rounded-xl border border-gray-200 shadow-sm p-4 sm:p-6">
                    <p className="mb-3 text-xs font-semibold text-gray-900 sm:text-sm">
                        Swimmers In {formatDisplayName(selectedInstructor.first_name, selectedInstructor.last_name)}'s Classes ({selectedInstructorStudents.length})
                    </p>
                    {selectedInstructorStudents.length === 0 ? (
                        <p className="text-xs text-gray-500">No swimmers assigned to this instructor yet.</p>
                    ) : (
                        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                            {selectedInstructorStudents.map((student) => (
                                <div
                                    key={`assigned-${selectedInstructor.person_id}-${student.member_id}`}
                                    className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 p-2"
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs font-medium text-gray-900 sm:text-sm">
                                            {formatDisplayName(student.first_name, student.last_name)}
                                        </p>
                                        <div className="mt-1 flex flex-wrap gap-1">
                                            {(student.class_names.length ? student.class_names : ['No class']).map((className) => {
                                                const colors = getClassTagColors(className);
                                                return (
                                                    <span
                                                        key={`assigned-tag-${student.member_id}-${className}`}
                                                        className={`rounded-full px-1.5 py-0.5 text-[10px] ${colors.bg} ${colors.text}`}
                                                    >
                                                        {className}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleRemoveStudent(student)}
                                        disabled={pendingStudentIds.has(student.member_id)}
                                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[10px] font-medium text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 sm:text-xs"
                                    >
                                        {pendingStudentIds.has(student.member_id) ? 'Saving...' : 'Unassign'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {!loading && (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                    <p className="text-sm font-semibold text-slate-900">Manual Add Swimmers</p>
                    <p className="mt-1 text-xs text-slate-500">
                        Add swimmers one by one if they need access outside of their class assignment.
                    </p>

                    {!selectedInstructor ? (
                        <p className="mt-4 text-xs text-slate-500">Select an instructor to begin.</p>
                    ) : (
                        <>
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Search swimmers..."
                                className="mt-4 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500 sm:text-sm"
                            />

                            {manualAddStudents.length === 0 ? (
                                <p className="mt-4 rounded-xl border border-dashed border-slate-200 px-3 py-4 text-xs text-slate-500">
                                    No swimmers found to add.
                                </p>
                            ) : (
                                <div className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-1">
                                    {manualAddStudents.map((student) => (
                                        <div
                                            key={`manual-add-${student.member_id}`}
                                            className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 p-2"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs font-medium text-gray-900 sm:text-sm">
                                                    {formatDisplayName(student.first_name, student.last_name)}
                                                </p>
                                                <div className="mt-1 flex flex-wrap gap-1">
                                                    {(student.class_names.length ? student.class_names : ['No class']).map((className) => {
                                                        const colors = getClassTagColors(className);
                                                        return (
                                                            <span
                                                                key={`manual-add-tag-${student.member_id}-${className}`}
                                                                className={`rounded-full px-1.5 py-0.5 text-[10px] ${colors.bg} ${colors.text}`}
                                                            >
                                                                {className}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleAssignStudent(student)}
                                                disabled={pendingStudentIds.has(student.member_id)}
                                                className="rounded-lg bg-sky-600 px-3 py-2 text-[10px] font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:text-xs"
                                            >
                                                {pendingStudentIds.has(student.member_id) ? 'Saving...' : 'Add'}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
