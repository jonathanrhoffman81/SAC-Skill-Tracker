/**
 * Admin Dashboard API Route
 * Purpose: Fetch dashboard stats (members, instructors, classes, skills) for an organization
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  getActivePersonOrganizations,
  getOrgIdByEmail,
  getOrganizationById,
  getRoleIdByName,
  mapPersonIdsForPersonOrgRole,
} from "@/lib/adminQueries";

interface AdminDashboardStats {
  totalMembers: number;
  totalInstructors: number;
  activeClasses: number;
  skillLevels: number;
  organizationName: string;
  organizationId: string;
}

export async function GET(request: NextRequest) {
  console.log("called");
  try {
    const email = request.nextUrl.searchParams.get("email");

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();

    // Step 1: Resolve organization from requesting admin email
    const organizationId = await getOrgIdByEmail(supabase, email);
    if (!organizationId) {
      return NextResponse.json(
        { error: "Failed to find organization for user" },
        { status: 500 },
      );
    }

    // Step 2: Get organization details
    const organization = await getOrganizationById(supabase, organizationId);
    if (!organization) {
      return NextResponse.json(
        { error: "Failed to load organization" },
        { status: 500 },
      );
    }

    // Step 4: Get total members in this organization (deduplicated by name)
    const { data: membersData, error: membersError } = await supabase
      .from("member")
      .select("first_name, last_name")
      .eq("organization_id", organizationId);

    if (membersError) {
      return NextResponse.json(
        { error: "Failed to load members: " + membersError.message },
        { status: 500 },
      );
    }

    const totalMembers = (membersData || []).length;

    // Step 5: Get total instructors in this organization
    const instructorRoleId = await getRoleIdByName(supabase, "instructor");
    if (!instructorRoleId) {
      return NextResponse.json(
        { error: "Failed to find instructor role" },
        { status: 500 },
      );
    }

    const activePersonOrgs = await getActivePersonOrganizations(
      supabase,
      organizationId,
    );
    const personOrgIds = activePersonOrgs.map(
      (po) => po.person_organization_id,
    );

    let totalInstructors = 0;
    if (personOrgIds.length > 0) {
      const { data: instructorRoles, error: instructorRolesError } =
        await supabase
          .from("person_org_role")
          .select("person_organization_id")
          .in("person_organization_id", personOrgIds)
          .eq("role_id", instructorRoleId);

      if (instructorRolesError) {
        console.error("Instructor roles query error:", instructorRolesError);
      } else {
        totalInstructors = mapPersonIdsForPersonOrgRole(
          activePersonOrgs,
          (instructorRoles as Array<{
            person_organization_id: string;
          }> | null) ?? [],
        ).length;
      }
    }

    // Step 6: Get active classes in this organization
    const { count: classesCount, error: classesError } = await supabase
      .from("class_entity")
      .select("class_id", { count: "exact", head: true })
      .eq("organization_id", organizationId);

    if (classesError) {
      return NextResponse.json(
        { error: "Failed to load classes: " + classesError.message },
        { status: 500 },
      );
    }

    const activeClasses = classesCount || 0;

    // Step 7: Get skill levels in this organization
    const { data: skillsData, error: skillsError } = await supabase
      .from("skill")
      .select("name")
      .eq("organization_id", organizationId)
      .order("name");

    if (skillsError) {
      return NextResponse.json(
        { error: "Failed to load skills: " + skillsError.message },
        { status: 500 },
      );
    }

    const skillLevels = new Set((skillsData || []).map((s: any) => s.name))
      .size;

    const stats: AdminDashboardStats = {
      totalMembers,
      totalInstructors,
      activeClasses,
      skillLevels,
      organizationName: organization.name,
      organizationId: organization.organization_id,
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Admin dashboard error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
