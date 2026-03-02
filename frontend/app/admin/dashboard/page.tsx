/**
 * Admin dashboard page
 * Purpose: manage swimmers, instructors, and import roster data.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

// TODO: query person table with role=swimmer for total count
const DEMO_TOTAL_SWIMMERS = 156;
// TODO: query person table with role=instructor for total count
const DEMO_TOTAL_INSTRUCTORS = 12;
// TODO: query class_entity table for active class count
const DEMO_ACTIVE_CLASSES = 24;
// TODO: query skill table for distinct levels/count per organization
const DEMO_SKILL_LEVELS = 6;

type Tab = 'roster' | 'instructors' | 'history';

function getInitials(name: string) {
    return name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

export default function AdminDashboard() {
    const router = useRouter();
    const [userName, setUserName] = useState('Admin User');
    const [activeTab, setActiveTab] = useState<Tab>('roster');

    useEffect(() => {
        const stored = localStorage.getItem('user');
        if (stored) {
            const userData = JSON.parse(stored);
            setUserName(userData.name || 'Admin User');
        }
    }, []);

    const stats = useMemo(() => [
        {
            label: 'Total Swimmers', value: DEMO_TOTAL_SWIMMERS, icon: (
                <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a4 4 0 00-5-3.87M9 20H4v-2a4 4 0 015-3.87m6 5.87a4 4 0 10-8 0m12-8a4 4 0 10-8 0 4 4 0 008 0z" /></svg>
            )
        },
        {
            label: 'Instructors', value: DEMO_TOTAL_INSTRUCTORS, icon: (
                <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197" /></svg>
            )
        },
        {
            label: 'Active Classes', value: DEMO_ACTIVE_CLASSES, icon: (
                <svg className="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="9" ry="4" strokeWidth={1.5} /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12c0 2.21 4.03 4 9 4s9-1.79 9-4M3 16c0 2.21 4.03 4 9 4s9-1.79 9-4" /></svg>
            )
        },
        {
            label: 'Skill Levels', value: DEMO_SKILL_LEVELS, icon: (
                <svg className="w-8 h-8 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            )
        },
    ], []);

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white border-b border-gray-200">
                <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
                            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                        </div>
                        <div>
                            <p className="text-sm font-bold text-gray-900">SAC Skill Tracker</p>
                            <p className="text-xs text-gray-500">Administrator Dashboard</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="text-right">
                            <p className="text-sm font-medium text-gray-900">{userName}</p>
                            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">Administrator</span>
                        </div>
                        <div className="h-9 w-9 rounded-full bg-gray-800 flex items-center justify-center text-xs font-semibold text-white">
                            {getInitials(userName)}
                        </div>
                        <button
                            onClick={() => { localStorage.removeItem('user'); router.push('/login'); }}
                            className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {stats.map((stat) => (
                        <div key={stat.label} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                            <p className="text-xs text-gray-500 mb-1">{stat.label}</p>
                            <div className="flex items-center justify-between">
                                <p className="text-3xl font-bold text-gray-900">{stat.value}</p>
                                {stat.icon}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Tabs */}
                <div className="flex gap-2">
                    {([
                        { id: 'roster', label: 'Roster Management', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg> },
                        { id: 'instructors', label: 'Instructors', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-5-3.87M9 20H4v-2a4 4 0 015-3.87m6 5.87a4 4 0 10-8 0m12-8a4 4 0 10-8 0 4 4 0 008 0z" /></svg> },
                        { id: 'history', label: 'Import History', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7M9 11h6m-6 4h6M7 3h10l1 4H6L7 3z" /></svg> },
                    ] as { id: Tab; label: string; icon: React.ReactNode }[]).map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition ${activeTab === tab.id
                                ? 'bg-white border-gray-300 text-gray-900 shadow-sm'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                {activeTab === 'roster' && (
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                        <div className="p-6 flex items-center justify-between border-b border-gray-100">
                            <h2 className="text-base font-semibold text-gray-900">Import from SportsEngine</h2>
                        </div>

                        <div className="p-6">
                            <div className="border-2 border-dashed border-gray-200 rounded-xl p-10 flex flex-col items-center text-center mb-6">
                                <svg className="w-12 h-12 text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="9" ry="4" strokeWidth={1.5} /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12c0 2.21 4.03 4 9 4s9-1.79 9-4M3 16c0 2.21 4.03 4 9 4s9-1.79 9-4" /></svg>
                                <p className="text-base font-semibold text-gray-900 mb-1">Import Roster Data</p>
                                <p className="text-sm text-gray-500 mb-5">Import swimmer roster, levels, and class assignments from SportsEngine</p>
                                <div className="flex gap-3">
                                    <button className="flex items-center gap-2 border border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50 transition">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                                        Upload CSV
                                    </button>
                                </div>
                            </div>

                            <div>
                                <p className="text-sm font-semibold text-gray-900 mb-2">Supported Import Options:</p>
                                <ul className="text-sm text-gray-500 space-y-1">
                                    <li>• Bulk roster updates from SportsEngine API</li>
                                    <li>• CSV file upload for manual imports</li>
                                    <li>• Level and class assignment synchronization</li>
                                    <li>• Parent contact information updates</li>
                                </ul>
                            </div>
                        </div>

                        {/* Quick Actions */}
                        <div className="px-6 pb-6">
                            <p className="text-sm font-semibold text-gray-900 mb-3">Manual Actions</p>
                            <div className="grid grid-cols-3 gap-3">
                                {[
                                    // TODO: these buttons don't currently work - need to implement
                                    { label: 'Add Swimmer', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg> },
                                    { label: 'Add Instructor', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg> },
                                    { label: 'Manage Levels', icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg> },
                                ].map((action) => (
                                    <button key={action.label} className="flex flex-col items-center gap-2 py-4 border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50 transition">
                                        {action.icon}
                                        {action.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'instructors' && (
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                        {/* TODO: query person table with role=instructor, joined with class_instructor for their classes */}
                        <p className="text-sm text-gray-500 text-center py-8">No instructors to display</p>
                    </div>
                )}

                {activeTab === 'history' && (
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                        {/* TODO: query import history log table if added to schema */}
                        <p className="text-sm text-gray-500 text-center py-8">No import history to display</p>
                    </div>
                )}
            </main>
        </div>
    );
}


