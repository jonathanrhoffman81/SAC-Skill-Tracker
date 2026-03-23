/**
 * Admin Admins API Route
 * Purpose: list org admins, promote instructors to org_admin role, and demote admins
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  getActivePersonOrganizations,
  getOrgIdByEmail,
} from "@/lib/adminQueries";

// Role IDs from seed data in schema.sql
const ORG_ADMIN_ROLE_ID = 2;
const INSTRUCTOR_ROLE_ID = 3;

// GET: Return current org admins and instructor-only promote candidates.
export async function GET(request: NextRequest) {
  try {
    const email = request.nextUrl.searchParams.get("email");
    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();
    const orgId = await getOrgIdByEmail(supabase, email);
    if (!orgId) {
      return NextResponse.json(
        { error: "Failed to find organization" },
        { status: 500 },
      );
    }

    const personOrgs = await getActivePersonOrganizations(supabase, orgId);
    const personOrgIds = personOrgs.map((po: any) => po.person_organization_id);

    if (personOrgIds.length === 0) {
      return NextResponse.json({ admins: [], candidates: [] });
    }

    const { data: adminRoles, error: adminRolesError } = await supabase
      .from("person_org_role")
      .select("person_organization_id")
      .in("person_organization_id", personOrgIds)
      .eq("role_id", ORG_ADMIN_ROLE_ID);

    const { data: instructorRoles, error: instructorRolesError } =
      await supabase
        .from("person_org_role")
        .select("person_organization_id")
        .in("person_organization_id", personOrgIds)
        .eq("role_id", INSTRUCTOR_ROLE_ID);

    if (adminRolesError || instructorRolesError) {
      return NextResponse.json(
        {
          error:
            "Failed to load role mappings: " +
            (adminRolesError?.message || instructorRolesError?.message),
        },
        { status: 500 },
      );
    }

    const adminPersonOrgIds = new Set(
      (adminRoles || []).map((r: any) => r.person_organization_id),
    );
    const instructorPersonOrgIds = new Set(
      (instructorRoles || []).map((r: any) => r.person_organization_id),
    );
    const adminPersonIds = new Set(
      personOrgs
        .filter((po: any) => adminPersonOrgIds.has(po.person_organization_id))
        .map((po: any) => po.person_id),
    );
    const instructorPersonIds = new Set(
      personOrgs
        .filter((po: any) =>
          instructorPersonOrgIds.has(po.person_organization_id),
        )
        .map((po: any) => po.person_id),
    );

    const personIds = personOrgs.map((po: any) => po.person_id);
    const { data: people, error: peopleError } = await supabase
      .from("person")
      .select("person_id, first_name, last_name, email, created_at")
      .in("person_id", personIds);

    if (peopleError) {
      return NextResponse.json(
        { error: "Failed to load people: " + peopleError.message },
        { status: 500 },
      );
    }

    const sortedPeople = [...(people || [])].sort((a: any, b: any) => {
      const aName = `${a.first_name || ""} ${a.last_name || ""}`
        .trim()
        .toLowerCase();
      const bName = `${b.first_name || ""} ${b.last_name || ""}`
        .trim()
        .toLowerCase();
      return aName.localeCompare(bName);
    });

    const admins = sortedPeople.filter((person: any) =>
      adminPersonIds.has(person.person_id),
    );
    // Promotion candidates are instructors who are not already org admins.
    const candidates = sortedPeople.filter(
      (person: any) =>
        instructorPersonIds.has(person.person_id) &&
        !adminPersonIds.has(person.person_id),
    );

    return NextResponse.json({ admins, candidates });
  } catch (error) {
    console.error("Admins GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST: Promote an instructor in the organization to org_admin.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, person_id } = body;

    if (!email || !person_id) {
      return NextResponse.json(
        { error: "Email and person_id are required" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdminClient();
    const orgId = await getOrgIdByEmail(supabase, email);
    if (!orgId) {
      return NextResponse.json(
        { error: "Failed to find organization" },
        { status: 500 },
      );
    }

    const { data: targetPersonOrg, error: targetPersonOrgError } =
      await supabase
        .from("person_organization")
        .select("person_organization_id")
        .eq("person_id", person_id)
        .eq("organization_id", orgId)
        .eq("status", "active")
        .single();

    if (targetPersonOrgError || !targetPersonOrg) {
      return NextResponse.json(
        { error: "Person not found in organization" },
        { status: 404 },
      );
    }

    // Enforce workflow: only instructors can be promoted to org_admin.
    const { data: instructorRoleRecord, error: instructorRoleRecordError } =
      await supabase
        .from("person_org_role")
        .select("person_organization_id")
        .eq("person_organization_id", targetPersonOrg.person_organization_id)
        .eq("role_id", INSTRUCTOR_ROLE_ID)
        .maybeSingle();

    if (instructorRoleRecordError || !instructorRoleRecord) {
      return NextResponse.json(
        { error: "Only instructors can be promoted to admin." },
        { status: 400 },
      );
    }

    const { error: promoteError } = await supabase
      .from("person_org_role")
      .upsert(
        {
          person_organization_id: targetPersonOrg.person_organization_id,
          role_id: ORG_ADMIN_ROLE_ID,
        },
        { onConflict: "person_organization_id,role_id" },
      );

    if (promoteError) {
      return NextResponse.json(
        { error: "Failed to promote admin: " + promoteError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admins POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE: Demote an org_admin back to just an instructor (removes org_admin role).
export async function DELETE(request: NextRequest) {
  try {
    const email = request.nextUrl.searchParams.get("email");
    const person_id = request.nextUrl.searchParams.get("person_id");

    if (!email || !person_id) {
      return NextResponse.json(
        { error: "Email and person_id are required" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdminClient();
    const orgId = await getOrgIdByEmail(supabase, email);
    if (!orgId) {
      return NextResponse.json(
        { error: "Failed to find organization" },
        { status: 500 },
      );
    }

    const { data: targetPersonOrg, error: targetPersonOrgError } =
      await supabase
        .from("person_organization")
        .select("person_organization_id")
        .eq("person_id", person_id)
        .eq("organization_id", orgId)
        .eq("status", "active")
        .single();

    if (targetPersonOrgError || !targetPersonOrg) {
      return NextResponse.json(
        { error: "Person not found in organization" },
        { status: 404 },
      );
    }

    // Remove the org_admin role (keeps instructor role)
    const { error: demoteError } = await supabase
      .from("person_org_role")
      .delete()
      .eq("person_organization_id", targetPersonOrg.person_organization_id)
      .eq("role_id", ORG_ADMIN_ROLE_ID);

    if (demoteError) {
      return NextResponse.json(
        { error: "Failed to demote admin: " + demoteError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admins DELETE error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
