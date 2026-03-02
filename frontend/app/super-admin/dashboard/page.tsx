/**
 * Super Admin Dashboard
 * Purpose: No-code tool for creating and managing organizations.
 * Super admins can create new orgs, view existing orgs, and manage org settings.
 */

'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';

interface Organization {
  id: string;
  name: string;
  slug: string;
  adminEmail: string;
  adminName: string;
  status: 'active' | 'pending' | 'suspended';
  createdAt: string;
  memberCount: number;
  instructorCount: number;
}

interface NewOrgForm {
  name: string;
  slug: string;
  adminName: string;
  adminEmail: string;
}

function generateSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function getStatusBadge(status: Organization['status']) {
  switch (status) {
    case 'active':
      return 'bg-green-100 text-green-700';
    case 'pending':
      return 'bg-yellow-100 text-yellow-700';
    case 'suspended':
      return 'bg-red-100 text-red-700';
  }
}

export default function SuperAdminDashboard() {
  const router = useRouter();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [newOrg, setNewOrg] = useState<NewOrgForm>({
    name: '',
    slug: '',
    adminName: '',
    adminEmail: '',
  });
  const [createSuccess, setCreateSuccess] = useState(false);

  // Hardcoded organizations - TODO: Replace with Supabase query
  const [organizations, setOrganizations] = useState<Organization[]>([
    {
      id: 'org-1',
      name: 'Shippensburg Aquatic Club',
      slug: 'shippensburg-aquatic-club',
      adminEmail: 'admin@shippensburgaquatic.org',
      adminName: 'Jonathan Hoffman',
      status: 'active',
      createdAt: 'Jan 15, 2025',
      memberCount: 245,
      instructorCount: 12,
    },
    {
      id: 'org-2',
      name: 'Gettysburg Swim Academy',
      slug: 'gettysburg-swim-academy',
      adminEmail: 'director@gettysburgswim.com',
      adminName: 'Sarah Thompson',
      status: 'active',
      createdAt: 'Mar 22, 2025',
      memberCount: 180,
      instructorCount: 8,
    },
    {
      id: 'org-3',
      name: 'Chambersburg Youth Aquatics',
      slug: 'chambersburg-youth-aquatics',
      adminEmail: 'info@chambersburgaquatics.org',
      adminName: 'Michael Patterson',
      status: 'active',
      createdAt: 'Jun 10, 2025',
      memberCount: 156,
      instructorCount: 7,
    },
    {
      id: 'org-4',
      name: 'Carlisle Swim Club',
      slug: 'carlisle-swim-club',
      adminEmail: 'coach@carlisleswim.org',
      adminName: 'Jennifer Walsh',
      status: 'active',
      createdAt: 'Sep 5, 2025',
      memberCount: 198,
      instructorCount: 9,
    },
    {
      id: 'org-5',
      name: 'Hanover Area Swimmers',
      slug: 'hanover-area-swimmers',
      adminEmail: 'admin@hanoverswim.com',
      adminName: 'Robert Snyder',
      status: 'pending',
      createdAt: 'Feb 10, 2026',
      memberCount: 0,
      instructorCount: 0,
    },
  ]);

  const filteredOrgs = useMemo(() => {
    if (!searchQuery.trim()) return organizations;
    const query = searchQuery.toLowerCase();
    return organizations.filter(
      (org) =>
        org.name.toLowerCase().includes(query) ||
        org.slug.toLowerCase().includes(query) ||
        org.adminEmail.toLowerCase().includes(query)
    );
  }, [organizations, searchQuery]);

  const stats = useMemo(() => {
    const totalOrgs = organizations.length;
    const activeOrgs = organizations.filter((o) => o.status === 'active').length;
    const totalMembers = organizations.reduce((acc, o) => acc + o.memberCount, 0);
    const totalInstructors = organizations.reduce((acc, o) => acc + o.instructorCount, 0);
    return { totalOrgs, activeOrgs, totalMembers, totalInstructors };
  }, [organizations]);

  const handleNameChange = (name: string) => {
    setNewOrg((prev) => ({
      ...prev,
      name,
      slug: generateSlug(name),
    }));
  };

  const handleCreateOrg = () => {
    if (!newOrg.name || !newOrg.adminEmail || !newOrg.adminName) return;

    const org: Organization = {
      id: `org-${Date.now()}`,
      name: newOrg.name,
      slug: newOrg.slug || generateSlug(newOrg.name),
      adminEmail: newOrg.adminEmail,
      adminName: newOrg.adminName,
      status: 'pending',
      createdAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      memberCount: 0,
      instructorCount: 0,
    };

    setOrganizations((prev) => [org, ...prev]);
    setNewOrg({ name: '', slug: '', adminName: '', adminEmail: '' });
    setCreateSuccess(true);
    setTimeout(() => {
      setCreateSuccess(false);
      setShowCreateModal(false);
    }, 1500);
  };

  const handleSignOut = () => {
    localStorage.removeItem('user');
    router.push('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">SAC Skill Tracker</h1>
            <p className="text-sm text-gray-500">Super Admin Dashboard</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center px-3 py-1 text-xs font-semibold bg-purple-100 text-purple-700 rounded-full">
              Super Admin
            </span>
            <button
              onClick={handleSignOut}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Stats */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-3xl font-bold text-gray-900">{stats.totalOrgs}</p>
            <p className="text-sm text-gray-500">Total Organizations</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-3xl font-bold text-green-600">{stats.activeOrgs}</p>
            <p className="text-sm text-gray-500">Active Organizations</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-3xl font-bold text-gray-900">{stats.totalMembers}</p>
            <p className="text-sm text-gray-500">Total Members</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-3xl font-bold text-gray-900">{stats.totalInstructors}</p>
            <p className="text-sm text-gray-500">Total Instructors</p>
          </div>
        </section>

        {/* Organizations Section */}
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Organizations</h2>
              <p className="text-sm text-gray-500">Manage all registered organizations</p>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search organizations..."
                className="h-10 w-64 rounded-lg border border-gray-200 bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-gray-200"
              />
              <button
                onClick={() => setShowCreateModal(true)}
                className="h-10 px-4 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition flex items-center gap-2"
              >
                <span>+</span>
                <span>New Organization</span>
              </button>
            </div>
          </div>

          {/* Organizations Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Organization
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Admin
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Members
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredOrgs.map((org) => (
                  <tr key={org.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{org.name}</p>
                        <p className="text-xs text-gray-500">{org.slug}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-sm text-gray-900">{org.adminName}</p>
                        <p className="text-xs text-gray-500">{org.adminEmail}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusBadge(org.status)}`}>
                        {org.status.charAt(0).toUpperCase() + org.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-sm text-gray-900">{org.memberCount} members</p>
                        <p className="text-xs text-gray-500">{org.instructorCount} instructors</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-gray-500">{org.createdAt}</p>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button className="text-sm text-gray-600 hover:text-gray-900 font-medium">
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {filteredOrgs.length === 0 && (
              <div className="px-6 py-12 text-center text-gray-500">
                <p>No organizations found</p>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Create Organization Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Create New Organization</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {createSuccess ? (
              <div className="px-6 py-12 text-center">
                <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-lg font-medium text-gray-900">Organization Created!</p>
                <p className="text-sm text-gray-500 mt-1">An invite email will be sent to the admin.</p>
              </div>
            ) : (
              <div className="px-6 py-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Organization Name *
                  </label>
                  <input
                    type="text"
                    value={newOrg.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="e.g. Seattle Aquatic Club"
                    className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    URL Slug
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">app.sactracker.com/</span>
                    <input
                      type="text"
                      value={newOrg.slug}
                      onChange={(e) => setNewOrg((prev) => ({ ...prev, slug: e.target.value }))}
                      placeholder="seattle-aquatic-club"
                      className="flex-1 h-10 px-3 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gray-200"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Admin Name *
                  </label>
                  <input
                    type="text"
                    value={newOrg.adminName}
                    onChange={(e) => setNewOrg((prev) => ({ ...prev, adminName: e.target.value }))}
                    placeholder="John Smith"
                    className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Admin Email *
                  </label>
                  <input
                    type="email"
                    value={newOrg.adminEmail}
                    onChange={(e) => setNewOrg((prev) => ({ ...prev, adminEmail: e.target.value }))}
                    placeholder="admin@organization.com"
                    className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gray-200"
                  />
                  <p className="text-xs text-gray-500 mt-1">An invitation will be sent to this email.</p>
                </div>
              </div>
            )}

            {!createSuccess && (
              <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateOrg}
                  disabled={!newOrg.name || !newOrg.adminEmail || !newOrg.adminName}
                  className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition"
                >
                  Create Organization
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

