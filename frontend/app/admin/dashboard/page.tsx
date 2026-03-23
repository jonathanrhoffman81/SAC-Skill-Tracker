/**
 * Admin dashboard page
 * Purpose: manage swimmers, instructors, and import roster data.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import InstructorManager from "@/components/InstructorManager";
import ClassManager from "@/components/ClassManager";
import InstructorAssignmentManager from "@/components/InstructorAssignmentManager";
import ImportRoster from "@/components/ImportRoster";

// Dashboard statistics from admin API
interface AdminStats {
  totalMembers: number;
  totalInstructors: number;
  activeClasses: number;
  skillLevels: number;
  organizationName: string;
  organizationId: string;
}

// Generic entity with normalized id field for consistent handling
interface Entity {
  id: string; // Normalized from skill_id, person_id, class_id, etc.
  name: string;
  [key: string]: any;
}

// State for each entity type (skills, instructors, swimmers, parents, classes)
interface EntityState {
  list: Entity[];
  loading: boolean;
  editingId: string | null; // ID of item currently being edited
  editingName: string; // Edited name value
  newName: string; // New item input value
}

type EntityType = "skills" | "instructors" | "swimmers" | "parents" | "classes";
type Tab = EntityType | "roster" | "admins" | "assignments";

interface OrgPerson {
  person_id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
}

interface ToastMessage {
  id: number;
  message: string;
  type: "success" | "error";
}

// Configuration for each entity type. Centralizes all entity-specific logic.
// To add a new entity: add an entry here, and it works everywhere (forms, API, UI)
const ENTITY_CONFIG: Record<
  EntityType,
  {
    singularLabel: string; // Used in alerts/messages: "Delete this instructor?"
    pluralLabel: string; // Tab heading: "Manage Instructors"
    apiPath: string; // API endpoint: /api/admin/instructors
    dataKey: string; // Response key: data.instructors
    idField: string; // ID field name in database: person_id vs skill_id
    displayName: (item: Entity) => string; // How to display item in list: name or "first last"
  }
> = {
  skills: {
    singularLabel: "skill",
    pluralLabel: "Skills",
    apiPath: "/api/admin/skills",
    dataKey: "skills",
    idField: "skill_id",
    displayName: (item) => item.name,
  },
  instructors: {
    singularLabel: "instructor",
    pluralLabel: "Instructors",
    apiPath: "/api/admin/instructors",
    dataKey: "instructors",
    idField: "person_id",
    displayName: (item) =>
      `${item.first_name || ""} ${item.last_name || ""}`.trim(),
  },
  swimmers: {
    singularLabel: "swimmer",
    pluralLabel: "Swimmers",
    apiPath: "/api/admin/swimmers",
    dataKey: "swimmers",
    idField: "person_id",
    displayName: (item) => `${item.first_name} ${item.last_name}`,
  },
  parents: {
    singularLabel: "parent",
    pluralLabel: "Parents",
    apiPath: "/api/admin/parents",
    dataKey: "parents",
    idField: "person_id",
    displayName: (item) => `${item.first_name} ${item.last_name}`,
  },
  classes: {
    singularLabel: "class",
    pluralLabel: "Classes",
    apiPath: "/api/admin/classes",
    dataKey: "classes",
    idField: "class_id",
    displayName: (item) => item.name,
  },
};

// Navigation tabs for the dashboard. Reusable for any entity type.
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: "assignments",
    label: "Assignments",
    icon: (
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
          d="M13 10V3L4 14h7v7l9-11h-7z"
        />
      </svg>
    ),
  },
  {
    id: "skills",
    label: "Skills",
    icon: (
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
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  {
    id: "admins",
    label: "Admins",
    icon: (
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
          d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12l2 2 4-4"
        />
      </svg>
    ),
  },
  {
    id: "instructors",
    label: "Instructors",
    icon: (
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
          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
        />
      </svg>
    ),
  },
  {
    id: "parents",
    label: "Parents",
    icon: (
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
          d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
        />
      </svg>
    ),
  },
  {
    id: "swimmers",
    label: "Swimmers",
    icon: (
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
          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
        />
      </svg>
    ),
  },
  {
    id: "classes",
    label: "Classes",
    icon: (
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
          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
    ),
  },
  {
    id: "roster",
    label: "Roster Management",
    icon: (
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
          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
        />
      </svg>
    ),
  },
];

function getInitials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * EntityEditor - Reusable CRUD UI for any entity type (skills, instructors, etc.)
 * Handles: adding, editing, deleting items with inline editing
 * Uses ENTITY_CONFIG to adapt labels, API paths, and display names dynamically
 * Keyboard shortcuts: Enter to save, Escape to cancel
 */
function EntityEditor({
  type,
  state,
  onAdd,
  onUpdate,
  onDelete,
  onStartEdit,
  onCancelEdit,
  onNewNameChange,
  onEditNameChange,
}: {
  type: EntityType;
  state: EntityState;
  onAdd: () => void;
  onUpdate: (id: string) => void;
  onDelete: (id: string) => void;
  onStartEdit: (item: Entity) => void;
  onCancelEdit: () => void;
  onNewNameChange: (value: string) => void;
  onEditNameChange: (value: string) => void;
}) {
  const config = ENTITY_CONFIG[type];
  const [searchFilter, setSearchFilter] = useState("");

  // Deduplicate swimmers by name to handle database duplicates
  const deduplicatedList = type === "swimmers"
    ? Array.from(
      new Map(
        state.list.map((item) => {
          const displayName = config.displayName(item);
          return [displayName.toLowerCase(), item];
        })
      ).values()
    )
    : state.list;

  // Filter list by name if searching
  const filteredList = searchFilter.trim()
    ? deduplicatedList.filter((item) => {
      const displayName = config.displayName(item).toLowerCase();
      return displayName.includes(searchFilter.toLowerCase());
    })
    : deduplicatedList;

  return (
    <div className="bg-white rounded-lg sm:rounded-xl border border-gray-200 shadow-sm p-4 sm:p-6">
      <p className="text-xs sm:text-sm font-semibold text-gray-900 mb-3 sm:mb-4">
        Manage {config.pluralLabel}
      </p>

      {/* Add New Item */}
      <div className="flex gap-2 mb-3 sm:mb-4">
        <input
          type="text"
          value={state.newName}
          onChange={(e) => onNewNameChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onAdd()}
          placeholder={`Add new ${config.singularLabel}...`}
          className="flex-1 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        />
        <button
          onClick={onAdd}
          disabled={!state.newName.trim()}
          className="px-3 sm:px-4 py-1.5 sm:py-2 bg-blue-600 text-white text-xs sm:text-sm rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition whitespace-nowrap"
        >
          Add
        </button>
      </div>

      {/* Search Filter - for swimmers tab */}
      {type === "swimmers" && deduplicatedList.length > 0 && (
        <div className="mb-4">
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Search swimmers by name..."
            className="w-full px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>
      )}

      {/* Items List */}
      {state.loading ? (
        <div className="flex items-center justify-center py-6 sm:py-8">
          <div className="animate-spin rounded-full h-5 w-5 sm:h-6 sm:w-6 border-b-2 border-blue-600"></div>
        </div>
      ) : state.list.length === 0 ? (
        <p className="text-xs sm:text-sm text-gray-500 text-center py-3 sm:py-4">
          No {config.pluralLabel.toLowerCase()} yet. Add one above!
        </p>
      ) : filteredList.length === 0 ? (
        <p className="text-xs sm:text-sm text-gray-500 text-center py-3 sm:py-4">
          No {config.pluralLabel.toLowerCase()} match "{searchFilter}"
        </p>
      ) : (
        <div className="space-y-3">
          {filteredList.map((item) => (
            <div key={item.id} className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50 group">
              <div className="flex items-center gap-2 py-1">
                {state.editingId === item.id ? (
                  <>
                    <input
                      type="text"
                      value={state.editingName}
                      onChange={(e) => onEditNameChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onUpdate(item.id);
                        if (e.key === "Escape") onCancelEdit();
                      }}
                      autoFocus
                      className="flex-1 px-2 py-1 text-xs sm:text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                    <button
                      onClick={() => onUpdate(item.id)}
                      className="text-green-600 hover:text-green-700 flex-shrink-0"
                    >
                      <svg
                        className="w-3.5 h-3.5 sm:w-4 sm:h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </button>
                    <button
                      onClick={onCancelEdit}
                      className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                    >
                      <svg
                        className="w-3.5 h-3.5 sm:w-4 sm:h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-xs sm:text-sm font-medium text-gray-900 truncate">
                      {config.displayName(item)}
                    </span>
                    <button
                      onClick={() => onStartEdit(item)}
                      className="opacity-0 group-hover:opacity-100 text-blue-600 hover:text-blue-700 transition-opacity flex-shrink-0"
                    >
                      <svg
                        className="w-3.5 h-3.5 sm:w-4 sm:h-4"
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
                      onClick={() => onDelete(item.id)}
                      className="opacity-0 group-hover:opacity-100 text-red-600 hover:text-red-700 transition-opacity flex-shrink-0"
                    >
                      <svg
                        className="w-3.5 h-3.5 sm:w-4 sm:h-4"
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
                  </>
                )}
              </div>

              {/* Show children for parents */}
              {type === "parents" && (item as any).children && (item as any).children.length > 0 && (
                <div className="mt-2 ml-3 pl-3 border-l-2 border-gray-300">
                  <p className="text-xs text-gray-600 font-semibold mb-1">Children:</p>
                  <div className="space-y-1">
                    {(item as any).children.map((child: any) => (
                      <div key={child.member_id} className="text-xs text-gray-700">
                        {`${child.first_name || ''} ${child.last_name || ''}`.trim() || 'Unnamed'}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {type === "parents" && (!((item as any).children) || (item as any).children.length === 0) && (
                <div className="mt-2 ml-3 pl-3 border-l-2 border-gray-300">
                  <p className="text-xs text-gray-500 italic">No children linked</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  const router = useRouter();
  const [userName, setUserName] = useState("Admin User");
  const [userEmail, setUserEmail] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("assignments");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [admins, setAdmins] = useState<OrgPerson[]>([]);
  const [adminCandidates, setAdminCandidates] = useState<OrgPerson[]>([]);
  const [selectedAdminCandidate, setSelectedAdminCandidate] = useState("");
  const [adminsLoading, setAdminsLoading] = useState(false);
  const [promotingAdmin, setPromotingAdmin] = useState(false);
  const [demotingAdmin, setDemotingAdmin] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [demoteConfirmDialog, setDemoteConfirmDialog] = useState<{
    show: boolean;
    personId: string | null;
    personName: string;
  }>({ show: false, personId: null, personName: "" });
  const [entityDeleteDialog, setEntityDeleteDialog] = useState<{
    show: boolean;
    type: EntityType | null;
    entityId: string | null;
    entityLabel: string;
  }>({ show: false, type: null, entityId: null, entityLabel: "" });

  const showToast = (message: string, type: "success" | "error" = "error") => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 3500);
  };

  // Single generic state object manages all 5 entity types
  // Structure: { skills: {...}, instructors: {...}, swimmers: {...}, parents: {...}, classes: {...} }
  const [entities, setEntities] = useState<Record<EntityType, EntityState>>({
    skills: {
      list: [],
      loading: false,
      editingId: null,
      editingName: "",
      newName: "",
    },
    instructors: {
      list: [],
      loading: false,
      editingId: null,
      editingName: "",
      newName: "",
    },
    swimmers: {
      list: [],
      loading: false,
      editingId: null,
      editingName: "",
      newName: "",
    },
    parents: {
      list: [],
      loading: false,
      editingId: null,
      editingName: "",
      newName: "",
    },
    classes: {
      list: [],
      loading: false,
      editingId: null,
      editingName: "",
      newName: "",
    },
  });

  // Fetch dashboard statistics
  const fetchStats = async () => {
    if (!userEmail) return;

    try {
      const response = await fetch(
        `/api/admin/dashboard?email=${encodeURIComponent(userEmail)}`,
      );
      if (!response.ok) throw new Error("Failed to load stats");
      const data = await response.json();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  // Load user info and dashboard statistics on mount
  useEffect(() => {
    const stored = localStorage.getItem("user");
    if (stored) {
      const userData = JSON.parse(stored);
      setUserName(userData.name || "Admin User");
      setUserEmail(userData.email || "");
    }
  }, []);

  // Fetch stats when userEmail is set
  useEffect(() => {
    if (userEmail) {
      fetchStats();
    }
  }, [userEmail]);

  // Memoize stat cards to avoid unnecessary recalculations
  const statCards = useMemo(
    () => [
      {
        label: "Total Members",
        value: stats?.totalMembers ?? 0,
        icon: (
          <svg
            className="w-8 h-8 text-blue-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
        ),
      },
      {
        label: "Instructors",
        value: stats?.totalInstructors ?? 0,
        icon: (
          <svg
            className="w-8 h-8 text-green-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
        ),
      },
      {
        label: "Active Classes",
        value: stats?.activeClasses ?? 0,
        icon: (
          <svg
            className="w-8 h-8 text-purple-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        ),
      },
      {
        label: "Skill Levels",
        value: stats?.skillLevels ?? 0,
        icon: (
          <svg
            className="w-8 h-8 text-orange-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        ),
      },
    ],
    [stats],
  );

  // Load all entity types when user email is available
  useEffect(() => {
    if (userEmail) {
      Object.keys(ENTITY_CONFIG).forEach((type) => {
        fetchEntity(type as EntityType);
      });
      fetchAdmins();
    }
  }, [userEmail]);

  const getPersonDisplayName = (person: OrgPerson) => {
    const name = `${person.first_name || ""} ${person.last_name || ""}`.trim();
    return name || person.email || "Unknown";
  };

  const fetchAdmins = async () => {
    if (!userEmail) return;
    setAdminsLoading(true);
    try {
      const response = await fetch(
        `/api/admin/admins?email=${encodeURIComponent(userEmail)}`,
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load admins");
      setAdmins(data.admins || []);
      setAdminCandidates(data.candidates || []);
    } catch (err) {
      console.error("Error fetching admins:", err);
    } finally {
      setAdminsLoading(false);
    }
  };

  const handlePromoteAdmin = async () => {
    if (!userEmail || !selectedAdminCandidate) return;
    setPromotingAdmin(true);
    try {
      const response = await fetch("/api/admin/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: userEmail,
          person_id: selectedAdminCandidate,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Failed to promote admin");
      setSelectedAdminCandidate("");
      await fetchAdmins();
    } catch (err) {
      console.error("Error promoting admin:", err);
      showToast(
        err instanceof Error ? err.message : "Failed to promote admin",
        "error",
      );
    } finally {
      setPromotingAdmin(false);
    }
  };

  const confirmDemoteAdmin = (person: OrgPerson) => {
    setDemoteConfirmDialog({
      show: true,
      personId: person.person_id,
      personName: getPersonDisplayName(person),
    });
  };

  const handleDemoteAdmin = async () => {
    const personId = demoteConfirmDialog.personId;
    if (!userEmail || !personId) return;

    setDemoteConfirmDialog({ show: false, personId: null, personName: "" });
    setDemotingAdmin(personId);

    try {
      const response = await fetch(
        `/api/admin/admins?email=${encodeURIComponent(userEmail)}&person_id=${personId}`,
        {
          method: "DELETE",
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to demote admin");
      await fetchAdmins();
      showToast("Admin demoted successfully", "success");
    } catch (err) {
      console.error("Error demoting admin:", err);
      showToast(
        err instanceof Error ? err.message : "Failed to demote admin",
        "error",
      );
    } finally {
      setDemotingAdmin(null);
    }
  };

  // Fetch a specific entity type from API with loading state management
  const fetchEntity = async (type: EntityType) => {
    if (!userEmail) return;
    setEntities((prev) => ({
      ...prev,
      [type]: { ...prev[type], loading: true },
    }));
    try {
      const config = ENTITY_CONFIG[type];
      const response = await fetch(
        `${config.apiPath}?email=${encodeURIComponent(userEmail)}`,
      );
      if (!response.ok) throw new Error(`Failed to load ${type}`);
      const data = await response.json();
      const listData = data[config.dataKey] || [];
      const listWithIds = listData.map((item: any) => ({
        ...item,
        id: item[config.idField],
      }));
      setEntities((prev) => ({
        ...prev,
        [type]: { ...prev[type], list: listWithIds },
      }));
    } catch (err) {
      console.error(`Error fetching ${type}:`, err);
    } finally {
      setEntities((prev) => ({
        ...prev,
        [type]: { ...prev[type], loading: false },
      }));
    }
  };

  // Create new entity. Uses entity-specific API path and field names from config.
  const handleAdd = async (type: EntityType) => {
    const state = entities[type];
    if (!state.newName.trim() || !userEmail) return;
    try {
      const config = ENTITY_CONFIG[type];
      const response = await fetch(config.apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userEmail, name: state.newName.trim() }),
      });
      if (!response.ok) throw new Error(`Failed to create ${type}`);
      setEntities((prev) => ({
        ...prev,
        [type]: { ...prev[type], newName: "" },
      }));
      await fetchEntity(type);
    } catch (err) {
      console.error(`Error adding ${type}:`, err);
      showToast(`Failed to add ${ENTITY_CONFIG[type].singularLabel}`, "error");
    }
  };

  // Update entity by ID. Uses correct ID field (skill_id, person_id, etc.) from config.
  const handleUpdate = async (type: EntityType, id: string) => {
    const state = entities[type];
    if (!state.editingName.trim() || !userEmail) return;
    try {
      const config = ENTITY_CONFIG[type];
      const response = await fetch(config.apiPath, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: userEmail,
          [config.idField]: id,
          name: state.editingName.trim(),
        }),
      });
      if (!response.ok) throw new Error(`Failed to update ${type}`);
      setEntities((prev) => ({
        ...prev,
        [type]: { ...prev[type], editingId: null, editingName: "" },
      }));
      await fetchEntity(type);
      showToast(`${ENTITY_CONFIG[type].singularLabel} updated`, "success");
    } catch (err) {
      console.error(`Error updating ${type}:`, err);
      showToast(`Failed to update ${ENTITY_CONFIG[type].singularLabel}`, "error");
    }
  };

  const requestDeleteEntity = (type: EntityType, id: string) => {
    const entity = entities[type].list.find((item) => item.id === id);
    const label = entity
      ? ENTITY_CONFIG[type].displayName(entity)
      : ENTITY_CONFIG[type].singularLabel;
    setEntityDeleteDialog({
      show: true,
      type,
      entityId: id,
      entityLabel: label,
    });
  };

  // Delete entity after right-side confirmation.
  const handleDeleteConfirmed = async () => {
    const { type, entityId } = entityDeleteDialog;
    if (!userEmail || !type || !entityId) return;

    setEntityDeleteDialog({
      show: false,
      type: null,
      entityId: null,
      entityLabel: "",
    });

    try {
      const config = ENTITY_CONFIG[type];
      const response = await fetch(
        `${config.apiPath}?email=${encodeURIComponent(userEmail)}&${config.idField}=${entityId}`,
        {
          method: "DELETE",
        },
      );
      if (!response.ok) throw new Error(`Failed to delete ${type}`);
      await fetchEntity(type);
      showToast(`${ENTITY_CONFIG[type].singularLabel} deleted`, "success");
    } catch (err) {
      console.error(`Error deleting ${type}:`, err);
      showToast(`Failed to delete ${ENTITY_CONFIG[type].singularLabel}`, "error");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* HEADER */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 bg-blue-600 rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0">
              <svg
                className="w-4 h-4 sm:w-5 sm:h-5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-bold text-gray-900 truncate">
                {stats?.organizationName || "SAC Skill Tracker"}
              </p>
              <p className="text-[10px] sm:text-xs text-gray-500 hidden sm:block">
                Administrator Dashboard
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="text-right hidden md:block">
              <p className="text-sm font-medium text-gray-900">{userName}</p>
              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                Administrator
              </span>
            </div>
            <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-full bg-gray-800 flex items-center justify-center text-[10px] sm:text-xs font-semibold text-white flex-shrink-0">
              {getInitials(userName)}
            </div>
            <button
              onClick={() => {
                localStorage.removeItem("user");
                router.push("/login");
              }}
              className="h-8 w-8 sm:h-9 sm:w-9 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 flex-shrink-0"
            >
              <svg
                className="w-4 h-4 sm:w-5 sm:h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-4 sm:space-y-6">
        {/* Loading Banner */}
        {loading && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4 flex items-center gap-2 sm:gap-3">
            <div className="animate-spin rounded-full h-4 w-4 sm:h-5 sm:w-5 border-b-2 border-blue-600 flex-shrink-0"></div>
            <p className="text-xs sm:text-sm text-blue-800">
              Loading dashboard statistics...
            </p>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 sm:p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 sm:gap-3 min-w-0 flex-1">
                <svg
                  className="w-4 h-4 sm:w-5 sm:h-5 text-red-600 mt-0.5 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-medium text-red-800">
                    Failed to load statistics
                  </p>
                  <p className="text-[10px] sm:text-xs text-red-700 mt-0.5 sm:mt-1 break-words">
                    {error}
                  </p>
                </div>
              </div>
              <button
                onClick={() => window.location.reload()}
                className="text-[10px] sm:text-xs bg-red-100 hover:bg-red-200 text-red-800 px-2 sm:px-3 py-1 sm:py-1.5 rounded-md transition-colors whitespace-nowrap flex-shrink-0"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2 sm:gap-3 md:gap-4">
          {statCards.map((stat) => (
            <div
              key={stat.label}
              className="bg-white rounded-lg sm:rounded-xl border border-gray-200 p-3 sm:p-4 md:p-5 shadow-sm"
            >
              <p className="text-[10px] sm:text-xs md:text-sm text-gray-500 mb-1 truncate">
                {stat.label}
              </p>
              <div className="flex flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-1 sm:gap-2">
                <p className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold text-gray-900">
                  {stat.value}
                </p>
                <div className="[&>svg]:w-6 [&>svg]:h-6 sm:[&>svg]:w-7 sm:[&>svg]:h-7 md:[&>svg]:w-8 md:[&>svg]:h-8 lg:[&>svg]:w-9 lg:[&>svg]:h-9 flex-shrink-0">
                  {stat.icon}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-hide">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-all duration-200 whitespace-nowrap ${activeTab === tab.id
                ? "bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40 hover:from-blue-600 hover:to-blue-700 transform hover:-translate-y-0.5"
                : "bg-white text-gray-700 border border-gray-200 hover:border-blue-300 hover:shadow-md hover:bg-blue-50 shadow-sm"
                }`}
            >
              <span className="[&>svg]:w-3.5 [&>svg]:h-3.5 sm:[&>svg]:w-4 sm:[&>svg]:h-4">
                {tab.icon}
              </span>
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.label.split(" ")[0]}</span>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "roster" && (
          <div className="bg-white rounded-lg sm:rounded-xl border border-gray-200 shadow-sm">
            <div className="p-4 sm:p-6 flex items-center justify-between border-b border-gray-100">
              <h2 className="text-sm sm:text-base font-semibold text-gray-900">
                Import from SportsEngine
              </h2>
            </div>

            <ImportRoster organizationId={stats?.organizationId} />
          </div>
        )}

        {activeTab === "admins" && (
          <div className="bg-white rounded-lg sm:rounded-xl border border-gray-200 shadow-sm p-4 sm:p-6">
            <h2 className="text-sm sm:text-base font-semibold text-gray-900 mb-3 sm:mb-4">
              Organization Admins
            </h2>

            <div className="mb-4 sm:mb-6">
              <p className="text-xs sm:text-sm font-medium text-gray-800 mb-2">
                Promote instructor to admin
              </p>
              <div className="flex gap-2">
                <select
                  value={selectedAdminCandidate}
                  onChange={(e) => setSelectedAdminCandidate(e.target.value)}
                  className="flex-1 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                >
                  <option value="">Select an instructor...</option>
                  {adminCandidates.map((person) => (
                    <option key={person.person_id} value={person.person_id}>
                      {getPersonDisplayName(person)}
                      {person.email ? ` (${person.email})` : ""}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handlePromoteAdmin}
                  disabled={!selectedAdminCandidate || promotingAdmin}
                  className="px-3 sm:px-4 py-1.5 sm:py-2 bg-blue-600 text-white text-xs sm:text-sm rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition whitespace-nowrap"
                >
                  {promotingAdmin ? "Promoting..." : "Promote"}
                </button>
              </div>
              <p className="text-[10px] sm:text-xs text-gray-500 mt-1.5 sm:mt-2">
                Promoting keeps instructor permissions and adds admin
                permissions.
              </p>
            </div>

            <div>
              <p className="text-xs sm:text-sm font-medium text-gray-800 mb-2">
                Current admins
              </p>
              {adminsLoading ? (
                <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-500">
                  <div className="animate-spin rounded-full h-3.5 w-3.5 sm:h-4 sm:w-4 border-b-2 border-blue-600"></div>
                  Loading admins...
                </div>
              ) : admins.length === 0 ? (
                <p className="text-xs sm:text-sm text-gray-500">
                  No admins found.
                </p>
              ) : (
                <div className="space-y-1">
                  {admins.map((person) => (
                    <div
                      key={person.person_id}
                      className="px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg border border-gray-100 bg-gray-50 flex items-center justify-between gap-2"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs sm:text-sm text-gray-900 truncate">
                          {getPersonDisplayName(person)}
                        </p>
                        {person.email && (
                          <p className="text-[10px] sm:text-xs text-gray-500 truncate">
                            {person.email}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => confirmDemoteAdmin(person)}
                        disabled={demotingAdmin === person.person_id}
                        className="px-2 sm:px-3 py-1 text-[10px] sm:text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md border border-red-200 transition disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                        title="Demote to instructor"
                      >
                        {demotingAdmin === person.person_id
                          ? "Demoting..."
                          : "Demote"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right-side demote confirmation */}
            {demoteConfirmDialog.show && (
              <div className="fixed top-20 right-4 z-[101] w-[92vw] max-w-sm rounded-xl border border-gray-200 bg-white shadow-2xl p-4">
                <p className="text-sm font-semibold text-gray-900">Demote Admin</p>
                <p className="mt-1 text-xs sm:text-sm text-gray-600">
                  Demote <span className="font-medium">{demoteConfirmDialog.personName}</span>?
                  They will keep instructor permissions but lose admin access.
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    onClick={() =>
                      setDemoteConfirmDialog({
                        show: false,
                        personId: null,
                        personName: "",
                      })
                    }
                    className="px-3 py-1.5 text-xs sm:text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDemoteAdmin}
                    className="px-3 py-1.5 text-xs sm:text-sm text-white bg-red-600 rounded-md hover:bg-red-700"
                  >
                    Demote
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Instructors Tab - kept mounted for instant tab switching */}
        <div className={activeTab === "instructors" ? "" : "hidden"}>
          <InstructorManager
            userEmail={userEmail}
            onRefresh={() => {
              fetchStats();
              fetchEntity("instructors");
            }}
          />
        </div>

        {/* Classes Tab - kept mounted for instant tab switching */}
        <div className={activeTab === "classes" ? "" : "hidden"}>
          <ClassManager
            userEmail={userEmail}
            onRefresh={() => {
              fetchStats();
              fetchEntity("classes");
            }}
          />
        </div>

        {/* Instructor Assignments Tab - kept mounted for instant tab switching */}
        <div className={activeTab === "assignments" ? "" : "hidden"}>
          <InstructorAssignmentManager
            userEmail={userEmail}
          />
        </div>

        {/* All other entity tabs use the generic EntityEditor component */}
        {activeTab !== "roster" &&
          activeTab !== "admins" &&
          activeTab !== "instructors" &&
          activeTab !== "classes" &&
          activeTab !== "assignments" && (
            <EntityEditor
              type={activeTab as EntityType}
              state={entities[activeTab as EntityType]}
              onAdd={() => handleAdd(activeTab as EntityType)}
              onUpdate={(id) => handleUpdate(activeTab as EntityType, id)}
              onDelete={(id) => requestDeleteEntity(activeTab as EntityType, id)}
              onStartEdit={(item) =>
                setEntities((prev) => ({
                  ...prev,
                  [activeTab]: {
                    ...prev[activeTab as EntityType],
                    editingId: item.id,
                    editingName:
                      ENTITY_CONFIG[activeTab as EntityType].displayName(item),
                  },
                }))
              }
              onCancelEdit={() =>
                setEntities((prev) => ({
                  ...prev,
                  [activeTab]: {
                    ...prev[activeTab as EntityType],
                    editingId: null,
                    editingName: "",
                  },
                }))
              }
              onNewNameChange={(value) =>
                setEntities((prev) => ({
                  ...prev,
                  [activeTab]: {
                    ...prev[activeTab as EntityType],
                    newName: value,
                  },
                }))
              }
              onEditNameChange={(value) =>
                setEntities((prev) => ({
                  ...prev,
                  [activeTab]: {
                    ...prev[activeTab as EntityType],
                    editingName: value,
                  },
                }))
              }
            />
          )}

        {/* Right-side toast notifications */}
        <div className="fixed top-4 right-4 z-[100] space-y-2 w-[92vw] max-w-sm pointer-events-none">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`pointer-events-auto rounded-lg border px-3 py-2 shadow-lg text-xs sm:text-sm ${toast.type === "success"
                ? "bg-green-50 border-green-200 text-green-800"
                : "bg-red-50 border-red-200 text-red-800"
                }`}
            >
              {toast.message}
            </div>
          ))}
        </div>

        {/* Right-side delete confirmation */}
        {entityDeleteDialog.show && (
          <div className="fixed top-20 right-4 z-[101] w-[92vw] max-w-sm rounded-xl border border-gray-200 bg-white shadow-2xl p-4">
            <p className="text-sm font-semibold text-gray-900">Confirm Delete</p>
            <p className="mt-1 text-xs sm:text-sm text-gray-600 break-words">
              Delete <span className="font-medium">{entityDeleteDialog.entityLabel}</span>?
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() =>
                  setEntityDeleteDialog({
                    show: false,
                    type: null,
                    entityId: null,
                    entityLabel: "",
                  })
                }
                className="px-3 py-1.5 text-xs sm:text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirmed}
                className="px-3 py-1.5 text-xs sm:text-sm text-white bg-red-600 rounded-md hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
