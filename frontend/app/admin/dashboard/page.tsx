/**
 * Admin dashboard page
 * Purpose: manage swimmers, instructors, and import roster data.
 */

"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  createAuthenticatedHeaders,
  getAuthenticatedSessionIdentity,
  logoutAndRedirect,
} from "@/lib/clientAuth";

const TabSkeleton = ({ title }: { title: string }) => (
  <div className="w-full min-h-[60vh] rounded-lg border border-gray-200 bg-white p-4 sm:rounded-xl sm:p-6">
    <div className="mb-4 flex items-center gap-3">
      <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-blue-600" />
      <p className="text-sm font-medium text-gray-700">Loading {title}...</p>
    </div>
    <div className="space-y-3 animate-pulse">
      <div className="h-10 rounded-lg bg-gray-100" />
      <div className="h-24 rounded-lg bg-gray-100" />
      <div className="h-24 rounded-lg bg-gray-100" />
    </div>
  </div>
);

const loadClassManager = () => import("@/components/ClassManager");
const loadInstructorAssignmentManager = () => import("@/components/InstructorAssignmentManager");
const loadImportRoster = () => import("@/components/ImportRoster");
const loadImportClasses = () => import("@/components/ImportClasses");
const loadLogoManage = () => import("@/components/LogoManage");
const loadAccountsManager = () => import("@/components/AccountsManager");
const loadAdminInstructorEvaluations = () => import("@/components/AdminInstructorEvaluations");

const ClassManager = dynamic(loadClassManager, {
  loading: () => <TabSkeleton title="classes" />,
});
const InstructorAssignmentManager = dynamic(
  loadInstructorAssignmentManager,
  {
    loading: () => <TabSkeleton title="assignments" />,
  },
);
const ImportRoster = dynamic(loadImportRoster, {
  loading: () => <TabSkeleton title="roster" />,
});
const ImportClasses = dynamic(loadImportClasses, {
  loading: () => <TabSkeleton title="classes import" />,
});
const LogoManage = dynamic(loadLogoManage, {
  loading: () => <TabSkeleton title="settings" />,
});
const AccountsManager = dynamic(loadAccountsManager, {
  loading: () => <TabSkeleton title="accounts" />,
});
const AdminInstructorEvaluations = dynamic(
  loadAdminInstructorEvaluations,
  {
    loading: () => <TabSkeleton title="instructor info" />,
  },
);

const MemoAccountsManager = memo(AccountsManager);
const MemoClassManager = memo(ClassManager);
const MemoInstructorAssignmentManager = memo(InstructorAssignmentManager);
const MemoAdminInstructorEvaluations = memo(AdminInstructorEvaluations);
const MemoImportRoster = memo(ImportRoster);
const MemoImportClasses = memo(ImportClasses);
const MemoLogoManage = memo(LogoManage);

// Dashboard statistics from admin API
interface AdminStats {
  totalMembers: number;
  totalInstructors: number;
  activeClasses: number;
  skillLevels: number;
  organizationName: string;
  organizationId: string;
  organizationLogoUrl?: string | null;
}

// Generic entity with normalized id field for consistent handling
interface Entity {
  id: string; // Normalized from skill_id, person_id, class_id, etc.
  name: string;
  [key: string]: any;
}

// State for each entity type
interface EntityState {
  list: Entity[];
  loading: boolean;
  editingId: string | null; // ID of item currently being edited
  editingName: string; // Edited name value
  newName: string; // New item input value
}

type EntityType = "skills";
type Tab =
  | EntityType
  | "roster"
  | "accounts"
  | "evaluations"
  | "classes"
  | "assignments"
  | "settings";

const ALL_ADMIN_TABS: Tab[] = [
  "assignments",
  "skills",
  "accounts",
  "evaluations",
  "classes",
  "roster",
  "settings",
];

const ADMIN_STATS_CACHE_KEY = "admin-dashboard-stats-cache";
const ADMIN_STATS_CACHE_TTL_MS = 5 * 60 * 1000;
const ENTITY_CACHE_KEY_PREFIX = "admin-dashboard-entity-cache:";
const ENTITY_CACHE_TTL_MS = 5 * 60 * 1000;

interface AdminStatsCachePayload {
  savedAt: number;
  stats: AdminStats;
}

interface EntityCachePayload {
  savedAt: number;
  list: Entity[];
}

interface ToastMessage {
  id: number;
  message: string;
  type: "success" | "error";
}

// Configuration for each entity type.
const ENTITY_CONFIG: Record<
  EntityType,
  {
    singularLabel: string;
    pluralLabel: string;
    apiPath: string;
    dataKey: string;
    idField: string;
    displayName: (item: Entity) => string;
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
    id: "accounts",
    label: "Accounts",
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
          d="M17 20h5v-2a4 4 0 00-5.356-3.76M17 20H7m10 0v-2c0-.653-.126-1.277-.356-1.848M7 20H2v-2a4 4 0 015.356-3.76M7 20v-2c0-.653.126-1.277.356-1.848m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    ),
  },
  {
    id: "evaluations",
    label: "Instructor Info",
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
          d="M9 12h6m-6 4h6M9 8h6m3 11H6a2 2 0 01-2-2V7a2 2 0 012-2h8l6 6v6a2 2 0 01-2 2z"
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
    label: "Import CSV",
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
  {
    id: "settings",
    label: "Settings",
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
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
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
 * EntityEditor - Reusable CRUD UI for dashboard entities.
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

  return (
    <div className="bg-white rounded-lg sm:rounded-xl border border-gray-200 shadow-sm p-4 sm:p-6">
      <p className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">
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

      {/* Items List */}
      {state.loading ? (
        <div className="flex items-center justify-center py-6 sm:py-8">
          <div className="animate-spin rounded-full h-5 w-5 sm:h-6 sm:w-6 border-b-2 border-blue-600"></div>
        </div>
      ) : state.list.length === 0 ? (
        <p className="text-xs sm:text-sm text-gray-500 text-center py-3 sm:py-4">
          No {config.pluralLabel.toLowerCase()} yet. Add one above!
        </p>
      ) : (
        <div className="space-y-3">
          {state.list.map((item) => (
            <div
              key={item.id}
              className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50 group"
            >
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  const [userName, setUserName] = useState("Admin User");
  const [activeTab, setActiveTab] = useState<Tab>("assignments");
  const [visitedTabs] = useState<Set<Tab>>(
    new Set(ALL_ADMIN_TABS),
  );
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [importTab, setImportTab] = useState<"roster" | "classes">("roster");
  const [entityDeleteDialog, setEntityDeleteDialog] = useState<{
    show: boolean;
    type: EntityType | null;
    entityId: string | null;
    entityLabel: string;
  }>({ show: false, type: null, entityId: null, entityLabel: "" });

  const readCachedStats = useCallback((): AdminStats | null => {
    if (typeof window === "undefined") return null;

    try {
      const raw = window.sessionStorage.getItem(ADMIN_STATS_CACHE_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw) as AdminStatsCachePayload;
      if (!parsed?.savedAt || !parsed?.stats) return null;

      if (Date.now() - parsed.savedAt > ADMIN_STATS_CACHE_TTL_MS) {
        window.sessionStorage.removeItem(ADMIN_STATS_CACHE_KEY);
        return null;
      }

      return parsed.stats;
    } catch {
      window.sessionStorage.removeItem(ADMIN_STATS_CACHE_KEY);
      return null;
    }
  }, []);

  const writeCachedStats = useCallback((nextStats: AdminStats) => {
    if (typeof window === "undefined") return;

    try {
      const payload: AdminStatsCachePayload = {
        savedAt: Date.now(),
        stats: nextStats,
      };
      window.sessionStorage.setItem(ADMIN_STATS_CACHE_KEY, JSON.stringify(payload));
    } catch {
      window.sessionStorage.removeItem(ADMIN_STATS_CACHE_KEY);
    }
  }, []);

  const showToast = (message: string, type: "success" | "error" = "error") => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 3500);
  };

  const validTabIds = useMemo(
    () =>
      new Set<Tab>([
        "assignments",
        "skills",
        "accounts",
        "evaluations",
        "classes",
        "roster",
        "settings",
      ]),
    [],
  );

  const selectTab = (tab: Tab) => {
    setActiveTab(tab);

    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === tab) return;
    params.set("tab", tab);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const applyTabFromUrl = () => {
      const requestedTab = new URLSearchParams(window.location.search).get("tab");
      if (!requestedTab) return;
      if (!validTabIds.has(requestedTab as Tab)) return;

      setActiveTab((currentTab) =>
        currentTab === (requestedTab as Tab) ? currentTab : (requestedTab as Tab),
      );
    };

    applyTabFromUrl();
    window.addEventListener("popstate", applyTabFromUrl);
    return () => window.removeEventListener("popstate", applyTabFromUrl);
  }, [validTabIds]);

  useEffect(() => {
    const fetchLogo = async () => {
      if (!stats?.organizationId) {
        setLogoUrl(null);
        return;
      }

      try {
        const res = await fetch(
          `/api/public/get-logo?orgId=${encodeURIComponent(stats.organizationId)}`,
        );
        const data = await res.json();
        setLogoUrl(data?.publicUrl || null);
      } catch (err) {
        console.error("Error fetching logo:", err);
        setLogoUrl(null);
      }
    };

    fetchLogo();
  }, [stats?.organizationId]);

  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase();
  // Generic state object for dashboard entities
  const [entities, setEntities] = useState<Record<EntityType, EntityState>>({
    skills: {
      list: [],
      loading: false,
      editingId: null,
      editingName: "",
      newName: "",
    },
  });

  const readCachedEntity = useCallback((type: EntityType): Entity[] | null => {
    if (typeof window === "undefined") return null;

    try {
      const raw = window.sessionStorage.getItem(`${ENTITY_CACHE_KEY_PREFIX}${type}`);
      if (!raw) return null;

      const parsed = JSON.parse(raw) as EntityCachePayload;
      if (!parsed?.savedAt || !Array.isArray(parsed?.list)) return null;

      if (Date.now() - parsed.savedAt > ENTITY_CACHE_TTL_MS) {
        window.sessionStorage.removeItem(`${ENTITY_CACHE_KEY_PREFIX}${type}`);
        return null;
      }

      return parsed.list;
    } catch {
      window.sessionStorage.removeItem(`${ENTITY_CACHE_KEY_PREFIX}${type}`);
      return null;
    }
  }, []);

  const writeCachedEntity = useCallback((type: EntityType, list: Entity[]) => {
    if (typeof window === "undefined") return;

    try {
      const payload: EntityCachePayload = {
        savedAt: Date.now(),
        list,
      };
      window.sessionStorage.setItem(
        `${ENTITY_CACHE_KEY_PREFIX}${type}`,
        JSON.stringify(payload),
      );
    } catch {
      window.sessionStorage.removeItem(`${ENTITY_CACHE_KEY_PREFIX}${type}`);
    }
  }, []);

  // Fetch dashboard statistics
  const fetchStats = useCallback(async (options?: { force?: boolean }) => {
    if (!options?.force) {
      const cachedStats = readCachedStats();
      if (cachedStats) {
        setStats(cachedStats);
        setLoading(false);
        return;
      }
    }

    try {
      const headers = await createAuthenticatedHeaders();
      const response = await fetch(`/api/admin/dashboard`, { headers });
      if (!response.ok) throw new Error("Failed to load stats");
      const data = (await response.json()) as AdminStats;
      setStats(data);
      writeCachedStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [readCachedStats, writeCachedStats]);

  const refreshStats = useCallback(() => {
    void fetchStats({ force: true });
  }, [fetchStats]);

  // Load user info and dashboard statistics on mount
  useEffect(() => {
    (async () => {
      try {
        const identity = await getAuthenticatedSessionIdentity();
        setUserName(identity.displayName || "Admin User");
      } catch { }
      void fetchStats();
    })();
  }, [fetchStats]);

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

  // Fetch a specific entity type from API with loading state management
  const fetchEntity = async (type: EntityType, options?: { force?: boolean }) => {
    if (!options?.force) {
      const cachedList = readCachedEntity(type);
      if (cachedList) {
        setEntities((prev) => ({
          ...prev,
          [type]: { ...prev[type], list: cachedList, loading: false },
        }));
        return;
      }
    }

    setEntities((prev) => ({
      ...prev,
      [type]: { ...prev[type], loading: true },
    }));
    try {
      const config = ENTITY_CONFIG[type];
      const headers = await createAuthenticatedHeaders();
      const response = await fetch(`${config.apiPath}`, { headers });
      if (!response.ok) throw new Error(`Failed to load ${type}`);
      const data = await response.json();
      const listData = data[config.dataKey] || [];
      const listWithIds = listData.map((item: any) => ({
        ...item,
        id: item[config.idField],
      }));
      writeCachedEntity(type, listWithIds);
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

  useEffect(() => {
    if (activeTab !== "skills") return;
    if (entities.skills.loading) return;
    if (entities.skills.list.length > 0) return;
    fetchEntity("skills");
  }, [activeTab, entities.skills.loading, entities.skills.list.length]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;
    let timeoutId: number | null = null;
    let idleId: number | null = null;

    const preloaders = [
      loadInstructorAssignmentManager,
      loadAdminInstructorEvaluations,
      loadAccountsManager,
      loadClassManager,
      loadImportRoster,
      loadImportClasses,
      loadLogoManage,
    ];

    let index = 0;

    const runChunk = (deadline?: IdleDeadline) => {
      if (cancelled) return;

      while (index < preloaders.length && (!deadline || deadline.timeRemaining() > 8)) {
        void preloaders[index++]();
      }

      if (index >= preloaders.length || cancelled) return;

      if ("requestIdleCallback" in window) {
        idleId = window.requestIdleCallback(runChunk, { timeout: 1200 });
      } else {
        timeoutId = window.setTimeout(() => runChunk(), 120);
      }
    };

    timeoutId = window.setTimeout(() => {
      if ("requestIdleCallback" in window) {
        idleId = window.requestIdleCallback(runChunk, { timeout: 1200 });
      } else {
        runChunk();
      }
    }, 300);

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      if (idleId !== null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
    };
  }, []);

  // Create new entity. Uses entity-specific API path and field names from config.
  const handleAdd = async (type: EntityType) => {
    const state = entities[type];
    if (!state.newName.trim()) return;
    try {
      const config = ENTITY_CONFIG[type];
      const response = await fetch(config.apiPath, {
        method: "POST",
        headers: await createAuthenticatedHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ name: state.newName.trim() }),
      });
      if (!response.ok) throw new Error(`Failed to create ${type}`);
      setEntities((prev) => ({
        ...prev,
        [type]: { ...prev[type], newName: "" },
      }));
      await fetchEntity(type, { force: true });
    } catch (err) {
      console.error(`Error adding ${type}:`, err);
      showToast(`Failed to add ${ENTITY_CONFIG[type].singularLabel}`, "error");
    }
  };

  // Update entity by ID. Uses correct ID field (skill_id, person_id, etc.) from config.
  const handleUpdate = async (type: EntityType, id: string) => {
    const state = entities[type];
    if (!state.editingName.trim()) return;
    try {
      const config = ENTITY_CONFIG[type];
      const response = await fetch(config.apiPath, {
        method: "PUT",
        headers: await createAuthenticatedHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          [config.idField]: id,
          name: state.editingName.trim(),
        }),
      });
      if (!response.ok) throw new Error(`Failed to update ${type}`);
      setEntities((prev) => ({
        ...prev,
        [type]: { ...prev[type], editingId: null, editingName: "" },
      }));
      await fetchEntity(type, { force: true });
      showToast(`${ENTITY_CONFIG[type].singularLabel} updated`, "success");
    } catch (err) {
      console.error(`Error updating ${type}:`, err);
      showToast(
        `Failed to update ${ENTITY_CONFIG[type].singularLabel}`,
        "error",
      );
    }
  };

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(true);
  const handleLogout = async () => {
    await logoutAndRedirect("/login");
  };

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
  }, [isDesktop]);

  const sidebarVisible = isDesktop ? sidebarPinned : sidebarOpen;
  const closeSidebar = () => {
    setSidebarOpen(false);
    if (isDesktop) {
      setSidebarPinned(false);
    }
  };
  const toggleSidebar = () => {
    if (isDesktop) {
      setSidebarPinned((prev) => !prev);
      return;
    }
    setSidebarOpen((open) => !open);
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
    if (!type || !entityId) return;

    setEntityDeleteDialog({
      show: false,
      type: null,
      entityId: null,
      entityLabel: "",
    });

    try {
      const config = ENTITY_CONFIG[type];
      const headers = await createAuthenticatedHeaders();
      const response = await fetch(
        `${config.apiPath}?${config.idField}=${entityId}`,
        {
          method: "DELETE",
          headers,
        },
      );
      if (!response.ok) throw new Error(`Failed to delete ${type}`);
      await fetchEntity(type, { force: true });
      showToast(`${ENTITY_CONFIG[type].singularLabel} deleted`, "success");
    } catch (err) {
      console.error(`Error deleting ${type}:`, err);
      showToast(
        `Failed to delete ${ENTITY_CONFIG[type].singularLabel}`,
        "error",
      );
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {sidebarVisible && !isDesktop && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-gray-900/20 backdrop-blur-[1px]"
          onClick={closeSidebar}
          aria-label="Close menu overlay"
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-40 flex h-screen w-72 max-w-[88vw] flex-col border-r border-gray-200 bg-white px-4 py-6 shadow-2xl transition-transform duration-200 ${sidebarVisible ? "translate-x-0" : "-translate-x-full"
          }`}
        aria-hidden={!sidebarVisible}
      >
        <div className="mb-8 flex items-center justify-between px-1">
          <div>
            <p className="text-lg font-semibold text-gray-900">Menu</p>
            <p className="text-xs text-gray-500">Administrator tools</p>
          </div>
          <button
            onClick={closeSidebar}
            className="rounded-full p-2 text-gray-500 hover:bg-gray-100 focus:outline-none"
            aria-label="Close menu"
          >
            <svg
              className="h-5 w-5"
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
        </div>
        <div className="flex-1 flex flex-col gap-1 overflow-y-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                selectTab(tab.id);
                if (!isDesktop) {
                  setSidebarOpen(false);
                }
              }}
              className={`flex items-center gap-3 px-4 py-2 rounded-xl text-base font-medium transition-all duration-200 whitespace-nowrap text-left ${activeTab === tab.id
                ? "bg-gray-100 text-gray-900"
                : "text-gray-700 hover:bg-gray-50"
                }`}
            >
              <span className="[&>svg]:w-5 [&>svg]:h-5">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        <div className="mt-6 border-t border-gray-100 pt-4">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-red-600 transition hover:bg-red-50"
          >
            <svg
              className="h-5 w-5"
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
            <span>Log out</span>
          </button>
        </div>
      </aside>

      <div
        className={`flex min-h-screen flex-col ${sidebarVisible ? "lg:pl-72" : ""}`}
      >
        <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-3 py-3 sm:px-6 sm:py-4">
            <div className="flex items-center gap-2 sm:gap-3">
              {(!isDesktop || !sidebarVisible) && (
                <button
                  onClick={toggleSidebar}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 sm:h-9 sm:w-9"
                  title="Menu"
                  aria-label={
                    isDesktop
                      ? "Open menu"
                      : sidebarOpen
                        ? "Close menu"
                        : "Open menu"
                  }
                >
                  <svg
                    className="h-4 w-4 sm:h-5 sm:w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6h16M4 12h16M4 18h16"
                    />
                  </svg>
                </button>
              )}
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-800 text-[10px] font-semibold text-white sm:h-9 sm:w-9 sm:text-xs">
                {getInitials(userName)}
              </div>
              <div className="hidden text-left lg:block">
                <p className="text-sm font-medium text-gray-900">{userName}</p>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                  Administrator
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-100 sm:h-9 sm:w-9 sm:rounded-xl">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt="Organization Logo"
                    className="h-full w-full object-contain"
                    onError={() => setLogoUrl(null)}
                  />
                ) : (
                  <svg
                    className="h-4 w-4 text-gray-600 sm:h-5 sm:w-5"
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
                )}
              </div>
              <div className="min-w-0 text-right">
                <p className="truncate text-xs font-bold text-gray-900 sm:text-sm">
                  {stats?.organizationName || "SAC Skill Tracker"}
                </p>
                <p className="hidden text-[10px] text-gray-500 sm:block sm:text-xs">
                  Administrator Dashboard
                </p>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 w-full max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-8 space-y-4 sm:space-y-6">
          {loading && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4 flex items-center gap-2 sm:gap-3">
              <div className="animate-spin rounded-full h-4 w-4 sm:h-5 sm:w-5 border-b-2 border-blue-600 flex-shrink-0"></div>
              <p className="text-xs sm:text-sm text-blue-800">
                Loading dashboard statistics...
              </p>
            </div>
          )}

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

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 md:gap-4">
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

          {visitedTabs.has("roster") && (
            <div className={`w-full min-h-[60vh] ${activeTab === "roster" ? "" : "hidden"}`}>
              {/* Tabs */}
              <div className="flex border-b border-gray-200 mb-4">
                <button
                  onClick={() => setImportTab("roster")}
                  className={`px-4 py-2 text-sm font-medium ${importTab === "roster"
                    ? "border-b-2 border-blue-600 text-blue-600"
                    : "text-gray-500 hover:text-gray-700"
                    }`}
                >
                  Import Roster
                </button>

                <button
                  onClick={() => setImportTab("classes")}
                  className={`px-4 py-2 text-sm font-medium ${importTab === "classes"
                    ? "border-b-2 border-blue-600 text-blue-600"
                    : "text-gray-500 hover:text-gray-700"
                    }`}
                >
                  Import Classes
                </button>
              </div>

              {/* Content */}
              {importTab === "roster" && (
                <div className="bg-white rounded-lg sm:rounded-xl border border-gray-200 shadow-sm">
                  <div className="p-4 sm:p-6 border-b border-gray-100">
                    <h2 className="text-base sm:text-lg font-semibold text-gray-900">
                      Import from SportsEngine
                    </h2>
                  </div>

                  <MemoImportRoster
                    organizationId={stats?.organizationId}
                    onImportComplete={refreshStats}
                  />
                </div>
              )}

              {importTab === "classes" && (
                <div className="bg-white rounded-lg sm:rounded-xl border border-gray-200 shadow-sm">
                  <div className="p-4 sm:p-6 border-b border-gray-100">
                    <h2 className="text-base sm:text-lg font-semibold text-gray-900">
                      Import Classes
                    </h2>
                  </div>

                  <MemoImportClasses
                    organizationId={stats?.organizationId}
                    onImportComplete={refreshStats}
                  />
                </div>
              )}
            </div>
          )}

          {visitedTabs.has("settings") && stats?.organizationId && (
            <div className={`w-full min-h-[60vh] ${activeTab === "settings" ? "" : "hidden"}`}>
              <div className="bg-white rounded-lg sm:rounded-xl border border-gray-200 shadow-sm p-4 sm:p-6">
                <h2 className="mb-4 text-base font-semibold text-gray-900 sm:text-lg">
                  Organization Settings
                </h2>
                <MemoLogoManage organizationLogoUrl={stats.organizationLogoUrl} />
              </div>
            </div>
          )}

          {visitedTabs.has("accounts") && (
            <div className={`w-full min-h-[60vh] ${activeTab === "accounts" ? "" : "hidden"}`}>
            <MemoAccountsManager onRefresh={refreshStats} />
            </div>
          )}

          {visitedTabs.has("evaluations") && (
            <div className={`w-full min-h-[60vh] ${activeTab === "evaluations" ? "" : "hidden"}`}>
            <MemoAdminInstructorEvaluations />
            </div>
          )}

          {visitedTabs.has("classes") && (
            <div className={`w-full min-h-[60vh] ${activeTab === "classes" ? "" : "hidden"}`}>
            <MemoClassManager onRefresh={refreshStats} />
            </div>
          )}

          {visitedTabs.has("assignments") && (
            <div className={`w-full min-h-[60vh] ${activeTab === "assignments" ? "" : "hidden"}`}>
            <MemoInstructorAssignmentManager />
            </div>
          )}

          {visitedTabs.has("skills") && (
            <div className={`w-full min-h-[60vh] ${activeTab === "skills" ? "" : "hidden"}`}>
              <EntityEditor
                type="skills"
                state={entities.skills}
                onAdd={() => handleAdd("skills")}
                onUpdate={(id) => handleUpdate("skills", id)}
                onDelete={(id) => requestDeleteEntity("skills", id)}
                onStartEdit={(item) =>
                  setEntities((prev) => ({
                    ...prev,
                    skills: {
                      ...prev.skills,
                      editingId: item.id,
                      editingName: ENTITY_CONFIG.skills.displayName(item),
                    },
                  }))
                }
                onCancelEdit={() =>
                  setEntities((prev) => ({
                    ...prev,
                    skills: {
                      ...prev.skills,
                      editingId: null,
                      editingName: "",
                    },
                  }))
                }
                onNewNameChange={(value) =>
                  setEntities((prev) => ({
                    ...prev,
                    skills: {
                      ...prev.skills,
                      newName: value,
                    },
                  }))
                }
                onEditNameChange={(value) =>
                  setEntities((prev) => ({
                    ...prev,
                    skills: {
                      ...prev.skills,
                      editingName: value,
                    },
                  }))
                }
              />
            </div>
          )}

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

          {entityDeleteDialog.show && (
            <div className="fixed top-20 right-4 z-[101] w-[92vw] max-w-sm rounded-xl border border-gray-200 bg-white shadow-2xl p-4">
              <p className="text-sm font-semibold text-gray-900">
                Confirm Delete
              </p>
              <p className="mt-1 text-xs sm:text-sm text-gray-600 break-words">
                Delete{" "}
                <span className="font-medium">
                  {entityDeleteDialog.entityLabel}
                </span>
                ?
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
    </div>
  );
}
