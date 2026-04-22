import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  normalizeEmail,
  pickHighestPriorityRole,
  toAppRole,
} from "@/lib/authRoles";

type PersonOrgRow = {
  person_organization_id: string;
};

type RoleLinkRow = {
  role_id: string;
};

type RoleRow = {
  name: string;
};

export async function GET(request: NextRequest) {
  try {
    const emailParam = request.nextUrl.searchParams.get("email");
    const email = normalizeEmail(String(emailParam || ""));

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();

    let hasAuthUser = false;
    const { data: authList, error: authListError } =
      await supabase.auth.admin.listUsers();

    if (!authListError && authList?.users) {
      hasAuthUser = authList.users.some(
        (u) => normalizeEmail(u.email ?? "") === email,
      );
    }

    const { data: person, error: personError } = await supabase
      .from("person")
      .select("person_id, first_name, last_name")
      .eq("email", email)
      .maybeSingle();

    if (personError) {
      return NextResponse.json(
        { error: "Failed to validate email: " + personError.message },
        { status: 500 },
      );
    }

    if (!person?.person_id) {
      return NextResponse.json(
        { existsInRoster: false, hasAuthUser },
        { status: 200 },
      );
    }

    const { data: personOrgs, error: personOrgError } = await supabase
      .from("person_organization")
      .select("person_organization_id")
      .eq("person_id", person.person_id)
      .eq("status", "active");

    if (personOrgError) {
      return NextResponse.json(
        {
          error:
            "Failed to validate organization membership: " +
            personOrgError.message,
        },
        { status: 500 },
      );
    }

    const personOrgIds = ((personOrgs || []) as PersonOrgRow[]).map(
      (item) => item.person_organization_id,
    );
    const hasActiveOrganization = personOrgIds.length > 0;

    let appRole: string | null = null;
    let dbRole: string | null = null;

    if (hasActiveOrganization) {
      const { data: roleLinks, error: roleLinksError } = await supabase
        .from("person_org_role")
        .select("role_id")
        .in("person_organization_id", personOrgIds);

      if (roleLinksError) {
        return NextResponse.json(
          { error: "Failed to resolve roles: " + roleLinksError.message },
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

      if (roleIds.length > 0) {
        const { data: roles, error: rolesError } = await supabase
          .from("role")
          .select("name")
          .in("role_id", roleIds);

        if (rolesError) {
          return NextResponse.json(
            { error: "Failed to load role names: " + rolesError.message },
            { status: 500 },
          );
        }

        const roleNames = ((roles || []) as RoleRow[]).map((item) => item.name);
        dbRole = pickHighestPriorityRole(roleNames);
        appRole = dbRole ? toAppRole(dbRole) : null;
      }
    }

    return NextResponse.json({
      existsInRoster: true,
      hasAuthUser,
      hasActiveOrganization,
      personId: person.person_id,
      firstName: person.first_name || null,
      lastName: person.last_name || null,
      role: appRole,
      dbRole,
    });
  } catch (error: any) {
    console.error("Check email error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
