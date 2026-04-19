import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getCurrentPersonFromRequest } from "@/lib/serverAuth";
import { getRoleIdByName } from "@/lib/adminQueries";

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdminClient();
    const sessionPerson = await getCurrentPersonFromRequest(request);

    const instructorPersonId = sessionPerson.personId;

    // Get instructor's organization
    const { data: personOrgData, error: personOrgError } = await supabase
      .from("person_organization")
      .select("organization_id")
      .eq("person_id", instructorPersonId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (personOrgError || !personOrgData) {
      throw new Error("Failed to determine instructor's organization");
    }

    const organizationId = personOrgData.organization_id;
    const chunkSize = 200;

    // Load all instructors in this organization.
    // Keep the admin endpoint shape so the shared client filter code can consume
    // this route without branching.
    let instructors: Array<{
      person_id: string;
      first_name?: string | null;
      last_name?: string | null;
      email?: string;
    }> = [];
    const instructorRoleId = await getRoleIdByName(supabase, "instructor");
    if (instructorRoleId) {
      // Get ALL person_organizations for this org (not just active status)
      const { data: allPersonOrgs, error: allPersonOrgsError } =
        await supabase
          .from("person_organization")
          .select("person_organization_id, person_id")
          .eq("organization_id", organizationId);

      if (!allPersonOrgsError && allPersonOrgs) {
        const personOrgIds = allPersonOrgs.map(
          (row: any) => row.person_organization_id
        );
        const personIdByPersonOrgId = new Map(
          allPersonOrgs.map((row: any) => [
            row.person_organization_id,
            row.person_id,
          ])
        );

        if (personOrgIds.length > 0) {
          const allInstructorPersonIds: string[] = [];
          // Get all instructors in chunks
          for (let i = 0; i < personOrgIds.length; i += chunkSize) {
            const personOrgIdChunk = personOrgIds.slice(i, i + chunkSize);
            const { data: instructorRoleRows } = await supabase
              .from("person_org_role")
              .select("person_organization_id")
              .in("person_organization_id", personOrgIdChunk)
              .eq("role_id", instructorRoleId);

            if (instructorRoleRows) {
              instructorRoleRows.forEach((row: any) => {
                const personId = personIdByPersonOrgId.get(
                  row.person_organization_id
                );
                if (personId && !allInstructorPersonIds.includes(personId)) {
                  allInstructorPersonIds.push(personId);
                }
              });
            }
          }

          if (allInstructorPersonIds.length > 0) {
            for (let i = 0; i < allInstructorPersonIds.length; i += chunkSize) {
              const personIdChunk = allInstructorPersonIds.slice(
                i,
                i + chunkSize
              );
              const { data: instructorData } = await supabase
                .from("person")
                .select("person_id, first_name, last_name, email")
                .in("person_id", personIdChunk);

              if (instructorData) {
                instructorData.forEach((person: any) => {
                  instructors.push({
                    person_id: person.person_id,
                    first_name: person.first_name ?? null,
                    last_name: person.last_name ?? null,
                    email: person.email,
                  });
                });
              }
            }
          }
        }
      }
    }

    // Get groups taught by this instructor.
    // Schema path:
    // group_instructor.instructor_person_id -> group_instructor.group_id
    // -> class_group.group_id/class_id -> enrollment.group_id/member_id
    let classes: Array<{
      value: string;
      label: string;
      startDate?: string;
      endDate?: string;
    }> = [];
    let groups: Array<{
      group_id: string;
      class_id: string;
      class_name: string;
      group_name?: string;
    }> = [];
    let assignments: Array<{
      instructor_person_id: string;
      group_id: string;
    }> = [];
    let enrollments: Array<{
      member_id: string;
      class_id: string;
      group_id?: string | null;
      group_name?: string | null;
    }> = [];
    const classIds = new Set<string>();
    const groupNamesById = new Map<string, string>();

    const { data: groupInstructorRows, error: groupInstructorError } =
      await supabase
        .from("group_instructor")
        .select("group_id")
        .eq("instructor_person_id", instructorPersonId);

    if (!groupInstructorError && groupInstructorRows && groupInstructorRows.length > 0) {
      const groupIds = groupInstructorRows.map((row: any) => row.group_id);
      assignments = groupIds.map((groupId: string) => ({
        instructor_person_id: instructorPersonId,
        group_id: groupId,
      }));

      // Resolve each assigned group to its class.
      for (let i = 0; i < groupIds.length; i += chunkSize) {
        const groupIdChunk = groupIds.slice(i, i + chunkSize);
        const { data: groupClassRows } = await supabase
          .from("class_group")
          .select("group_id, name, class_id, class_entity:class_id(name, start_date, end_date)")
          .in("group_id", groupIdChunk);

        if (groupClassRows) {
          groupClassRows.forEach((row: any) => {
            const className = row.class_entity?.name || "Unnamed class";
            const groupName = row.name || "Unnamed group";

            if (row.group_id) {
              groupNamesById.set(row.group_id, groupName);
              groups.push({
                group_id: row.group_id,
                class_id: row.class_id,
                class_name: className,
                group_name: groupName,
              });
            }

            if (row.class_entity && !classIds.has(row.class_id)) {
              classIds.add(row.class_id);
              classes.push({
                value: row.class_id,
                label: className,
                startDate: row.class_entity.start_date || undefined,
                endDate: row.class_entity.end_date || undefined,
              });
            }
          });
        }
      }

      // Use enrollment.group_id, which matches the schema, so group filters map to
      // the exact swimmer set attached to each instructor-assigned group.
      for (let i = 0; i < groupIds.length; i += chunkSize) {
        const groupIdChunk = groupIds.slice(i, i + chunkSize);
        const { data: enrollmentRows } = await supabase
          .from("enrollment")
          .select("member_id, class_id, group_id")
          .in("group_id", groupIdChunk);

        if (enrollmentRows) {
          enrollmentRows.forEach((row: any) => {
            enrollments.push({
              member_id: row.member_id,
              class_id: row.class_id,
              group_id: row.group_id,
              group_name: row.group_id
                ? groupNamesById.get(row.group_id) || "Unnamed group"
                : null,
            });
          });
        }
      }
    }

    return NextResponse.json({
      groups,
      instructors,
      assignments,
      enrollments,
      classes,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    console.error("Instructor filters error:", message);
    return NextResponse.json(
      { error: message, groups: [], instructors: [], assignments: [], enrollments: [], classes: [] },
      { status: 200 }
    );
  }
}
