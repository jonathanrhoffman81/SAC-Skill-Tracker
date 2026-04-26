'use client';

import { useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/clientAuth';

interface SessionRecord {
    session_id: string;
    name: string;
    start_date: string | null;
    end_date: string | null;
}

interface SessionManagerProps {
    onRefresh?: () => void;
}

export default function SessionManager({ onRefresh }: SessionManagerProps) {
    const [sessions, setSessions] = useState<SessionRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [editingStart, setEditingStart] = useState('');
    const [editingEnd, setEditingEnd] = useState('');
    const [newName, setNewName] = useState('');
    const [newStart, setNewStart] = useState('');
    const [newEnd, setNewEnd] = useState('');
    const [toasts, setToasts] = useState<Array<{ id: number; message: string; type: 'success' | 'error' }>>([]);
    const [deleteDialog, setDeleteDialog] = useState<{ show: boolean; sessionId: string | null; sessionName: string }>(
        { show: false, sessionId: null, sessionName: '' }
    );

    const showToast = (message: string, type: 'success' | 'error' = 'error') => {
        const id = Date.now() + Math.floor(Math.random() * 1000);
        setToasts((prev) => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts((prev) => prev.filter((toast) => toast.id !== id));
        }, 3500);
    };

    const fetchSessions = async () => {
        setLoading(true);
        try {
            const response = await authFetch('/api/admin/sessions');
            const data = await response.json();
            if (response.ok) {
                setSessions(data.sessions || []);
            }
        } catch (error) {
            console.error('Failed to fetch sessions:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSessions();
    }, []);

    const isActive = (session: SessionRecord) => {
        if (!session.start_date || !session.end_date) return false;
        const today = new Date();
        const start = new Date(`${session.start_date}T00:00:00`);
        const end = new Date(`${session.end_date}T23:59:59`);
        return start <= today && today <= end;
    };

    const sortedSessions = useMemo(() => {
        return [...sessions].sort((a, b) => {
            const aDate = a.start_date ? new Date(a.start_date).getTime() : 0;
            const bDate = b.start_date ? new Date(b.start_date).getTime() : 0;
            if (aDate !== bDate) return bDate - aDate;
            return a.name.localeCompare(b.name);
        });
    }, [sessions]);

    const resetNewForm = () => {
        setNewName('');
        setNewStart('');
        setNewEnd('');
    };

    const handleAdd = async () => {
        if (!newName.trim()) {
            showToast('Session name is required', 'error');
            return;
        }
        if (newStart && newEnd && new Date(newStart) > new Date(newEnd)) {
            showToast('Start date must be before end date', 'error');
            return;
        }

        try {
            const response = await authFetch('/api/admin/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newName.trim(),
                    start_date: newStart || null,
                    end_date: newEnd || null,
                }),
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Failed to create session');
            }

            resetNewForm();
            showToast('Session created', 'success');
            await fetchSessions();
            onRefresh?.();
        } catch (error) {
            console.error('Failed to create session:', error);
            showToast(error instanceof Error ? error.message : 'Failed to create session', 'error');
        }
    };

    const startEdit = (session: SessionRecord) => {
        setEditingId(session.session_id);
        setEditingName(session.name);
        setEditingStart(session.start_date || '');
        setEditingEnd(session.end_date || '');
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditingName('');
        setEditingStart('');
        setEditingEnd('');
    };

    const handleSave = async (sessionId: string) => {
        if (!editingName.trim()) {
            showToast('Session name is required', 'error');
            return;
        }
        if (editingStart && editingEnd && new Date(editingStart) > new Date(editingEnd)) {
            showToast('Start date must be before end date', 'error');
            return;
        }

        try {
            const response = await authFetch('/api/admin/sessions', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionId,
                    name: editingName.trim(),
                    start_date: editingStart || null,
                    end_date: editingEnd || null,
                }),
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Failed to update session');
            }

            cancelEdit();
            showToast('Session updated', 'success');
            await fetchSessions();
            onRefresh?.();
        } catch (error) {
            console.error('Failed to update session:', error);
            showToast(error instanceof Error ? error.message : 'Failed to update session', 'error');
        }
    };

    const confirmDelete = (sessionId: string, sessionName: string) => {
        setDeleteDialog({ show: true, sessionId, sessionName });
    };

    const handleDelete = async () => {
        const sessionId = deleteDialog.sessionId;
        if (!sessionId) return;
        setDeleteDialog({ show: false, sessionId: null, sessionName: '' });

        try {
            const response = await authFetch(`/api/admin/sessions?session_id=${sessionId}`, {
                method: 'DELETE',
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Failed to delete session');
            }

            showToast('Session deleted', 'success');
            await fetchSessions();
            onRefresh?.();
        } catch (error) {
            console.error('Failed to delete session:', error);
            showToast(error instanceof Error ? error.message : 'Failed to delete session', 'error');
        }
    };

    return (
        <div className="bg-white rounded-lg sm:rounded-xl border border-gray-200 shadow-sm p-4 sm:p-6">
            <p className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Manage Sessions</p>

            <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end mb-4">
                <div>
                    <label className="block text-[10px] sm:text-xs font-medium text-gray-700 mb-1">Session name</label>
                    <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Spring 2026"
                        className="w-full px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                </div>
                <div>
                    <label className="block text-[10px] sm:text-xs font-medium text-gray-700 mb-1">Start date</label>
                    <input
                        type="date"
                        value={newStart}
                        onChange={(e) => setNewStart(e.target.value)}
                        className="w-full px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                </div>
                <div>
                    <label className="block text-[10px] sm:text-xs font-medium text-gray-700 mb-1">End date</label>
                    <input
                        type="date"
                        value={newEnd}
                        onChange={(e) => setNewEnd(e.target.value)}
                        className="w-full px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                </div>
                <button
                    onClick={handleAdd}
                    disabled={!newName.trim()}
                    className="px-3 sm:px-4 py-2 bg-blue-600 text-white text-xs sm:text-sm rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition whitespace-nowrap"
                >
                    Add
                </button>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-6 sm:py-8">
                    <div className="animate-spin rounded-full h-5 w-5 sm:h-6 sm:w-6 border-b-2 border-blue-600"></div>
                </div>
            ) : sessions.length === 0 ? (
                <p className="text-xs sm:text-sm text-gray-500 text-center py-3 sm:py-4">
                    No sessions yet. Add your first session above.
                </p>
            ) : (
                <div className="space-y-2">
                    {sortedSessions.map((session) => (
                        <div
                            key={session.session_id}
                            className="border border-gray-200 rounded-lg p-3 hover:border-gray-300 transition"
                        >
                            {editingId === session.session_id ? (
                                <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto_auto] sm:items-end">
                                    <div>
                                        <label className="block text-[10px] sm:text-xs font-medium text-gray-700 mb-1">
                                            Session name
                                        </label>
                                        <input
                                            type="text"
                                            value={editingName}
                                            onChange={(e) => setEditingName(e.target.value)}
                                            className="w-full px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] sm:text-xs font-medium text-gray-700 mb-1">
                                            Start date
                                        </label>
                                        <input
                                            type="date"
                                            value={editingStart}
                                            onChange={(e) => setEditingStart(e.target.value)}
                                            className="w-full px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] sm:text-xs font-medium text-gray-700 mb-1">
                                            End date
                                        </label>
                                        <input
                                            type="date"
                                            value={editingEnd}
                                            onChange={(e) => setEditingEnd(e.target.value)}
                                            className="w-full px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                        />
                                    </div>
                                    <button
                                        onClick={() => handleSave(session.session_id)}
                                        className="px-3 sm:px-4 py-2 bg-blue-600 text-white text-xs sm:text-sm rounded-lg hover:bg-blue-700 transition whitespace-nowrap"
                                    >
                                        Save
                                    </button>
                                    <button
                                        onClick={cancelEdit}
                                        className="px-3 sm:px-4 py-2 text-xs sm:text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition whitespace-nowrap"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            ) : (
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="text-sm sm:text-base font-semibold text-gray-900">
                                                {session.name}
                                            </p>
                                            {isActive(session) && (
                                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                                    Active
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1">
                                            {session.start_date || 'No start date'}
                                            {' to '}
                                            {session.end_date || 'No end date'}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => startEdit(session)}
                                            className="px-3 py-1.5 text-[10px] sm:text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md border border-blue-200 transition"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={() => confirmDelete(session.session_id, session.name)}
                                            className="px-3 py-1.5 text-[10px] sm:text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md border border-red-200 transition"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {deleteDialog.show && (
                <div className="fixed top-32 right-4 z-[101] w-[92vw] max-w-sm rounded-xl border border-gray-200 bg-white shadow-2xl p-4 sm:top-36">
                    <p className="text-sm font-semibold text-gray-900">Delete session</p>
                    <p className="mt-1 text-xs sm:text-sm text-gray-600">
                        Delete <span className="font-medium">{deleteDialog.sessionName}</span>?
                    </p>
                    <div className="mt-3 flex justify-end gap-2">
                        <button
                            onClick={() => setDeleteDialog({ show: false, sessionId: null, sessionName: '' })}
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

            <div className="fixed top-24 right-4 z-[100] space-y-2 w-[92vw] max-w-sm pointer-events-none sm:top-28">
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
        </div>
    );
}
