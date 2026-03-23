/**
 * ClassManager Component
 * Purpose: Manage classes with support for name, schedule, and length_minutes
 * Features: CRUD operations with inline editing for all class fields
 */

'use client';

import { useState, useEffect } from 'react';

interface Class {
    class_id: string;
    name: string;
    schedule?: string | null;
    length_minutes?: number | null;
    created_at: string;
}

interface ClassManagerProps {
    userEmail: string;
    onRefresh: () => void;
}

export default function ClassManager({ userEmail, onRefresh }: ClassManagerProps) {
    const [loading, setLoading] = useState(false);
    const [classes, setClasses] = useState<Class[]>([]);

    // Editing state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [editingSchedule, setEditingSchedule] = useState('');
    const [editingLengthMinutes, setEditingLengthMinutes] = useState('');

    const [toasts, setToasts] = useState<Array<{ id: number; message: string; type: 'success' | 'error' }>>([]);
    const [deleteDialog, setDeleteDialog] = useState<{ show: boolean; classId: string | null; className: string }>({ show: false, classId: null, className: '' });

    // Fetch classes
    const fetchClasses = async () => {
        setLoading(true);
        try {
            const response = await fetch(`/api/admin/classes?email=${encodeURIComponent(userEmail)}`);
            const data = await response.json();
            if (response.ok) {
                setClasses(data.classes || []);
            }
        } catch (error) {
            console.error('Failed to fetch classes:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (userEmail) {
            fetchClasses();
        }
    }, [userEmail]);

    const showToast = (message: string, type: 'success' | 'error' = 'error') => {
        const id = Date.now() + Math.floor(Math.random() * 1000);
        setToasts((prev) => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts((prev) => prev.filter((toast) => toast.id !== id));
        }, 3500);
    };



    // Start editing a class
    const startEdit = (classItem: Class) => {
        setEditingId(classItem.class_id);
        setEditingName(classItem.name);
        setEditingSchedule(classItem.schedule || '');
        setEditingLengthMinutes(classItem.length_minutes?.toString() || '');
    };

    // Cancel editing
    const cancelEdit = () => {
        setEditingId(null);
        setEditingName('');
        setEditingSchedule('');
        setEditingLengthMinutes('');
    };

    // Save edited class
    const saveEdit = async (class_id: string) => {
        if (!editingName.trim()) {
            showToast('Class name is required', 'error');
            return;
        }

        if (editingLengthMinutes && parseInt(editingLengthMinutes) <= 0) {
            showToast('Length must be a positive number', 'error');
            return;
        }

        try {
            const response = await fetch('/api/admin/classes', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    admin_email: userEmail,
                    class_id,
                    name: editingName.trim(),
                    schedule: editingSchedule.trim() || null,
                    length_minutes: editingLengthMinutes ? parseInt(editingLengthMinutes) : null,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to update class');
            }

            cancelEdit();
            showToast('Class updated successfully', 'success');
            await fetchClasses();
            onRefresh();
        } catch (error) {
            console.error('Failed to update class:', error);
            showToast(error instanceof Error ? error.message : 'Failed to update class', 'error');
        }
    };

    // Confirm delete
    const confirmDelete = (class_id: string, className: string) => {
        setDeleteDialog({ show: true, classId: class_id, className });
    };

    // Delete class
    const handleDelete = async () => {
        const class_id = deleteDialog.classId;
        if (!class_id) return;

        setDeleteDialog({ show: false, classId: null, className: '' });

        try {
            const response = await fetch(
                `/api/admin/classes?email=${encodeURIComponent(userEmail)}&class_id=${class_id}`,
                { method: 'DELETE' }
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to delete class');
            }

            showToast('Class deleted successfully', 'success');
            await fetchClasses();
            onRefresh();
        } catch (error) {
            console.error('Failed to delete class:', error);
            showToast(error instanceof Error ? error.message : 'Failed to delete class', 'error');
        }
    };

    return (
        <div className="bg-white rounded-lg sm:rounded-xl border border-gray-200 shadow-sm p-4 sm:p-6">
            <p className="text-xs sm:text-sm font-semibold text-gray-900 mb-3 sm:mb-4">Manage Classes</p>

            {/* Classes List */}
            {loading ? (
                <div className="flex items-center justify-center py-6 sm:py-8">
                    <div className="animate-spin rounded-full h-5 w-5 sm:h-6 sm:w-6 border-b-2 border-blue-600"></div>
                </div>
            ) : classes.length === 0 ? (
                <p className="text-xs sm:text-sm text-gray-500 text-center py-3 sm:py-4">
                    No classes yet. Classes are managed by administrators.
                </p>
            ) : (
                <div className="space-y-2">
                    {classes.map((classItem) => (
                        <div
                            key={classItem.class_id}
                            className="border border-gray-200 rounded-lg p-3 hover:border-gray-300 transition"
                        >
                            {editingId === classItem.class_id ? (
                                // Edit Mode
                                <div className="space-y-2">
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                        <div>
                                            <label className="block text-[10px] sm:text-xs font-medium text-gray-700 mb-1">
                                                Name*
                                            </label>
                                            <input
                                                type="text"
                                                value={editingName}
                                                onChange={(e) => setEditingName(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') saveEdit(classItem.class_id);
                                                    if (e.key === 'Escape') cancelEdit();
                                                }}
                                                autoFocus
                                                className="w-full px-2 py-1 text-xs sm:text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] sm:text-xs font-medium text-gray-700 mb-1">
                                                Schedule
                                            </label>
                                            <input
                                                type="text"
                                                value={editingSchedule}
                                                onChange={(e) => setEditingSchedule(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') saveEdit(classItem.class_id);
                                                    if (e.key === 'Escape') cancelEdit();
                                                }}
                                                placeholder="e.g., Mon/Wed 4pm"
                                                className="w-full px-2 py-1 text-xs sm:text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] sm:text-xs font-medium text-gray-700 mb-1">
                                                Length (min)
                                            </label>
                                            <input
                                                type="number"
                                                value={editingLengthMinutes}
                                                onChange={(e) => setEditingLengthMinutes(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') saveEdit(classItem.class_id);
                                                    if (e.key === 'Escape') cancelEdit();
                                                }}
                                                min="1"
                                                placeholder="e.g., 45"
                                                className="w-full px-2 py-1 text-xs sm:text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex gap-2 justify-end">
                                        <button
                                            onClick={cancelEdit}
                                            className="px-3 py-1.5 text-xs sm:text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={() => saveEdit(classItem.class_id)}
                                            className="px-3 py-1.5 text-xs sm:text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                                        >
                                            Save
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                // View Mode
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm sm:text-base font-medium text-gray-900 truncate">
                                            {classItem.name}
                                        </p>
                                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                                            {classItem.schedule && (
                                                <p className="text-xs sm:text-sm text-gray-600">
                                                    <span className="font-medium">Schedule:</span> {classItem.schedule}
                                                </p>
                                            )}
                                            {classItem.length_minutes && (
                                                <p className="text-xs sm:text-sm text-gray-600">
                                                    <span className="font-medium">Length:</span> {classItem.length_minutes} min
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex gap-2 flex-shrink-0">
                                        <button
                                            onClick={() => startEdit(classItem)}
                                            className="text-blue-600 hover:text-blue-700 transition"
                                            title="Edit class"
                                        >
                                            <svg
                                                className="w-4 h-4"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={2}
                                                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                                />
                                            </svg>
                                        </button>
                                        <button
                                            onClick={() => confirmDelete(classItem.class_id, classItem.name)}
                                            className="text-red-600 hover:text-red-700 transition"
                                            title="Delete class"
                                        >
                                            <svg
                                                className="w-4 h-4"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={2}
                                                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                                />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Right-side toast notifications */}
            <div className="fixed top-4 right-4 z-[100] space-y-2 w-[92vw] max-w-sm pointer-events-none">
                {toasts.map((toast) => (
                    <div
                        key={toast.id}
                        className={`pointer-events-auto rounded-lg border px-3 py-2 shadow-lg text-xs sm:text-sm ${toast.type === 'success'
                                ? 'bg-green-50 border-green-200 text-green-800'
                                : 'bg-red-50 border-red-200 text-red-800'
                            }`}
                    >
                        {toast.message}
                    </div>
                ))}
            </div>

            {/* Right-side delete confirmation */}
            {deleteDialog.show && (
                <div className="fixed top-20 right-4 z-[101] w-[92vw] max-w-sm rounded-xl border border-gray-200 bg-white shadow-2xl p-4">
                    <p className="text-sm font-semibold text-gray-900">Confirm Delete</p>
                    <p className="mt-1 text-xs sm:text-sm text-gray-600">
                        Delete <span className="font-medium">{deleteDialog.className}</span>? This will remove all instructor assignments.
                    </p>
                    <div className="mt-3 flex justify-end gap-2">
                        <button
                            onClick={() => setDeleteDialog({ show: false, classId: null, className: '' })}
                            className="px-3 py-1.5 text-xs sm:text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleDelete}
                            className="px-3 py-1.5 text-xs sm:text-sm text-white bg-red-600 rounded-md hover:bg-red-700"
                        >
                            Delete
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
