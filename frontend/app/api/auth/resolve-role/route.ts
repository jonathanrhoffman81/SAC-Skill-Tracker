import { NextRequest, NextResponse } from "next/server";
import { getCurrentPersonFromRequest } from "@/lib/serverAuth";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  normalizeEmail,
  pickHighestPriorityRole,
  getAllAppRoles,
  toAppRole,
} from "@/lib/authRoles";

type PersonOrgRow = {
  person_organization_id: string;
};

type RoleLinkRow = {
  role_id: string;
};

type RoleRow = {
  role_id: string;
  name: string;
};

async function resolveRoleFromEmail(email: string) {
  const supabase = getSupabaseAdminClient();

  const { data: person, error: personError } = await supabase
    .from("person")
    .select("person_id")
    .eq("email", email)
    .maybeSingle();

  if (personError) {
    return NextResponse.json(
      { error: "Failed to load person: " + personError.message },
      { status: 500 },
    );
  }

  if (!person?.person_id) {
    return NextResponse.json({ error: "No person found" }, { status: 404 });
  }

  const { data: personOrgs, error: personOrgError } = await supabase
    .from("person_organization")
    .select("person_organization_id")
    .eq("person_id", person.person_id)
    .eq("status", "active");

  if (personOrgError) {
    return NextResponse.json(
      {
        error: "Failed to load person organizations: " + personOrgError.message,
      },
      { status: 500 },
    );
  }

  const personOrgIds = ((personOrgs || []) as PersonOrgRow[]).map(
    (item) => item.person_organization_id,
  );
  if (personOrgIds.length === 0) {
    return NextResponse.json(
      { error: "No active organization memberships found" },
      { status: 404 },
    );
  }

  const { data: roleLinks, error: roleLinksError } = await supabase
    .from("person_org_role")
    .select("role_id")
    .in("person_organization_id", personOrgIds);

  if (roleLinksError) {
    return NextResponse.json(
      { error: "Failed to load role links: " + roleLinksError.message },
      { status: 500 },
    );
  }

  const roleIds = Array.from(
    new Set(
      ((roleLinks || []) as RoleLinkRow[])
        .map((item) => item.role_id)
        .filter(Boolean),
    ),
  );

  if (roleIds.length === 0) {
    return NextResponse.json({ error: "No roles found" }, { status: 404 });
  }

  const { data: roles, error: rolesError } = await supabase
    .from("role")
    .select("role_id, name")
    .in("role_id", roleIds);

  if (rolesError) {
    return NextResponse.json(
      { error: "Failed to load role names: " + rolesError.message },
      { status: 500 },
    );
  }

  const roleNames = ((roles || []) as RoleRow[]).map((item) => item.name);
  const selectedRoleName = pickHighestPriorityRole(roleNames);
  const appRole = selectedRoleName ? toAppRole(selectedRoleName) : null;

  if (!appRole) {
    return NextResponse.json(
      { error: "No supported roles found" },
      { status: 404 },
    );
  }

  // NEW: return all app-level roles alongside the highest-priority one
  const allAppRoles = getAllAppRoles(roleNames);

  return NextResponse.json({
    role: appRole, // highest-priority role (backwards compat)
    roles: allAppRoles, // NEW: all roles for multi-role detection
    dbRole: selectedRoleName,
    source: "database-email",
  });
}

export async function GET(request: NextRequest) {
  try {
    const sessionPerson = await getCurrentPersonFromRequest(request).catch(
      () => null,
    );

    if (sessionPerson) {
      if (!sessionPerson.appRole) {
        return NextResponse.json(
          { error: "No supported roles found" },
          { status: 404 },
        );
      }

      // NEW: if getCurrentPersonFromRequest exposes allAppRoles, use them.
      // Otherwise fall back to the single resolved role so nothing breaks.
      const allAppRoles: string[] = Array.isArray(sessionPerson.allAppRoles)
        ? sessionPerson.allAppRoles
        : sessionPerson.appRole
          ? [sessionPerson.appRole]
          : [];

      return NextResponse.json({
        role: sessionPerson.appRole, // highest-priority role (backwards compat)
        roles: allAppRoles, // NEW: all roles
        dbRole: sessionPerson.dbRole,
        source: "database-session",
      });
    }

    // NOTE: email fallback kept for legacy compatibility but flagged —
    // remove once all callers use authenticated session headers.
    const emailParam = request.nextUrl.searchParams.get("email");
    const email = normalizeEmail(String(emailParam || ""));
    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    return resolveRoleFromEmail(email);
  } catch (error: any) {
    console.error("Resolve role error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
