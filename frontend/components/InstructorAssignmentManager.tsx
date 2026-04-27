'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { authFetch } from '@/lib/clientAuth';

interface Instructor {
    person_id: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
}

interface Group {
    group_id: string;
    class_id: string;
    class_name: string;
    group_name: string;
    class_start_date?: string | null;
    class_end_date?: string | null;
}

interface Assignment {
    group_id: string;
    instructor_person_id: string;
}

interface EnrollmentRow {
    member_id: string;
    class_id: string;
    group_id: string | null;
    group_name: string | null;
    class_name: string;
    class_start_date?: string | null;
    class_end_date?: string | null;
    member_first_name: string;
    member_last_name: string;
    date_of_birth: string | null;
    slot: number | null;
}

type ClassDateFilter = 'active' | 'past';

type ClassFilterOption = {
    class_id: string;
    class_name: string;
    class_start_date?: string | null;
    class_end_date?: string | null;
};

interface TagColor {
    bg: string;
    text: string;
}

type GroupDeletePrompt = {
    group: Group;
    swimmerCount: number;
} | null;

type SelectOption = {
    value: string;
    label: string;
    disabled?: boolean;
};

type StyledSelectProps = {
    value: string;
    onChange: (value: string) => void;
    options: SelectOption[];
    placeholder?: string;
    sizeMode?: 'default' | 'compact';
    className?: string;
    disabled?: boolean;
    ariaLabel?: string;
};

type StyledMultiSelectProps = {
    values: string[];
    onChange: (values: string[]) => void;
    options: SelectOption[];
    placeholder?: string;
    sizeMode?: 'default' | 'compact';
    className?: string;
    disabled?: boolean;
    ariaLabel?: string;
};

function getViewportClampedMenuPosition(rect: DOMRect, desiredMenuHeight: number) {
    const viewportPadding = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const preferredWidth = rect.width;
    const maxWidth = Math.max(160, viewportWidth - viewportPadding * 2);
    const width = Math.min(preferredWidth, maxWidth);
    const left = Math.min(
        Math.max(viewportPadding, rect.left),
        Math.max(viewportPadding, viewportWidth - width - viewportPadding),
    );

    const spaceBelow = viewportHeight - rect.bottom - viewportPadding - 4;
    const spaceAbove = rect.top - viewportPadding - 4;
    const fitsBelow = spaceBelow >= desiredMenuHeight;
    const fitsAbove = spaceAbove >= desiredMenuHeight;

    let top = rect.bottom + 4;
    let maxHeight = desiredMenuHeight;

    if (!fitsBelow && fitsAbove) {
        top = Math.max(viewportPadding, rect.top - 4 - desiredMenuHeight);
    } else if (!fitsBelow && !fitsAbove) {
        if (spaceBelow >= spaceAbove) {
            top = rect.bottom + 4;
            maxHeight = Math.max(120, spaceBelow);
        } else {
            top = Math.max(viewportPadding, rect.top - 4 - Math.max(120, spaceAbove));
            maxHeight = Math.max(120, spaceAbove);
        }
    }

    return {
        top,
        left,
        width,
        maxHeight,
    };
}

function StyledSelect({
    value,
    onChange,
    options,
    placeholder,
    sizeMode = 'default',
    className = '',
    disabled = false,
    ariaLabel,
}: StyledSelectProps) {
    const [open, setOpen] = useState(false);
    const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number; maxHeight: number }>({
        top: 0,
        left: 0,
        width: 0,
        maxHeight: 0,
    });
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);

    const updateMenuPosition = useCallback(() => {
        const element = wrapperRef.current;
        if (!element) return;
        const rect = element.getBoundingClientRect();
        setMenuPosition(getViewportClampedMenuPosition(rect, 224));
    }, []);

    useEffect(() => {
        const onClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (wrapperRef.current?.contains(target) || menuRef.current?.contains(target)) {
                return;
            }
            if (!wrapperRef.current?.contains(target)) {
                setOpen(false);
            }
        };

        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, []);

    useEffect(() => {
        if (!open) return;

        updateMenuPosition();

        const handleWindowChange = () => updateMenuPosition();
        window.addEventListener('resize', handleWindowChange);
        window.addEventListener('scroll', handleWindowChange, true);

        return () => {
            window.removeEventListener('resize', handleWindowChange);
            window.removeEventListener('scroll', handleWindowChange, true);
        };
    }, [open, updateMenuPosition]);

    const sizeClasses = sizeMode === 'compact'
        ? 'h-8 text-xs px-2 pr-7 rounded-lg'
        : 'h-10 text-xs sm:text-sm px-3 pr-8 rounded-xl';

    const selectedOption = options.find((option) => option.value === value);
    const selectedLabel = selectedOption?.label || placeholder || 'Select';

    return (
        <div ref={wrapperRef} className={`relative ${open ? 'z-50' : ''} ${className}`}>
            <button
                type="button"
                aria-label={ariaLabel}
                onClick={() => !disabled && setOpen((prev) => !prev)}
                disabled={disabled}
                className={`w-full border border-slate-300 bg-white text-left text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 ${sizeClasses}`}
            >
                <span className="block line-clamp-2">{selectedLabel}</span>
            </button>
            <svg
                className={`pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
            >
                <path d="M5 7.5L10 12.5L15 7.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>

            {open && !disabled && createPortal(
                <div
                    ref={menuRef}
                    className="fixed z-[2000] max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                    style={{
                        top: menuPosition.top,
                        left: menuPosition.left,
                        width: menuPosition.width,
                    }}
                >
                    {options.map((option) => {
                        const isSelected = option.value === value && !option.disabled;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                disabled={option.disabled}
                                onClick={() => {
                                    onChange(option.value);
                                    setOpen(false);
                                }}
                                className={`flex w-full items-start gap-2 justify-between px-2.5 py-1.5 text-left text-xs sm:text-sm ${isSelected
                                    ? 'bg-sky-50 text-sky-700'
                                    : 'text-slate-700 hover:bg-slate-50'} disabled:cursor-not-allowed disabled:opacity-50`}
                            >
                                <span className="line-clamp-2">{option.label}</span>
                                {isSelected && <span className="shrink-0 text-[11px]">✓</span>}
                            </button>
                        );
                    })}
                </div>,
                document.body,
            )}
        </div>
    );
}

function StyledMultiSelect({
    values,
    onChange,
    options,
    placeholder = 'Select',
    sizeMode = 'default',
    className = '',
    disabled = false,
    ariaLabel,
}: StyledMultiSelectProps) {
    const [open, setOpen] = useState(false);
    const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number; maxHeight: number }>({
        top: 0,
        left: 0,
        width: 0,
        maxHeight: 0,
    });
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);

    const updateMenuPosition = useCallback(() => {
        const element = wrapperRef.current;
        if (!element) return;
        const rect = element.getBoundingClientRect();
        setMenuPosition(getViewportClampedMenuPosition(rect, 240));
    }, []);

    useEffect(() => {
        const onClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (wrapperRef.current?.contains(target) || menuRef.current?.contains(target)) {
                return;
            }
            setOpen(false);
        };

        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, []);

    useEffect(() => {
        if (!open) return;

        updateMenuPosition();

        const handleWindowChange = () => updateMenuPosition();
        window.addEventListener('resize', handleWindowChange);
        window.addEventListener('scroll', handleWindowChange, true);

        return () => {
            window.removeEventListener('resize', handleWindowChange);
            window.removeEventListener('scroll', handleWindowChange, true);
        };
    }, [open, updateMenuPosition]);

    const sizeClasses = sizeMode === 'compact'
        ? 'h-8 text-xs px-2 pr-7 rounded-lg'
        : 'h-10 text-xs sm:text-sm px-3 pr-8 rounded-xl';

    const selectedLabels = options
        .filter((option) => values.includes(option.value))
        .map((option) => option.label);

    const displayLabel = selectedLabels.length === 0
        ? placeholder
        : selectedLabels.length <= 2
            ? selectedLabels.join(', ')
            : `${selectedLabels.length} selected`;

    const toggleValue = (optionValue: string) => {
        if (values.includes(optionValue)) {
            onChange(values.filter((value) => value !== optionValue));
            return;
        }
        onChange([...values, optionValue]);
    };

    return (
        <div ref={wrapperRef} className={`relative ${open ? 'z-50' : ''} ${className}`}>
            <button
                type="button"
                aria-label={ariaLabel}
                onClick={() => !disabled && setOpen((prev) => !prev)}
                disabled={disabled}
                className={`w-full border border-slate-300 bg-white text-left text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 ${sizeClasses}`}
            >
                <span className="block line-clamp-2">{displayLabel}</span>
            </button>
            <svg
                className={`pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
            >
                <path d="M5 7.5L10 12.5L15 7.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>

            {open && !disabled && createPortal(
                <div
                    ref={menuRef}
                    className="fixed z-[2000] max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                    style={{
                        top: menuPosition.top,
                        left: menuPosition.left,
                        width: menuPosition.width,
                        maxHeight: menuPosition.maxHeight,
                    }}
                >
                    {options.map((option) => {
                        const isSelected = values.includes(option.value) && !option.disabled;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                disabled={option.disabled}
                                onClick={() => toggleValue(option.value)}
                                className={`flex w-full items-start gap-2 justify-between px-2.5 py-1.5 text-left text-xs sm:text-sm ${isSelected
                                    ? 'bg-sky-50 text-sky-700'
                                    : 'text-slate-700 hover:bg-slate-50'} disabled:cursor-not-allowed disabled:opacity-50`}
                            >
                                <span className="line-clamp-2">{option.label}</span>
                                <span className="shrink-0 text-[11px]">{isSelected ? '✓' : ''}</span>
                            </button>
                        );
                    })}
                </div>,
                document.body,
            )}
        </div>
    );
}

export default function InstructorAssignmentManager() {
    const SWIMMER_PAGE_SIZE = 25;
    const GROUP_PAGE_SIZE = 8;

    const [instructors, setInstructors] = useState<Instructor[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const [classDateFilter, setClassDateFilter] = useState<ClassDateFilter>('active');
    const [classFilter, setClassFilter] = useState('all');
    const [slotFilter, setSlotFilter] = useState('all');
    const [assignmentFilter, setAssignmentFilter] = useState<'all' | 'unassigned' | 'assigned'>('all');
    const [swimmerPage, setSwimmerPage] = useState(1);
    const [groupPage, setGroupPage] = useState(1);
    const [pendingEnrollmentKeys, setPendingEnrollmentKeys] = useState<Set<string>>(new Set());
    const [pendingInstructorKeys, setPendingInstructorKeys] = useState<Set<string>>(new Set());
    const [selectedEnrollmentKeys, setSelectedEnrollmentKeys] = useState<Set<string>>(new Set());
    const [bulkGroupId, setBulkGroupId] = useState('');
    const [bulkPending, setBulkPending] = useState(false);
    const [createGroupPending, setCreateGroupPending] = useState(false);
    const [pendingGroupDeleteIds, setPendingGroupDeleteIds] = useState<Set<string>>(new Set());
    const [deleteGroupPrompt, setDeleteGroupPrompt] = useState<GroupDeletePrompt>(null);
    const hasCompletedInitialLoadRef = useRef(false);

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
        const hash = className
            .toLowerCase()
            .split('')
            .reduce((total, char) => total + char.charCodeAt(0), 0);
        return classTagPalette[hash % classTagPalette.length];
    };

    const showToast = useCallback((message: string) => {
        setToastMessage(message);
        setTimeout(() => setToastMessage(null), 2200);
    }, []);

    const formatName = (firstName?: string | null, lastName?: string | null) =>
        [firstName || '', lastName || ''].join(' ').trim() || 'Unnamed';

    const getAge = (dob?: string | null) => {
        if (!dob) return null;
        const date = new Date(dob);
        if (Number.isNaN(date.getTime())) return null;
        const now = new Date();
        let age = now.getFullYear() - date.getFullYear();
        const monthDelta = now.getMonth() - date.getMonth();
        if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < date.getDate())) {
            age -= 1;
        }
        return age;
    };

    const formatSlotLabel = (slot: number | null) =>
        slot === null || slot === undefined ? '—' : String(slot);

    const slotSortValue = (slot: number | null | undefined) => {
        if (slot === null || slot === undefined) return Number.MAX_SAFE_INTEGER;
        const parsed = Number(slot);
        return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
    };

    const parseClassDate = (value?: string | null, endOfDay = false) => {
        if (!value) return null;
        const parsed = new Date(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}`);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const isPastClass = (startDate?: string | null, endDate?: string | null) => {
        const now = new Date();
        const end = parseClassDate(endDate, true);
        if (end) return end < now;

        const start = parseClassDate(startDate, true);
        if (!start) return false;
        return start < now;
    };

    const matchesClassDateFilter = (startDate?: string | null, endDate?: string | null) => {
        const past = isPastClass(startDate, endDate);
        return classDateFilter === 'past' ? past : !past;
    };

    const enrollmentKey = (row: EnrollmentRow) => `${row.member_id}:${row.class_id}`;

    const fetchAssignmentData = useCallback(async (options?: { silent?: boolean }) => {
        const showBlockingLoader = !hasCompletedInitialLoadRef.current && !options?.silent;
        if (showBlockingLoader) {
            setLoading(true);
        }
        setErrorMessage(null);

        try {
            const response = await authFetch('/api/admin/instructor-member-assignments');
            if (!response.ok) {
                const errorPayload = await response.json().catch(() => ({}));
                throw new Error(errorPayload?.error || 'Failed to load assignments');
            }

            const data = await response.json();
            setInstructors(data.instructors || []);
            setGroups(data.groups || []);
            setAssignments(data.assignments || []);
            setEnrollments(data.enrollments || []);
        } catch (err) {
            console.error('Error fetching assignments:', err);
            setErrorMessage(err instanceof Error ? err.message : 'Failed to load assignments');
        } finally {
            if (!hasCompletedInitialLoadRef.current) {
                hasCompletedInitialLoadRef.current = true;
                setLoading(false);
            } else if (showBlockingLoader) {
                setLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        fetchAssignmentData();
    }, [fetchAssignmentData]);

    const instructorNameById = useMemo(
        () => new Map(instructors.map((instructor) => [
            instructor.person_id,
            formatName(instructor.first_name, instructor.last_name),
        ])),
        [instructors],
    );

    const sortedInstructors = useMemo(() => {
        return [...instructors].sort((a, b) =>
            formatName(a.first_name, a.last_name).localeCompare(formatName(b.first_name, b.last_name)),
        );
    }, [instructors]);

    const instructorInfoByGroupId = useMemo(() => {
        const map = new Map<string, { id: string; name: string }[]>();
        assignments.forEach((assignment) => {
            const name = instructorNameById.get(assignment.instructor_person_id);
            if (!name) return;
            const existing = map.get(assignment.group_id) || [];
            if (!existing.some((item) => item.id === assignment.instructor_person_id)) {
                existing.push({ id: assignment.instructor_person_id, name });
            }
            map.set(assignment.group_id, existing);
        });
        map.forEach((items, groupId) => {
            map.set(
                groupId,
                [...items].sort((a, b) => a.name.localeCompare(b.name)),
            );
        });
        return map;
    }, [assignments, instructorNameById]);

    const instructorNamesByGroupId = useMemo(() => {
        const map = new Map<string, string[]>();
        instructorInfoByGroupId.forEach((items, groupId) => {
            map.set(groupId, items.map((item) => item.name));
        });
        return map;
    }, [instructorInfoByGroupId]);

    const groupById = useMemo(
        () => new Map(groups.map((group) => [group.group_id, group])),
        [groups],
    );

    const groupsByClassId = useMemo(() => {
        const map = new Map<string, Group[]>();
        groups.forEach((group) => {
            const existing = map.get(group.class_id) || [];
            existing.push(group);
            map.set(group.class_id, existing);
        });
        return map;
    }, [groups]);

    const swimmersByGroupId = useMemo(() => {
        const map = new Map<string, { memberId: string; name: string; age: number | null; slot: number | null }[]>();
        enrollments.forEach((row) => {
            if (!row.group_id) return;
            const existing = map.get(row.group_id) || [];
            existing.push({
                memberId: row.member_id,
                name: formatName(row.member_first_name, row.member_last_name),
                age: getAge(row.date_of_birth),
                slot: row.slot,
            });
            map.set(row.group_id, existing);
        });
        map.forEach((items, groupId) => {
            map.set(groupId, [...items].sort((a, b) => {
                const slotA = slotSortValue(a.slot);
                const slotB = slotSortValue(b.slot);
                if (slotA !== slotB) return slotA - slotB;
                const ageA = a.age ?? Number.MAX_SAFE_INTEGER;
                const ageB = b.age ?? Number.MAX_SAFE_INTEGER;
                if (ageA !== ageB) return ageA - ageB;
                return a.name.localeCompare(b.name);
            }));
        });
        return map;
    }, [enrollments]);

    const classOptions = useMemo(() => {
        const byClassId = new Map<string, ClassFilterOption>();

        enrollments.forEach((row) => {
            if (!byClassId.has(row.class_id)) {
                byClassId.set(row.class_id, {
                    class_id: row.class_id,
                    class_name: row.class_name,
                    class_start_date: row.class_start_date,
                    class_end_date: row.class_end_date,
                });
            }
        });

        groups.forEach((group) => {
            if (!byClassId.has(group.class_id)) {
                byClassId.set(group.class_id, {
                    class_id: group.class_id,
                    class_name: group.class_name,
                    class_start_date: group.class_start_date,
                    class_end_date: group.class_end_date,
                });
            }
        });

        return Array.from(byClassId.values())
            .filter((item) => matchesClassDateFilter(item.class_start_date, item.class_end_date))
            .sort((a, b) => a.class_name.localeCompare(b.class_name));
    }, [classDateFilter, enrollments, groups]);

    const slotOptions = useMemo(() => {
        const slots = Array.from(new Set(enrollments.map((row) => row.slot).filter((slot) => slot !== null && slot !== undefined)));
        return slots.sort((a, b) => Number(a) - Number(b));
    }, [enrollments]);

    const filteredEnrollments = useMemo(() => {
        return enrollments.filter((row) => {
            if (!matchesClassDateFilter(row.class_start_date, row.class_end_date)) return false;
            if (classFilter !== 'all' && row.class_id !== classFilter) return false;
            if (slotFilter !== 'all' && String(row.slot ?? '') !== slotFilter) return false;
            if (assignmentFilter === 'unassigned' && row.group_id) return false;
            if (assignmentFilter === 'assigned' && !row.group_id) return false;
            return true;
        });
    }, [assignmentFilter, classDateFilter, classFilter, enrollments, slotFilter]);

    useEffect(() => {
        setSwimmerPage(1);
    }, [assignmentFilter, classDateFilter, classFilter, slotFilter]);

    useEffect(() => {
        setGroupPage(1);
    }, [classDateFilter, classFilter]);

    useEffect(() => {
        if (classFilter === 'all') return;
        if (!classOptions.some((option) => option.class_id === classFilter)) {
            setClassFilter('all');
        }
    }, [classFilter, classOptions]);

    const sortedEnrollments = useMemo(() => {
        const rows = [...filteredEnrollments];
        rows.sort((a, b) => {
            if (assignmentFilter === 'all') {
                const aAssigned = Boolean(a.group_id);
                const bAssigned = Boolean(b.group_id);
                if (aAssigned !== bAssigned) {
                    return aAssigned ? 1 : -1;
                }
            }

            const classCompare = a.class_name.localeCompare(b.class_name);
            if (classCompare !== 0) return classCompare;

            const slotA = slotSortValue(a.slot);
            const slotB = slotSortValue(b.slot);
            if (slotA !== slotB) return slotA - slotB;

            const ageA = getAge(a.date_of_birth);
            const ageB = getAge(b.date_of_birth);
            if (ageA === null && ageB === null) return 0;
            if (ageA === null) return 1;
            if (ageB === null) return -1;
            if (ageA !== ageB) return ageA - ageB;
            const nameA = formatName(a.member_first_name, a.member_last_name).toLowerCase();
            const nameB = formatName(b.member_first_name, b.member_last_name).toLowerCase();
            return nameA.localeCompare(nameB);
        });
        return rows;
    }, [filteredEnrollments, assignmentFilter]);

    const buildGroupOptions = (row: EnrollmentRow) => {
        // Filter groups by both class_id and slot
        const allGroups = groupsByClassId.get(row.class_id) || [];
        // Only include groups where all swimmers in the group have the same slot as the row
        if (row.slot == null) {
            // For swimmers without a slot, show all groups for the class
            return allGroups;
        }
        return allGroups.filter((group) => {
            const swimmers = swimmersByGroupId.get(group.group_id) || [];
            // If group has no swimmers, allow it to show for assignment
            if (swimmers.length === 0) return true;
            // All swimmers in group must have the same slot as the row
            return swimmers.every((swimmer) => swimmer.slot === row.slot);
        });
    };

    const patchEnrollmentGroup = async (row: EnrollmentRow, nextGroupId: string | null) => {
        const response = await authFetch('/api/admin/instructor-member-assignments', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                member_id: row.member_id,
                class_id: row.class_id,
                group_id: nextGroupId,
            }),
        });

        if (!response.ok) {
            const errorPayload = await response.json().catch(() => ({}));
            throw new Error(errorPayload?.error || 'Failed to update assignment');
        }
    };

    const updateEnrollmentGroup = async (row: EnrollmentRow, nextGroupId: string | null) => {
        const key = enrollmentKey(row);
        setPendingEnrollmentKeys((prev) => new Set(prev).add(key));

        const previous = enrollments;
        const groupName = nextGroupId ? groupById.get(nextGroupId)?.group_name ?? null : null;

        setEnrollments((prev) =>
            prev.map((item) =>
                item.member_id === row.member_id && item.class_id === row.class_id
                    ? { ...item, group_id: nextGroupId, group_name: groupName }
                    : item,
            ),
        );

        try {
            await patchEnrollmentGroup(row, nextGroupId);

            showToast(nextGroupId ? 'Group assignment updated' : 'Group assignment cleared');
        } catch (err) {
            console.error('Error updating assignment:', err);
            setEnrollments(previous);
            setErrorMessage(err instanceof Error ? err.message : 'Failed to update assignment');
        } finally {
            setPendingEnrollmentKeys((prev) => {
                const next = new Set(prev);
                next.delete(key);
                return next;
            });
        }
    };

    const selectedRows = useMemo(() => {
        return sortedEnrollments.filter((row) => selectedEnrollmentKeys.has(enrollmentKey(row)));
    }, [sortedEnrollments, selectedEnrollmentKeys]);

    const uniqueSelectedClassIds = useMemo(
        () => Array.from(new Set(selectedRows.map((row) => row.class_id))),
        [selectedRows],
    );

    const uniqueSelectedSlotValues = useMemo(
        () => Array.from(new Set(selectedRows.map((row) => String(row.slot ?? '__none__')))),
        [selectedRows],
    );

    const hasSingleSelectedClass = uniqueSelectedClassIds.length === 1;
    const hasSingleSelectedSlot = uniqueSelectedSlotValues.length === 1;
    const canRunGroupingActions =
        selectedRows.length > 0 && hasSingleSelectedClass && hasSingleSelectedSlot;

    const bulkAssignableGroups = useMemo(() => {
        if (!hasSingleSelectedClass) return [];
        return groupsByClassId.get(uniqueSelectedClassIds[0]) || [];
    }, [hasSingleSelectedClass, uniqueSelectedClassIds, groupsByClassId]);

    const bulkGroupName = bulkGroupId ? groupById.get(bulkGroupId)?.group_name || '' : '';

    const toggleRowSelection = (row: EnrollmentRow) => {
        const key = enrollmentKey(row);
        setSelectedEnrollmentKeys((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const shouldIgnoreRowSelection = (target: EventTarget | null) => {
        if (!(target instanceof HTMLElement)) return false;
        return Boolean(
            target.closest('button, input, select, textarea, a, [role="button"], [data-row-toggle-ignore="true"]'),
        );
    };

    const togglePageSelection = () => {
        const pageKeys = swimmerPageRows.map((row) => enrollmentKey(row));
        const allSelected = pageKeys.length > 0 && pageKeys.every((key) => selectedEnrollmentKeys.has(key));

        setSelectedEnrollmentKeys((prev) => {
            const next = new Set(prev);
            if (allSelected) {
                pageKeys.forEach((key) => next.delete(key));
            } else {
                pageKeys.forEach((key) => next.add(key));
            }
            return next;
        });
    };

    const runBulkUpdate = async (nextGroupId: string | null) => {
        if (selectedRows.length === 0) return;

        const keysToUpdate = new Set(selectedRows.map((row) => enrollmentKey(row)));
        const previous = enrollments;
        const nextGroupName = nextGroupId ? groupById.get(nextGroupId)?.group_name || null : null;

        setBulkPending(true);
        setPendingEnrollmentKeys((prev) => {
            const next = new Set(prev);
            keysToUpdate.forEach((key) => next.add(key));
            return next;
        });

        setEnrollments((prev) =>
            prev.map((item) => {
                const key = enrollmentKey(item);
                if (!keysToUpdate.has(key)) return item;
                return { ...item, group_id: nextGroupId, group_name: nextGroupName };
            }),
        );

        try {
            await Promise.all(selectedRows.map((row) => patchEnrollmentGroup(row, nextGroupId)));
            showToast(
                nextGroupId
                    ? `${selectedRows.length} swimmers assigned to ${nextGroupName}`
                    : `${selectedRows.length} swimmers cleared`,
            );
            setSelectedEnrollmentKeys(new Set());
            setBulkGroupId('');
        } catch (err) {
            console.error('Error applying bulk update:', err);
            setEnrollments(previous);
            setErrorMessage(err instanceof Error ? err.message : 'Failed to apply bulk update');
        } finally {
            setPendingEnrollmentKeys((prev) => {
                const next = new Set(prev);
                keysToUpdate.forEach((key) => next.delete(key));
                return next;
            });
            setBulkPending(false);
        }
    };

    const handleBulkAssign = async () => {
        if (!bulkGroupId || !canRunGroupingActions) return;
        await runBulkUpdate(bulkGroupId);
    };

    const handleBulkClear = async () => {
        await runBulkUpdate(null);
    };

    const handleCreateGroupFromSelected = async () => {
        if (!canRunGroupingActions) return;

        const classId = uniqueSelectedClassIds[0];
        const memberIds = Array.from(new Set(selectedRows.map((row) => row.member_id)));

        setCreateGroupPending(true);
        try {
            const response = await authFetch('/api/admin/instructor-member-assignments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    class_id: classId,
                    member_ids: memberIds,
                }),
            });

            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload?.error || 'Failed to create group from selected swimmers');
            }

            const createdGroup = payload?.group as {
                group_id: string;
                class_id: string;
                group_name: string;
                class_name: string;
            } | undefined;

            if (createdGroup?.group_id) {
                setGroups((prev) => {
                    if (prev.some((group) => group.group_id === createdGroup.group_id)) {
                        return prev;
                    }
                    return [...prev, {
                        group_id: createdGroup.group_id,
                        class_id: createdGroup.class_id,
                        class_name: createdGroup.class_name,
                        group_name: createdGroup.group_name,
                    }];
                });

                setEnrollments((prev) =>
                    prev.map((row) => {
                        const isSelectedMember = memberIds.includes(row.member_id);
                        if (!isSelectedMember || row.class_id !== classId) return row;
                        return {
                            ...row,
                            group_id: createdGroup.group_id,
                            group_name: createdGroup.group_name,
                        };
                    }),
                );

                setBulkGroupId(createdGroup.group_id);
            }

            showToast(
                `Created ${createdGroup?.group_name ?? 'new group'} with ${memberIds.length} swimmer${memberIds.length > 1 ? 's' : ''}`,
            );
            setSelectedEnrollmentKeys(new Set());
        } catch (err) {
            console.error('Error creating group from selected swimmers:', err);
            setErrorMessage(err instanceof Error ? err.message : 'Failed to create group from selected swimmers');
        } finally {
            setCreateGroupPending(false);
        }
    };

    const requestDeleteGroup = (group: Group) => {
        const swimmerCount = (swimmersByGroupId.get(group.group_id) || []).length;
        setDeleteGroupPrompt({ group, swimmerCount });
    };

    const confirmDeleteGroup = async () => {
        if (!deleteGroupPrompt) return;

        const { group } = deleteGroupPrompt;
        setDeleteGroupPrompt(null);

        setPendingGroupDeleteIds((prev) => {
            const next = new Set(prev);
            next.add(group.group_id);
            return next;
        });

        const previousGroups = groups;
        const previousAssignments = assignments;
        const previousEnrollments = enrollments;

        setGroups((prev) => prev.filter((item) => item.group_id !== group.group_id));
        setAssignments((prev) => prev.filter((item) => item.group_id !== group.group_id));
        setEnrollments((prev) =>
            prev.map((row) =>
                row.group_id === group.group_id
                    ? { ...row, group_id: null, group_name: null }
                    : row,
            ),
        );
        setBulkGroupId((prev) => (prev === group.group_id ? '' : prev));

        try {
            const response = await authFetch('/api/admin/instructor-member-assignments', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    group_id: group.group_id,
                    delete_group: true,
                }),
            });

            if (!response.ok) {
                const errorPayload = await response.json().catch(() => ({}));
                throw new Error(errorPayload?.error || 'Failed to delete group');
            }

            showToast(`Deleted ${group.group_name}`);
        } catch (err) {
            console.error('Error deleting group:', err);
            setGroups(previousGroups);
            setAssignments(previousAssignments);
            setEnrollments(previousEnrollments);
            setErrorMessage(err instanceof Error ? err.message : 'Failed to delete group');
        } finally {
            setPendingGroupDeleteIds((prev) => {
                const next = new Set(prev);
                next.delete(group.group_id);
                return next;
            });
        }
    };

    const filteredGroupsForInstructors = useMemo(() => {
        return groups.filter((group) => {
            if (!matchesClassDateFilter(group.class_start_date, group.class_end_date)) return false;
            if (classFilter !== 'all' && group.class_id !== classFilter) return false;
            return true;
        });
    }, [groups, classDateFilter, classFilter]);

    const totalSwimmerPages = Math.max(1, Math.ceil(sortedEnrollments.length / SWIMMER_PAGE_SIZE));
    const swimmerPageRows = useMemo(() => {
        const start = (swimmerPage - 1) * SWIMMER_PAGE_SIZE;
        return sortedEnrollments.slice(start, start + SWIMMER_PAGE_SIZE);
    }, [sortedEnrollments, swimmerPage, SWIMMER_PAGE_SIZE]);

    const selectedRowsOnPage = useMemo(() => {
        return swimmerPageRows.filter((row) => selectedEnrollmentKeys.has(enrollmentKey(row)));
    }, [swimmerPageRows, selectedEnrollmentKeys]);

    const totalGroupPages = Math.max(1, Math.ceil(filteredGroupsForInstructors.length / GROUP_PAGE_SIZE));
    const groupPageRows = useMemo(() => {
        const start = (groupPage - 1) * GROUP_PAGE_SIZE;
        return filteredGroupsForInstructors.slice(start, start + GROUP_PAGE_SIZE);
    }, [filteredGroupsForInstructors, groupPage, GROUP_PAGE_SIZE]);

    useEffect(() => {
        if (swimmerPage > totalSwimmerPages) {
            setSwimmerPage(totalSwimmerPages);
        }
    }, [swimmerPage, totalSwimmerPages]);

    useEffect(() => {
        if (groupPage > totalGroupPages) {
            setGroupPage(totalGroupPages);
        }
    }, [groupPage, totalGroupPages]);

    const updateGroupInstructor = async (groupId: string, instructorId: string, action: 'assign' | 'remove') => {
        const key = `${groupId}:${instructorId}:${action}`;
        setPendingInstructorKeys((prev) => new Set(prev).add(key));

        const previous = assignments;
        setAssignments((prev) => {
            if (action === 'assign') {
                if (prev.some((item) => item.group_id === groupId && item.instructor_person_id === instructorId)) {
                    return prev;
                }
                return [...prev, { group_id: groupId, instructor_person_id: instructorId }];
            }
            return prev.filter((item) => !(item.group_id === groupId && item.instructor_person_id === instructorId));
        });

        try {
            const response = await authFetch('/api/admin/instructor-member-assignments', {
                method: action === 'assign' ? 'PUT' : 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    group_ids: [groupId],
                    instructor_person_id: instructorId,
                }),
            });

            if (!response.ok) {
                const errorPayload = await response.json().catch(() => ({}));
                throw new Error(errorPayload?.error || 'Failed to update instructor assignment');
            }

            showToast(action === 'assign' ? 'Instructor assigned to group' : 'Instructor removed from group');
        } catch (err) {
            console.error('Error updating instructor assignment:', err);
            setAssignments(previous);
            setErrorMessage(err instanceof Error ? err.message : 'Failed to update instructor assignment');
        } finally {
            setPendingInstructorKeys((prev) => {
                const next = new Set(prev);
                next.delete(key);
                return next;
            });
        }
    };

    const unassignSwimmer = async (memberId: string, classId: string) => {
        const key = `${memberId}:${classId}:unassign`;
        setPendingEnrollmentKeys((prev) => new Set(prev).add(key));

        const previous = enrollments;
        setEnrollments((prev) =>
            prev.map((item) =>
                item.member_id === memberId && item.class_id === classId
                    ? { ...item, group_id: null, group_name: null }
                    : item,
            ),
        );

        try {
            const response = await authFetch('/api/admin/instructor-member-assignments', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    member_id: memberId,
                    class_id: classId,
                }),
            });

            if (!response.ok) {
                const errorPayload = await response.json().catch(() => ({}));
                throw new Error(errorPayload?.error || 'Failed to unassign swimmer');
            }

            showToast('Swimmer unassigned from group');
        } catch (err) {
            console.error('Error unassigning swimmer:', err);
            setEnrollments(previous);
            setErrorMessage(err instanceof Error ? err.message : 'Failed to unassign swimmer');
        } finally {
            setPendingEnrollmentKeys((prev) => {
                const next = new Set(prev);
                next.delete(key);
                return next;
            });
        }
    };

    return (
        <div className="space-y-4 relative">
            {deleteGroupPrompt && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
                        <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86l-8.1 14A2 2 0 003.92 21h16.16a2 2 0 001.73-3.14l-8.1-14a2 2 0 00-3.46 0z" />
                                </svg>
                            </div>
                            <div className="min-w-0 flex-1">
                                <h3 className="text-base font-semibold text-slate-900">Delete group?</h3>
                                <p className="mt-1 text-sm text-slate-600">
                                    This will delete <span className="font-semibold text-slate-900">{deleteGroupPrompt.group.group_name}</span> and unassign {deleteGroupPrompt.swimmerCount} swimmer{deleteGroupPrompt.swimmerCount === 1 ? '' : 's'}.
                                </p>
                            </div>
                        </div>

                        <div className="mt-5 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setDeleteGroupPrompt(null)}
                                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={confirmDeleteGroup}
                                className="rounded-md bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-700"
                            >
                                Delete group
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {toastMessage && (
                <div className="fixed top-4 right-4 z-50 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800 shadow-lg">
                    {toastMessage}
                </div>
            )}

            {errorMessage && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 sm:p-4">
                    <p className="text-xs text-red-800 sm:text-sm">{errorMessage}</p>
                </div>
            )}

            <div className="rounded-2xl border border-sky-200 bg-gradient-to-r from-sky-50 to-cyan-50 p-4 sm:p-5">
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-sky-800">Group Assignment</p>
                <p className="text-sm font-semibold text-slate-900 sm:text-base">
                    Manage group instructors and swimmer placements at scale.
                </p>
                <p className="mt-2 text-xs text-slate-600">Swimmers are sorted by slot, then age.</p>
                <div className="mt-3 rounded-lg border border-sky-100 bg-white/80 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-800">Quick start</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-slate-700">
                        <li>Filter classes and slot first to narrow your roster.</li>
                        <li>Select swimmers, then choose a group to bulk assign.</li>
                        <li>Use Group Instructors to add or remove instructors per group.</li>
                    </ul>
                </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                <div className="flex flex-wrap gap-2">
                    <StyledSelect
                        value={classDateFilter}
                        onChange={(value) => setClassDateFilter(value as ClassDateFilter)}
                        options={[
                            { value: 'active', label: 'Active classes' },
                            { value: 'past', label: 'Past classes' },
                        ]}
                        className="min-w-[150px]"
                        ariaLabel="Filter by class date status"
                    />
                    <StyledSelect
                        value={classFilter}
                        onChange={setClassFilter}
                        options={[
                            { value: 'all', label: 'All classes' },
                            ...classOptions.map((option) => ({ value: option.class_id, label: option.class_name })),
                        ]}
                        className="min-w-[150px]"
                        ariaLabel="Filter by class"
                    />
                    <StyledSelect
                        value={slotFilter}
                        onChange={setSlotFilter}
                        options={[
                            { value: 'all', label: 'All slots' },
                            ...slotOptions.map((slot) => ({ value: String(slot), label: `Slot ${slot}` })),
                        ]}
                        className="min-w-[130px]"
                        ariaLabel="Filter by slot"
                    />
                    <StyledSelect
                        value={assignmentFilter}
                        onChange={(value) => setAssignmentFilter(value as 'all' | 'unassigned' | 'assigned')}
                        options={[
                            { value: 'all', label: 'All swimmers' },
                            { value: 'unassigned', label: 'Unassigned only' },
                            { value: 'assigned', label: 'Assigned only' },
                        ]}
                        className="min-w-[170px]"
                        ariaLabel="Filter by assignment status"
                    />
                </div>

                {loading && (
                    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
                        <div className="mb-3 flex items-center gap-2">
                            <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-blue-600"></div>
                            <p className="text-xs font-medium text-slate-700">Loading assignments...</p>
                        </div>
                        <div className="space-y-2 animate-pulse">
                            <div className="h-10 rounded-lg bg-slate-100"></div>
                            <div className="h-10 rounded-lg bg-slate-100"></div>
                            <div className="h-10 rounded-lg bg-slate-100"></div>
                        </div>
                    </div>
                )}

                {!loading && (
                    <div className="mt-5 grid gap-4">
                        <div className="order-2 rounded-xl border border-slate-200 bg-slate-50/40 p-3 sm:p-4">
                            <div className="mb-3 flex items-center justify-between">
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Group Instructors</p>
                                    <p className="text-sm font-semibold text-slate-900">Assign instructors to groups</p>
                                </div>
                                <p className="text-xs text-slate-500">Page {groupPage} / {totalGroupPages}</p>
                            </div>

                            <div className="relative overflow-visible rounded-lg border border-slate-200 bg-white">
                                <div className="overflow-x-auto">
                                    <table className="min-w-full text-xs sm:text-sm">
                                        <thead className="bg-slate-50 text-slate-600">
                                            <tr>
                                                <th className="px-3 py-2 text-left font-semibold">Class</th>
                                                <th className="px-3 py-2 text-left font-semibold">Swimmers (Age)</th>
                                                <th className="px-3 py-2 text-left font-semibold">Instructors</th>
                                                <th className="px-3 py-2 text-left font-semibold">Add / Delete</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {groupPageRows.map((group) => {
                                                const groupInstructors = instructorInfoByGroupId.get(group.group_id) || [];
                                                const swimmersInGroup = swimmersByGroupId.get(group.group_id) || [];
                                                const classTag = getClassTagColors(group.class_name);
                                                const slotSummary = Array.from(
                                                    new Set(
                                                        swimmersInGroup
                                                            .map((swimmer) => swimmer.slot)
                                                            .filter((slot) => slot !== null),
                                                    ),
                                                ).sort((a, b) => Number(a) - Number(b));
                                                const slotLabel =
                                                    slotSummary.length === 0
                                                        ? 'Slot n/a'
                                                        : slotSummary.length === 1
                                                            ? `Slot ${slotSummary[0]}`
                                                            : 'Mixed slots';
                                                const deletePending = pendingGroupDeleteIds.has(group.group_id);
                                                return (
                                                    <tr key={group.group_id} className="border-t border-slate-100 align-top">
                                                        <td className="px-3 py-2">
                                                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${classTag.bg} ${classTag.text}`}>
                                                                {group.class_name}
                                                            </span>
                                                            <p className="mt-1 text-xs font-semibold text-slate-800">{group.group_name}</p>
                                                            <p className="text-[11px] text-slate-500">{slotLabel}</p>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <div className="flex max-w-[320px] flex-wrap gap-1.5">
                                                                {swimmersInGroup.length === 0 && (
                                                                    <span className="text-[11px] text-slate-500">No swimmers assigned</span>
                                                                )}
                                                                {swimmersInGroup.map((swimmer) => (
                                                                    <span
                                                                        key={swimmer.memberId}
                                                                        className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] text-sky-800"
                                                                    >
                                                                        {swimmer.name}
                                                                        {swimmer.age !== null ? ` (${swimmer.age})` : ''}
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => unassignSwimmer(swimmer.memberId, group.class_id)}
                                                                            disabled={pendingEnrollmentKeys.has(`${swimmer.memberId}:${group.class_id}:unassign`)}
                                                                            className="text-sky-600 hover:text-sky-800"
                                                                        >
                                                                            ×
                                                                        </button>
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {groupInstructors.length === 0 && (
                                                                    <span className="text-[11px] text-slate-500">No instructors</span>
                                                                )}
                                                                {groupInstructors.map((instructor) => (
                                                                    <span key={instructor.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                                                                        {instructor.name}
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => updateGroupInstructor(group.group_id, instructor.id, 'remove')}
                                                                            disabled={pendingInstructorKeys.has(`${group.group_id}:${instructor.id}:remove`)}
                                                                            className="text-slate-500 hover:text-rose-600"
                                                                        >
                                                                            ×
                                                                        </button>
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <div className="flex items-center gap-2">
                                                                <StyledSelect
                                                                    value=""
                                                                    onChange={(instructorId) => {
                                                                        if (instructorId) {
                                                                            updateGroupInstructor(group.group_id, instructorId, 'assign');
                                                                        }
                                                                    }}
                                                                    options={[
                                                                        { value: '', label: 'Add instructor…', disabled: true },
                                                                        ...sortedInstructors
                                                                            .filter((instructor) => !groupInstructors.some((item) => item.id === instructor.person_id))
                                                                            .map((instructor) => ({
                                                                                value: instructor.person_id,
                                                                                label: formatName(instructor.first_name, instructor.last_name),
                                                                            })),
                                                                    ]}
                                                                    placeholder="Add instructor…"
                                                                    className="w-44"
                                                                    sizeMode="compact"
                                                                    disabled={deletePending}
                                                                    ariaLabel={`Add instructor to ${group.group_name}`}
                                                                />
                                                                <button
                                                                    type="button"
                                                                    onClick={() => requestDeleteGroup(group)}
                                                                    disabled={deletePending}
                                                                    title="Delete group"
                                                                    className="flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                                                                >
                                                                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3m-7 0h8" />
                                                                    </svg>
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                            {groupPageRows.length === 0 && (
                                                <tr>
                                                    <td colSpan={4} className="px-3 py-4 text-center text-xs text-slate-500">No groups found.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="mt-3 flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setGroupPage((prev) => Math.max(1, prev - 1))}
                                    disabled={groupPage <= 1}
                                    className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Prev
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setGroupPage((prev) => Math.min(totalGroupPages, prev + 1))}
                                    disabled={groupPage >= totalGroupPages}
                                    className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Next
                                </button>
                            </div>
                        </div>

                        <div className="order-1 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
                            <div className="mb-3 flex items-center justify-between">
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Swimmer Assignments</p>
                                    <p className="text-sm font-semibold text-slate-900">{sortedEnrollments.length} swimmers</p>
                                </div>
                                <p className="text-xs text-slate-500">Page {swimmerPage} / {totalSwimmerPages}</p>
                            </div>

                            <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs font-medium text-slate-700">
                                        Selected: {selectedRows.length}
                                    </span>
                                    <StyledSelect
                                        value={bulkGroupId}
                                        onChange={setBulkGroupId}
                                        disabled={bulkPending || !canRunGroupingActions}
                                        options={[
                                            { value: '', label: 'Select group' },
                                            ...bulkAssignableGroups.map((group) => ({ value: group.group_id, label: group.group_name })),
                                        ]}
                                        className="w-52"
                                        sizeMode="compact"
                                        ariaLabel="Bulk assign group"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleCreateGroupFromSelected}
                                        disabled={createGroupPending || !canRunGroupingActions}
                                        className="rounded-md border border-sky-200 px-2 py-1 text-xs font-semibold text-sky-700 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Create group from selected
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleBulkAssign}
                                        disabled={bulkPending || createGroupPending || !bulkGroupId || !canRunGroupingActions}
                                        className="rounded-md bg-sky-600 px-2 py-1 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                                    >
                                        Assign selected
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleBulkClear}
                                        disabled={bulkPending || createGroupPending || selectedRows.length === 0}
                                        className="rounded-md border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Clear selected
                                    </button>
                                </div>
                                <div className="mt-1 min-h-[1.25rem]">
                                    {errorMessage ? (
                                        <p className="text-[11px] text-rose-700">{errorMessage}</p>
                                    ) : selectedRows.length > 0 && !canRunGroupingActions ? (
                                        <p className="text-[11px] text-amber-700">
                                            Select swimmers from one class and one slot to create a group or bulk-assign.
                                        </p>
                                    ) : (
                                        <p className="text-[11px] text-slate-500">
                                            Choose a group to assign selected swimmers.
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className="relative overflow-visible rounded-lg border border-slate-200">
                                <div className="overflow-x-auto">
                                    <table className="min-w-full text-xs sm:text-sm">
                                        <thead className="bg-slate-50 text-slate-600">
                                            <tr>
                                                <th className="px-3 py-2 text-left font-semibold">
                                                    <input
                                                        type="checkbox"
                                                        checked={
                                                            swimmerPageRows.length > 0 &&
                                                            selectedRowsOnPage.length === swimmerPageRows.length
                                                        }
                                                        onChange={togglePageSelection}
                                                        className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                                                        aria-label="Select all swimmers on page"
                                                    />
                                                </th>
                                                <th className="px-3 py-2 text-left font-semibold">Swimmer</th>
                                                <th className="px-3 py-2 text-left font-semibold">Age</th>
                                                <th className="px-3 py-2 text-left font-semibold">Slot</th>
                                                <th className="px-3 py-2 text-left font-semibold">Class</th>
                                                <th className="px-3 py-2 text-left font-semibold">Group</th>
                                                <th className="px-3 py-2 text-left font-semibold">Instructors</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {swimmerPageRows.flatMap((row, index) => {
                                                const key = enrollmentKey(row);
                                                const isAssigned = Boolean(row.group_id);
                                                const previousRow = index > 0 ? swimmerPageRows[index - 1] : null;
                                                const previousAssigned = previousRow ? Boolean(previousRow.group_id) : null;
                                                const shouldShowSectionRow =
                                                    assignmentFilter === 'all' && (index === 0 || previousAssigned !== isAssigned);
                                                const age = getAge(row.date_of_birth);
                                                const groupOptions = buildGroupOptions(row);
                                                const instructorNames = row.group_id
                                                    ? instructorNamesByGroupId.get(row.group_id) || []
                                                    : [];
                                                const tag = getClassTagColors(row.class_name);
                                                const isPending = pendingEnrollmentKeys.has(key);
                                                const isSelected = selectedEnrollmentKeys.has(key);

                                                const rows: JSX.Element[] = [];

                                                if (shouldShowSectionRow) {
                                                    rows.push(
                                                        <tr key={`section-${key}`} className="border-t border-slate-200 bg-slate-50/70">
                                                            <td colSpan={7} className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                                                                {isAssigned ? 'Assigned Swimmers' : 'Unassigned Swimmers'}
                                                            </td>
                                                        </tr>,
                                                    );
                                                }

                                                rows.push(
                                                    <tr
                                                        key={key}
                                                        className={`border-t border-slate-100 align-top cursor-pointer transition-colors ${isSelected
                                                            ? 'bg-sky-50 ring-1 ring-inset ring-sky-200'
                                                            : isAssigned
                                                                ? 'bg-slate-50/30 hover:bg-slate-50'
                                                                : 'hover:bg-sky-50/40'}`}
                                                        onClick={(event) => {
                                                            if (shouldIgnoreRowSelection(event.target)) return;
                                                            toggleRowSelection(row);
                                                        }}
                                                    >
                                                        <td className="px-3 py-2">
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                onChange={() => toggleRowSelection(row)}
                                                                className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                                                            />
                                                        </td>
                                                        <td className="px-3 py-2 font-medium text-slate-900">
                                                            {formatName(row.member_first_name, row.member_last_name)}
                                                        </td>
                                                        <td className="px-3 py-2 text-slate-600">{age ?? '—'}</td>
                                                        <td className="px-3 py-2 text-slate-600">{formatSlotLabel(row.slot)}</td>
                                                        <td className="px-3 py-2">
                                                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${tag.bg} ${tag.text}`}>
                                                                {row.class_name}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <StyledSelect
                                                                value={row.group_id ?? ''}
                                                                onChange={(selectedValue) => updateEnrollmentGroup(row, selectedValue || null)}
                                                                disabled={isPending}
                                                                options={[
                                                                    { value: '', label: 'Unassigned' },
                                                                    ...groupOptions.map((group) => ({ value: group.group_id, label: group.group_name })),
                                                                ]}
                                                                className="w-56"
                                                                sizeMode="compact"
                                                                ariaLabel={`Assign group for ${formatName(row.member_first_name, row.member_last_name)}`}
                                                            />
                                                        </td>
                                                        <td className="px-3 py-2 text-slate-600">
                                                            {instructorNames.length > 0 ? instructorNames.join(', ') : 'No instructor'}
                                                        </td>
                                                    </tr>,
                                                );

                                                return rows;
                                            })}
                                            {swimmerPageRows.length === 0 && (
                                                <tr>
                                                    <td colSpan={7} className="px-3 py-4 text-center text-xs text-slate-500">
                                                        No swimmers match the current filters.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="mt-3 flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setSwimmerPage((prev) => Math.max(1, prev - 1))}
                                    disabled={swimmerPage <= 1}
                                    className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Prev
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setSwimmerPage((prev) => Math.min(totalSwimmerPages, prev + 1))}
                                    disabled={swimmerPage >= totalSwimmerPages}
                                    className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
