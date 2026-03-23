/**
 * Admin Instructors API Route
 * Purpose: CRUD operations for instructors in an organization
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  getOrgIdByEmail,
  getPersonIdsForRoleInOrg,
  getRoleIdByName,
} from "@/lib/adminQueries";

// GET: Fetch all instructors for an organization
export async function GET(request: NextRequest) {
  try {
    const email = request.nextUrl.searchParams.get("email");
    if (!email)
      return NextResponse.json({ error: "Email required" }, { status: 400 });

    const supabase = getSupabaseAdminClient();
    const orgId = await getOrgIdByEmail(supabase, email);
    const roleId = await getRoleIdByName(supabase, "instructor");

    if (!orgId || !roleId)
      return NextResponse.json(
        { error: "Failed to find organization or role" },
        { status: 500 },
      );
    const instructorPersonIds = await getPersonIdsForRoleInOrg(
      supabase,
      orgId,
      roleId,
    );

    if (instructorPersonIds.length === 0)
      return NextResponse.json({ instructors: [] });

    const { data: instructors, error: instructorsError } = await supabase
      .from("person")
      .select("person_id, first_name, last_name, email, created_at")
      .in("person_id", instructorPersonIds)
      .order("first_name, last_name");

    if (instructorsError)
      throw new Error("instructors error: " + instructorsError.message);

    // Fetch class assignments, but only for classes that belong to this organization
    const { data: classLinks, error: classLinksError } = await supabase
      .from("class_instructor")
      .select("person_id, class_id, class_entity!inner(organization_id)")
      .in("person_id", instructorPersonIds)
      .eq("class_entity.organization_id", orgId);

    if (classLinksError)
      throw new Error("class links error: " + classLinksError.message);

    const classIdsByPersonId = new Map<string, string[]>();
    for (const row of classLinks || []) {
      const existing = classIdsByPersonId.get(row.person_id) || [];
      existing.push(row.class_id);
      classIdsByPersonId.set(row.person_id, existing);
    }

    const normalized = (instructors || []).map((inst: any) => ({
      ...inst,
      first_name: inst.first_name || "",
      last_name: inst.last_name || "",
      class_ids: classIdsByPersonId.get(inst.person_id) || [],
    }));

    return NextResponse.json({ instructors: normalized });
  } catch (error) {
    console.error("Instructors GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST: Create new instructor or grant instructor role to existing person
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const adminEmail = body.admin_email || body.email;
    const mode = body.mode;
    const person_id = body.person_id;
    const first_name = body.first_name;
    const last_name = body.last_name;
    const newEmail = body.new_email || body.email;
    const member_id = body.member_id;
    const class_ids = body.class_ids;

    if (!adminEmail) {
      return NextResponse.json(
        { error: "Admin email required" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdminClient();
    const orgId = await getOrgIdByEmail(supabase, adminEmail);

    if (!orgId) {
      console.error("Failed to find organization for admin email:", adminEmail);
      return NextResponse.json(
        {
          error: `Failed to find organization for admin email: ${adminEmail}. Make sure this email exists in the person table and has an active organization.`,
        },
        { status: 500 },
      );
    }

    const roleId = await getRoleIdByName(supabase, "instructor");

    if (!roleId) {
      console.error("Failed to find instructor role in database");
      return NextResponse.json(
        {
          error:
            "Failed to find instructor role. Database may not be properly seeded. Run the schema.sql file to initialize roles.",
        },
        { status: 500 },
      );
    }

    let targetPersonId: string;

    if (mode === "existing") {
      // Grant instructor role to existing person
      if (!person_id) {
        return NextResponse.json(
          { error: "person_id required for existing mode" },
          { status: 400 },
        );
      }

      // Verify person exists and belongs to org
      const { data: personOrg } = await supabase
        .from("person_organization")
        .select("person_organization_id")
        .eq("person_id", person_id)
        .eq("organization_id", orgId)
        .eq("status", "active")
        .single();

      if (!personOrg) {
        return NextResponse.json(
          { error: "Person not found in organization" },
          { status: 404 },
        );
      }

      // Check if already has instructor role
      const { data: existingRole } = await supabase
        .from("person_org_role")
        .select("person_org_role_id")
        .eq("person_organization_id", personOrg.person_organization_id)
        .eq("role_id", roleId)
        .single();

      if (!existingRole) {
        // Grant instructor role
        await supabase.from("person_org_role").insert({
          person_organization_id: personOrg.person_organization_id,
          role_id: roleId,
        });
      }

      targetPersonId = person_id;
    } else {
      // Create new instructor
      if (!first_name || !last_name || !newEmail) {
        return NextResponse.json(
          { error: "first_name, last_name, and email required for new mode" },
          { status: 400 },
        );
      }

      // Create person record
      const { data: newPerson, error: personError } = await supabase
        .from("person")
        .insert({ first_name, last_name, email: newEmail })
        .select("person_id")
        .single();

      if (personError) {
        return NextResponse.json(
          { error: "Failed to create person: " + personError.message },
          { status: 500 },
        );
      }

      // Create person_organization record
      const { data: newPersonOrg, error: personOrgError } = await supabase
        .from("person_organization")
        .insert({
          person_id: newPerson.person_id,
          organization_id: orgId,
          status: "active",
        })
        .select("person_organization_id")
        .single();

      if (personOrgError) {
        return NextResponse.json(
          {
            error:
              "Failed to link person to organization: " +
              personOrgError.message,
          },
          { status: 500 },
        );
      }

      // Grant instructor role
      const { error: roleError } = await supabase
        .from("person_org_role")
        .insert({
          person_organization_id: newPersonOrg.person_organization_id,
          role_id: roleId,
        });

      if (roleError) {
        return NextResponse.json(
          { error: "Failed to grant instructor role: " + roleError.message },
          { status: 500 },
        );
      }

      // If this was created from a member selection, link the new person account to that member.
      if (member_id) {
        const { error: linkError } = await supabase
          .from("person_member")
          .insert({
            person_id: newPerson.person_id,
            member_id,
          });

        if (linkError) {
          return NextResponse.json(
            {
              error:
                "Failed to link member to person account: " + linkError.message,
            },
            { status: 500 },
          );
        }
      }

      targetPersonId = newPerson.person_id;
    }

    // Assign classes if provided
    if (class_ids && class_ids.length > 0) {
      const classAssignments = class_ids.map((class_id: string) => ({
        person_id: targetPersonId,
        class_id,
      }));

      const { error: classError } = await supabase
        .from("class_instructor")
        .insert(classAssignments);

      if (classError) {
        console.error("Failed to assign classes:", classError);
        // Don't fail the whole request, just log it
      }
    }

    // Fetch and return the created/updated instructor
    const { data: instructor } = await supabase
      .from("person")
      .select("person_id, first_name, last_name, email, created_at")
      .eq("person_id", targetPersonId)
      .single();

    return NextResponse.json({ instructor });
  } catch (error) {
    console.error("Instructors POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// PUT: Update an existing instructor
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const adminEmail = body.admin_email || body.email;
    const person_id = body.person_id;
    const name = body.name;
    const newEmail = body.new_email;
    if (!adminEmail || !person_id || !name) {
      return NextResponse.json(
        { error: "Admin email, person_id, and name required" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdminClient();
    const orgId = await getOrgIdByEmail(supabase, adminEmail);
    if (!orgId)
      return NextResponse.json(
        { error: "Failed to find organization" },
        { status: 500 },
      );

    // Verify instructor belongs to this org
    const { data: personOrg } = await supabase
      .from("person_organization")
      .select("person_organization_id")
      .eq("person_id", person_id)
      .eq("organization_id", orgId)
      .eq("status", "active")
      .single();

    if (!personOrg)
      return NextResponse.json(
        { error: "Instructor not found in this organization" },
        { status: 404 },
      );

    // Update person - split name into first and last
    const nameParts = name.trim().split(/\s+/).filter(Boolean);
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ") || "";

    const updateData: any = { first_name: firstName, last_name: lastName };
    if (newEmail) updateData.email = newEmail;

    const { data: instructor } = await supabase
      .from("person")
      .update(updateData)
      .eq("person_id", person_id)
      .select()
      .single();

    return NextResponse.json({ instructor });
  } catch (error) {
    console.error("Instructors PUT error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// PATCH: Update class assignments for an existing instructor
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const adminEmail = body.admin_email || body.email;
    const person_id = body.person_id;
    const class_ids = Array.isArray(body.class_ids) ? body.class_ids : [];

    if (!adminEmail || !person_id) {
      return NextResponse.json(
        { error: "Admin email and person_id required" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdminClient();
    const orgId = await getOrgIdByEmail(supabase, adminEmail);
    if (!orgId)
      return NextResponse.json(
        { error: "Failed to find organization" },
        { status: 500 },
      );

    const { data: personOrg } = await supabase
      .from("person_organization")
      .select("person_organization_id")
      .eq("person_id", person_id)
      .eq("organization_id", orgId)
      .eq("status", "active")
      .single();

    if (!personOrg) {
      return NextResponse.json(
        { error: "Instructor not found in this organization" },
        { status: 404 },
      );
    }

    if (class_ids.length > 0) {
      const { data: validClasses, error: validClassesError } = await supabase
        .from("class_entity")
        .select("class_id")
        .eq("organization_id", orgId)
        .in("class_id", class_ids);

      if (validClassesError) {
        return NextResponse.json(
          { error: "Failed validating classes: " + validClassesError.message },
          { status: 500 },
        );
      }

      const validIds = new Set(
        (validClasses || []).map((c: any) => c.class_id),
      );
      const invalidIds = class_ids.filter((id: string) => !validIds.has(id));

      if (invalidIds.length > 0) {
        return NextResponse.json(
          { error: "One or more classes do not belong to this organization" },
          { status: 400 },
        );
      }
    }

    const { error: deleteError } = await supabase
      .from("class_instructor")
      .delete()
      .eq("person_id", person_id);

    if (deleteError) {
      return NextResponse.json(
        { error: "Failed to clear class assignments: " + deleteError.message },
        { status: 500 },
      );
    }

    if (class_ids.length > 0) {
      const rows = class_ids.map((class_id: string) => ({
        person_id,
        class_id,
      }));
      const { error: insertError } = await supabase
        .from("class_instructor")
        .insert(rows);

      if (insertError) {
        return NextResponse.json(
          {
            error: "Failed to update class assignments: " + insertError.message,
          },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Instructors PATCH error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE: Delete an instructor
export async function DELETE(request: NextRequest) {
  try {
    const adminEmail = request.nextUrl.searchParams.get("email");
    const person_id = request.nextUrl.searchParams.get("person_id");
    if (!adminEmail || !person_id) {
      return NextResponse.json(
        { error: "Admin email and person_id required" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdminClient();
    const orgId = await getOrgIdByEmail(supabase, adminEmail);
    const roleId = await getRoleIdByName(supabase, "instructor");

    if (!orgId || !roleId)
      return NextResponse.json(
        { error: "Failed to find organization or role" },
        { status: 500 },
      );

    // Get person_organization record
    const { data: personOrg } = await supabase
      .from("person_organization")
      .select("person_organization_id")
      .eq("person_id", person_id)
      .eq("organization_id", orgId)
      .eq("status", "active")
      .single();

    if (!personOrg)
      return NextResponse.json(
        { error: "Instructor not found" },
        { status: 404 },
      );

    // Remove only the instructor role.
    const { error: removeRoleError } = await supabase
      .from("person_org_role")
      .delete()
      .eq("person_organization_id", personOrg.person_organization_id)
      .eq("role_id", roleId);

    if (removeRoleError) {
      return NextResponse.json(
        {
          error: "Failed to remove instructor role: " + removeRoleError.message,
        },
        { status: 500 },
      );
    }

    // Keep org membership active when other org-scoped roles still exist.
    const { data: remainingRoles, error: remainingRolesError } = await supabase
      .from("person_org_role")
      .select("role_id")
      .eq("person_organization_id", personOrg.person_organization_id);

    if (remainingRolesError) {
      return NextResponse.json(
        {
          error:
            "Failed to verify remaining roles: " + remainingRolesError.message,
        },
        { status: 500 },
      );
    }

    if (!remainingRoles || remainingRoles.length === 0) {
      const { error: deactivateError } = await supabase
        .from("person_organization")
        .update({ status: "inactive" })
        .eq("person_organization_id", personOrg.person_organization_id);

      if (deactivateError) {
        return NextResponse.json(
          {
            error:
              "Failed to update membership status: " + deactivateError.message,
          },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Instructors DELETE error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
