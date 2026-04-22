import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import {
  pickHighestPriorityRole,
  getAllAppRoles,
  toAppRole,
} from "@/lib/authRoles";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

type AppRole =
  | "super-admin"
  | "admin"
  | "instructor"
  | "account"
  | string
  | null;

interface PersonRow {
  person_id: string;
  auth_user_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

interface PersonOrganizationRow {
  person_organization_id: string;
  organization_id: string;
  status: string;
}

interface PersonOrgRoleRow {
  person_organization_id: string;
  role_id: number;
}

interface PersonGlobalRoleRow {
  role_id: number;
}

interface RoleRow {
  role_id: number;
  name: string;
  scope: "global" | "organization";
}

export interface AuthenticatedOrganizationMembership {
  personOrganizationId: string;
  organizationId: string;
  status: string;
  roles: string[];
}

export interface AuthenticatedPersonContext {
  authUserId: string;
  personId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  globalRoles: string[];
  memberships: AuthenticatedOrganizationMembership[];
  roleNames: string[];
  dbRole: string | null;
  appRole: AppRole;
  // NEW: all unique app-level roles — drives the multi-role switcher
  allAppRoles: string[];
}

export class AuthContextError extends Error {
  status: number;
  code: string;

  constructor(message: string, options?: { status?: number; code?: string }) {
    super(message);
    this.name = "AuthContextError";
    this.status = options?.status ?? 401;
    this.code = options?.code ?? "auth_error";
  }
}

function getSupabaseServerAuthClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new AuthContextError(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      { status: 500, code: "missing_supabase_config" },
    );
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function getAccessTokenFromRequest(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization") || "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice(7).trim();
    if (token) return token;
  }
  return request.cookies.get("sb-access-token")?.value?.trim() || null;
}

export async function getAuthenticatedAuthUserId(
  request: NextRequest,
): Promise<string | null> {
  const accessToken = getAccessTokenFromRequest(request);
  if (!accessToken) return null;

  const supabaseAuth = getSupabaseServerAuthClient();
  const { data, error } = await supabaseAuth.auth.getUser(accessToken);

  if (error) {
    throw new AuthContextError(
      `Failed to resolve authenticated user: ${error.message}`,
      {
        status: 401,
        code: "invalid_access_token",
      },
    );
  }

  return data.user?.id ?? null;
}

export async function getCurrentPersonFromRequest(
  request: NextRequest,
): Promise<AuthenticatedPersonContext | null> {
  const authUserId = await getAuthenticatedAuthUserId(request);
  if (!authUserId) return null;

  const supabaseAdmin = getSupabaseAdminClient();

  const { data: person, error: personError } = await supabaseAdmin
    .from("person")
    .select("person_id, auth_user_id, email, first_name, last_name")
    .eq("auth_user_id", authUserId)
    .maybeSingle<PersonRow>();

  if (personError) {
    throw new AuthContextError(
      `Failed to load person for authenticated user: ${personError.message}`,
      { status: 500, code: "person_lookup_failed" },
    );
  }

  if (!person?.person_id) {
    throw new AuthContextError(
      "No person record is linked to this authenticated user.",
      { status: 404, code: "person_not_linked" },
    );
  }

  const [
    { data: personOrganizations, error: personOrganizationsError },
    { data: personGlobalRoles, error: personGlobalRolesError },
  ] = await Promise.all([
    supabaseAdmin
      .from("person_organization")
      .select("person_organization_id, organization_id, status")
      .eq("person_id", person.person_id),
    supabaseAdmin
      .from("person_global_role")
      .select("role_id")
      .eq("person_id", person.person_id),
  ]);

  if (personOrganizationsError) {
    throw new AuthContextError(
      `Failed to load person organizations: ${personOrganizationsError.message}`,
      { status: 500, code: "person_organizations_failed" },
    );
  }

  if (personGlobalRolesError) {
    throw new AuthContextError(
      `Failed to load global roles: ${personGlobalRolesError.message}`,
      { status: 500, code: "person_global_roles_failed" },
    );
  }

  const memberships = (personOrganizations ?? []) as PersonOrganizationRow[];
  const personOrganizationIds = memberships.map(
    (item) => item.person_organization_id,
  );

  const { data: personOrgRoles, error: personOrgRolesError } =
    personOrganizationIds.length
      ? await supabaseAdmin
          .from("person_org_role")
          .select("person_organization_id, role_id")
          .in("person_organization_id", personOrganizationIds)
      : { data: [], error: null };

  if (personOrgRolesError) {
    throw new AuthContextError(
      `Failed to load organization roles: ${personOrgRolesError.message}`,
      { status: 500, code: "person_org_roles_failed" },
    );
  }

  const allRoleIds = Array.from(
    new Set([
      ...((personOrgRoles ?? []) as PersonOrgRoleRow[]).map(
        (item) => item.role_id,
      ),
      ...((personGlobalRoles ?? []) as PersonGlobalRoleRow[]).map(
        (item) => item.role_id,
      ),
    ]),
  );

  const { data: roleRows, error: roleRowsError } = allRoleIds.length
    ? await supabaseAdmin
        .from("role")
        .select("role_id, name, scope")
        .in("role_id", allRoleIds)
    : { data: [], error: null };

  if (roleRowsError) {
    throw new AuthContextError(
      `Failed to load role names: ${roleRowsError.message}`,
      {
        status: 500,
        code: "role_lookup_failed",
      },
    );
  }

  const rolesById = new Map<number, RoleRow>(
    ((roleRows ?? []) as RoleRow[]).map((row) => [row.role_id, row]),
  );

  const rolesByPersonOrganizationId = new Map<string, string[]>();
  ((personOrgRoles ?? []) as PersonOrgRoleRow[]).forEach((item) => {
    const roleName = rolesById.get(item.role_id)?.name;
    if (!roleName) return;
    const current =
      rolesByPersonOrganizationId.get(item.person_organization_id) ?? [];
    current.push(roleName);
    rolesByPersonOrganizationId.set(item.person_organization_id, current);
  });

  const globalRoles = ((personGlobalRoles ?? []) as PersonGlobalRoleRow[])
    .map((item) => rolesById.get(item.role_id)?.name)
    .filter((value): value is string => Boolean(value));

  const organizationRoleNames = Array.from(
    rolesByPersonOrganizationId.values(),
  ).flat();
  const roleNames = Array.from(
    new Set([...globalRoles, ...organizationRoleNames]),
  );
  const dbRole = pickHighestPriorityRole(roleNames);

  // NEW: derive all app-level roles from the full roleNames list
  const allAppRoles = getAllAppRoles(roleNames);

  return {
    authUserId,
    personId: person.person_id,
    email: person.email,
    firstName: person.first_name,
    lastName: person.last_name,
    globalRoles,
    memberships: memberships.map((membership) => ({
      personOrganizationId: membership.person_organization_id,
      organizationId: membership.organization_id,
      status: membership.status,
      roles:
        rolesByPersonOrganizationId.get(membership.person_organization_id) ??
        [],
    })),
    roleNames,
    dbRole,
    appRole: dbRole ? toAppRole(dbRole) : null,
    allAppRoles, // NEW
  };
}

export async function requireCurrentPersonFromRequest(
  request: NextRequest,
): Promise<AuthenticatedPersonContext> {
  const context = await getCurrentPersonFromRequest(request);
  if (!context) {
    throw new AuthContextError(
      "No authenticated session was provided with this request.",
      { status: 401, code: "missing_session" },
    );
  }
  return context;
}
