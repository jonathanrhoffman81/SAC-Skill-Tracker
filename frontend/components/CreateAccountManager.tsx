'use client';

import { useState } from 'react';
import { authFetch } from '@/lib/clientAuth';

interface CreatedAccount {
    first_name: string;
    last_name: string;
    email: string;
    roles: string[];
}

const ROLE_OPTIONS = [
    { key: 'admin', label: 'Admin', description: 'Full dashboard access' },
    { key: 'instructor', label: 'Instructor', description: 'Can evaluate swimmers' },
    { key: 'parent', label: 'Parent', description: 'Can view swimmer progress' },
] as const;

type RoleKey = typeof ROLE_OPTIONS[number]['key'];

export default function CreateAccountManager({ onCreated }: { onCreated?: () => void } = {}) {
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [email, setEmail] = useState('');
    const [selectedRoles, setSelectedRoles] = useState<Set<RoleKey>>(new Set(['instructor']));
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [recentlyCreated, setRecentlyCreated] = useState<CreatedAccount[]>([]);

    function toggleRole(role: RoleKey) {
        setSelectedRoles((prev) => {
            const next = new Set(prev);
            if (next.has(role)) next.delete(role);
            else next.add(role);
            return next;
        });
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setSubmitting(true);

        try {
            const res = await authFetch('/api/admin/accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    first_name: firstName.trim(),
                    last_name: lastName.trim(),
                    email: email.trim().toLowerCase(),
                    roles: Array.from(selectedRoles),
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || 'Failed to create account');
                return;
            }

            setRecentlyCreated((prev) => [
                {
                    first_name: firstName.trim(),
                    last_name: lastName.trim(),
                    email: email.trim().toLowerCase(),
                    roles: Array.from(selectedRoles),
                },
                ...prev,
            ]);
            setFirstName('');
            setLastName('');
            setEmail('');
            setSelectedRoles(new Set(['instructor']));
            onCreated?.();
        } catch {
            setError('Network error — please try again');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="bg-white rounded-lg sm:rounded-xl border border-gray-200 shadow-sm">
            <div className="p-4 sm:p-6 border-b border-gray-100">
                <h2 className="text-base sm:text-lg font-semibold text-gray-900">Create Account</h2>
                <p className="mt-1 text-sm text-gray-500">
                    Create a login account for an instructor, admin, or parent. They can set their password
                    via &quot;Forgot password&quot; on the login page.
                </p>
            </div>

            <div className="p-4 sm:p-6">
                <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                First name
                            </label>
                            <input
                                type="text"
                                value={firstName}
                                onChange={(e) => setFirstName(e.target.value)}
                                required
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                                placeholder="Jane"
                                disabled={submitting}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Last name
                            </label>
                            <input
                                type="text"
                                value={lastName}
                                onChange={(e) => setLastName(e.target.value)}
                                required
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                                placeholder="Smith"
                                disabled={submitting}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Email address
                        </label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                            placeholder="jane@example.com"
                            disabled={submitting}
                        />
                    </div>

                    <div>
                        <p className="text-sm font-medium text-gray-700 mb-2">Roles</p>
                        <div className="space-y-2">
                            {ROLE_OPTIONS.map(({ key, label, description }) => {
                                const checked = selectedRoles.has(key);
                                return (
                                    <label
                                        key={key}
                                        className={`flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer transition ${checked
                                                ? 'border-blue-500 bg-blue-50'
                                                : 'border-gray-200 bg-white hover:bg-gray-50'
                                            }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => toggleRole(key)}
                                            disabled={submitting}
                                            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        <div>
                                            <p className="text-sm font-medium text-gray-900">{label}</p>
                                            <p className="text-xs text-gray-500">{description}</p>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                    </div>

                    {error && (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={submitting}
                        className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                    >
                        {submitting ? 'Creating...' : 'Create Account'}
                    </button>
                </form>

                {recentlyCreated.length > 0 && (
                    <div className="mt-8 max-w-md">
                        <h3 className="text-sm font-semibold text-gray-700 mb-3">Created this session</h3>
                        <div className="space-y-2">
                            {recentlyCreated.map((acct, i) => (
                                <div
                                    key={i}
                                    className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
                                >
                                    <div>
                                        <p className="text-sm font-medium text-gray-900">
                                            {acct.first_name} {acct.last_name}
                                        </p>
                                        <p className="text-xs text-gray-500">{acct.email}</p>
                                    </div>
                                    <div className="flex flex-wrap gap-1 justify-end">
                                        {acct.roles.map((r) => (
                                            <span
                                                key={r}
                                                className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 capitalize"
                                            >
                                                {r}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <p className="mt-3 text-xs text-gray-500">
                            New accounts can sign in after setting a password via &quot;Forgot password&quot; on the login page.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
