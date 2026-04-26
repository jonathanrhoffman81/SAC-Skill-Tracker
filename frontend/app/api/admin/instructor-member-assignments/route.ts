import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getRoleIdByName, resolveAdminRequestContext } from "@/lib/adminQueries";

async function validateInstructorInOrg(
  supabase: any,
  instructorPersonId: string,
  organizationId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: instructorOrg, error: instructorOrgError } = await supabase
    .from("person_organization")
    .select("person_organization_id")
    .eq("person_id", instructorPersonId)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();

  if (instructorOrgError) {
    return {
      ok: false,
      error: `Failed to validate instructor org membership: ${instructorOrgError.message}`,
    };
  }

  if (!instructorOrg) {
    return {
      ok: false,
      error: "Instructor is not active in this organization.",
    };
  }

  const instructorRoleId = await getRoleIdByName(supabase, "instructor");
  if (!instructorRoleId) {
    return { ok: false, error: "Instructor role not found." };
  }

  const { data: instructorRoleRow, error: instructorRoleError } = await supabase
    .from("person_org_role")
    .select("role_id")
    .eq("person_organization_id", instructorOrg.person_organization_id)
    .eq("role_id", instructorRoleId)
    .maybeSingle();

  if (instructorRoleError) {
    return {
      ok: false,
      error: `Failed to validate instructor role: ${instructorRoleError.message}`,
    };
  }

  if (!instructorRoleRow) {
    return {
      ok: false,
      error: "Person does not have instructor role in this organization.",
    };
  }

  return { ok: true };
}

async function validateGroupsInOrg(
  supabase: any,
  groupIds: string[],
  organizationId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (groupIds.length === 0) {
    return { ok: false, error: "At least one group_id is required." };
  }

  const { data: groupRows, error: groupError } = await supabase
    .from("class_group")
    .select("group_id, class_entity!inner(organization_id)")
    .in("group_id", groupIds)
    .eq("class_entity.organization_id", organizationId);

  if (groupError) {
    return {
      ok: false,
      error: `Failed to validate group org membership: ${groupError.message}`,
    };
  }

  const validGroupIds = new Set((groupRows || []).map((row: any) => row.group_id));
  const missingGroupIds = groupIds.filter((id) => !validGroupIds.has(id));

  if (missingGroupIds.length > 0) {
    return {
      ok: false,
      error: "One or more groups do not belong to this organization.",
    };
  }

  return { ok: true };
}

async function deleteGroupIfEmpty(
  supabase: any,
  groupId: string | null | undefined,
  organizationId: string,
): Promise<{ ok: boolean; deleted?: boolean; error?: string }> {
  if (!groupId) return { ok: true, deleted: false };

  const { data: groupRow, error: groupError } = await supabase
    .from("class_group")
    .select("group_id, class_entity!inner(organization_id)")
    .eq("group_id", groupId)
    .eq("class_entity.organization_id", organizationId)
    .maybeSingle();

  if (groupError) {
    return {
      ok: false,
      error: `Failed to validate group before cleanup: ${groupError.message}`,
    };
  }

  if (!groupRow) {
    return { ok: true, deleted: false };
  }

  const { count: memberCount, error: countError } = await supabase
    .from("enrollment")
    .select("member_id", { count: "exact", head: true })
    .eq("group_id", groupId);

  if (countError) {
    return {
      ok: false,
      error: `Failed to count group enrollments: ${countError.message}`,
    };
  }

  if ((memberCount ?? 0) > 0) {
    return { ok: true, deleted: false };
  }

  const { error: removeInstructorError } = await supabase
    .from("group_instructor")
    .delete()
    .eq("group_id", groupId);

  if (removeInstructorError) {
    return {
      ok: false,
      error: `Failed to remove group instructors during cleanup: ${removeInstructorError.message}`,
    };
  }

  const { error: deleteGroupError } = await supabase
    .from("class_group")
    .delete()
    .eq("group_id", groupId);

  if (deleteGroupError) {
    return {
      ok: false,
      error: `Failed to delete empty group: ${deleteGroupError.message}`,
    };
  }

  return { ok: true, deleted: true };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdminClient();
    const adminContext = await resolveAdminRequestContext(
      request,
      supabase,
      request.nextUrl.searchParams.get("email"),
    );
    const organizationId = adminContext.organizationId;

    const chunkSize = 200;

    // Best-effort instructor loading so member/assignment data still returns even if role metadata has issues.
    let instructors: any[] = [];
    const instructorRoleId = await getRoleIdByName(supabase, "instructor");
    if (instructorRoleId) {
      const { data: activePersonOrgs, error: activePersonOrgsError } =
        await supabase
          .from("person_organization")
          .select("person_organization_id, person_id")
          .eq("organization_id", organizationId)
          .eq("status", "active");

      if (!activePersonOrgsError) {
        const personOrgIds = (activePersonOrgs ?? []).map(
          (row: any) => row.person_organization_id,
        );
        const personIdByPersonOrgId = new Map(
          (activePersonOrgs ?? []).map((row: any) => [
            row.person_organization_id,
            row.person_id,
          ]),
        );

        if (personOrgIds.length > 0) {
          const allInstructorRoleRows: Array<{
            person_organization_id: string;
          }> = [];
          for (let i = 0; i < personOrgIds.length; i += chunkSize) {
            const personOrgIdChunk = personOrgIds.slice(i, i + chunkSize);
            const { data: instructorRoleRows, error: instructorRoleRowsError } =
              await supabase
                .from("person_org_role")
                .select("person_organization_id")
                .in("person_organization_id", personOrgIdChunk)
                .eq("role_id", instructorRoleId);

            if (instructorRoleRowsError) {
              console.warn(
                "Instructor role mapping failed:",
                instructorRoleRowsError.message,
              );
              continue;
            }

            allInstructorRoleRows.push(
              ...((instructorRoleRows || []) as Array<{
                person_organization_id: string;
              }>),
            );
          }

          const instructorPersonIds = Array.from(
            new Set(
              allInstructorRoleRows
                .map((row) =>
                  personIdByPersonOrgId.get(row.person_organization_id),
                )
                .filter((id: string | undefined): id is string => Boolean(id)),
            ),
          );

          if (instructorPersonIds.length > 0) {
            const allInstructors: any[] = [];
            for (let i = 0; i < instructorPersonIds.length; i += chunkSize) {
              const personIdChunk = instructorPersonIds.slice(i, i + chunkSize);
              const { data: instructorsData, error: instructorsError } =
                await supabase
                  .from("person")
                  .select("person_id, first_name, last_name, email")
                  .in("person_id", personIdChunk);

              if (instructorsError) {
                console.warn(
                  "Instructor lookup failed:",
                  instructorsError.message,
                );
                continue;
              }

              allInstructors.push(...(instructorsData || []));
            }

            instructors = allInstructors;
          }
        }
      } else {
        console.warn(
          "Active person organization lookup failed:",
          activePersonOrgsError.message,
        );
      }
    } else {
      console.warn(
        "Instructor role not found; returning members/assignments without instructor list.",
      );
    }

    const { data: classRows, error: classRowsError } = await supabase
      .from("class_entity")
      .select("class_id, name, start_date, end_date")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true });

    if (classRowsError) {
      return NextResponse.json(
        { error: `Failed to load classes: ${classRowsError.message}` },
        { status: 500 },
      );
    }

    const classInfoById = new Map(
      (classRows || []).map((row: any) => [
        row.class_id,
        {
          class_name: row.name || "Unnamed class",
          class_start_date: row.start_date ?? null,
          class_end_date: row.end_date ?? null,
        },
      ]),
    );
    const classIds = Array.from(classInfoById.keys());

    let groups: Array<{ group_id: string; class_id: string; name: string }> = [];
    if (classIds.length > 0) {
      for (let i = 0; i < classIds.length; i += chunkSize) {
        const classIdChunk = classIds.slice(i, i + chunkSize);
        const { data: groupChunk, error: groupError } = await supabase
          .from("class_group")
          .select("group_id, class_id, name")
          .in("class_id", classIdChunk)
          .order("name", { ascending: true });

        if (groupError) {
          return NextResponse.json(
            { error: `Failed to load class groups: ${groupError.message}` },
            { status: 500 },
          );
        }

        groups.push(...((groupChunk || []) as Array<{ group_id: string; class_id: string; name: string }>));
      }
    }

    const groupIds = groups.map((group) => group.group_id);
    const scopedAssignments: Array<{
      instructor_person_id: string;
      group_id: string;
    }> = [];
    if (groupIds.length > 0) {
      for (let i = 0; i < groupIds.length; i += chunkSize) {
        const groupIdChunk = groupIds.slice(i, i + chunkSize);
        const { data: assignmentsChunk, error: assignmentsError } = await supabase
          .from("group_instructor")
          .select("instructor_person_id, group_id")
          .in("group_id", groupIdChunk);

        if (assignmentsError) {
          console.warn(
            "Group instructor lookup failed:",
            assignmentsError.message,
          );
          continue;
        }

        scopedAssignments.push(
          ...((assignmentsChunk || []) as Array<{
            instructor_person_id: string;
            group_id: string;
          }>),
        );
      }
    }

    const normalizedGroups = groups.map((group) => {
      const classInfo = classInfoById.get(group.class_id);

      return {
        group_id: group.group_id,
        class_id: group.class_id,
        group_name: group.name || "Slot",
        class_name: classInfo?.class_name || "Unnamed class",
        class_start_date: classInfo?.class_start_date ?? null,
        class_end_date: classInfo?.class_end_date ?? null,
      };
    });

    const { data: enrollmentRows, error: enrollmentError } = await supabase
      .from("enrollment")
      .select(
        "member_id, class_id, group_id, slot, member:member_id(first_name, last_name, date_of_birth), class_entity:class_id(name, organization_id, start_date, end_date)",
      )
      .eq("class_entity.organization_id", organizationId);

    if (enrollmentError) {
      return NextResponse.json(
        { error: `Failed to load enrollments: ${enrollmentError.message}` },
        { status: 500 },
      );
    }

    const groupNameById = new Map(
      normalizedGroups.map((group) => [group.group_id, group.group_name]),
    );

    const enrollments = (enrollmentRows || [])
      .filter((row: any) => row.class_entity)
      .map((row: any) => ({
        member_id: row.member_id,
        class_id: row.class_id,
        group_id: row.group_id ?? null,
        group_name: row.group_id ? groupNameById.get(row.group_id) || null : null,
        class_name: row.class_entity?.name || "Unnamed class",
        class_start_date: row.class_entity?.start_date ?? null,
        class_end_date: row.class_entity?.end_date ?? null,
        member_first_name: row.member?.first_name ?? "",
        member_last_name: row.member?.last_name ?? "",
        date_of_birth: row.member?.date_of_birth ?? null,
        slot: row.slot ?? null,
      }));

    return NextResponse.json({
      groups: normalizedGroups,
      instructors,
      assignments: scopedAssignments,
      enrollments,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      class_id?: string;
      member_ids?: string[];
      group_name?: string;
    };

    if (!body.class_id) {
      return NextResponse.json({ error: "class_id is required" }, { status: 400 });
    }

    const memberIds = Array.from(
      new Set((body.member_ids ?? []).filter((value): value is string => Boolean(value))),
    );

    if (memberIds.length === 0) {
      return NextResponse.json({ error: "member_ids is required" }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();
    const adminContext = await resolveAdminRequestContext(request, supabase);
    const organizationId = adminContext.organizationId;

    const { data: classRow, error: classError } = await supabase
      .from("class_entity")
      .select("class_id, name")
      .eq("class_id", body.class_id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (classError || !classRow) {
      return NextResponse.json(
        { error: "Class is not in this organization." },
        { status: 400 },
      );
    }

    const { data: memberRows, error: memberError } = await supabase
      .from("member")
      .select("member_id")
      .in("member_id", memberIds)
      .eq("organization_id", organizationId);

    if (memberError) {
      return NextResponse.json(
        { error: `Failed to validate members: ${memberError.message}` },
        { status: 500 },
      );
    }

    const validMemberIds = new Set((memberRows || []).map((row: any) => row.member_id));
    const invalidMemberIds = memberIds.filter((memberId) => !validMemberIds.has(memberId));
    if (invalidMemberIds.length > 0) {
      return NextResponse.json(
        { error: "One or more swimmers are not in this organization." },
        { status: 400 },
      );
    }

    const { data: enrollmentRows, error: enrollmentError } = await supabase
      .from("enrollment")
      .select("member_id, group_id, slot")
      .eq("class_id", body.class_id)
      .in("member_id", memberIds);

    if (enrollmentError) {
      return NextResponse.json(
        { error: `Failed to validate enrollments: ${enrollmentError.message}` },
        { status: 500 },
      );
    }

    const enrolledMemberIds = new Set((enrollmentRows || []).map((row: any) => row.member_id));
    const missingEnrollmentIds = memberIds.filter((memberId) => !enrolledMemberIds.has(memberId));

    if (missingEnrollmentIds.length > 0) {
      return NextResponse.json(
        { error: "One or more swimmers are not enrolled in this class." },
        { status: 400 },
      );
    }

    const previousGroupIds = Array.from(
      new Set(
        (enrollmentRows || [])
          .map((row: any) => row.group_id)
          .filter((groupId: string | null | undefined): groupId is string => Boolean(groupId)),
      ),
    );

    const { data: existingGroups, error: existingGroupsError } = await supabase
      .from("class_group")
      .select("group_id, name")
      .eq("class_id", body.class_id);

    if (existingGroupsError) {
      return NextResponse.json(
        { error: `Failed to generate group name: ${existingGroupsError.message}` },
        { status: 500 },
      );
    }

    const selectedSlots = Array.from(
      new Set(
        (enrollmentRows || [])
          .map((row: any) => row.slot)
          .filter((slot: number | null | undefined): slot is number =>
            slot !== null && slot !== undefined,
          ),
      ),
    ).sort((a, b) => a - b);

    const slotDescriptor =
      selectedSlots.length === 1
        ? `Slot ${selectedSlots[0]}`
        : selectedSlots.length > 1
          ? "Mixed Slots"
          : "No Slot";

    const classDescriptor = (classRow.name || "Class").trim();
    const existingGroupNames = (existingGroups || [])
      .map((group: any) => (group.name || "").trim())
      .filter((name: string) => name.length > 0);
    const existingGroupNamesNormalized = new Set(
      existingGroupNames.map((name: string) => name.toLowerCase()),
    );
    const maxExistingGroupNumber = existingGroupNames.reduce((max: number, name: string) => {
      const match = name.match(/group\s+(\d+)/i);
      if (!match) return max;
      const parsed = Number(match[1]);
      return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
    }, 0);

    let nextGroupNumber =
      maxExistingGroupNumber > 0
        ? maxExistingGroupNumber + 1
        : (existingGroups?.length ?? 0) + 1;
    let fallbackGeneratedGroupName = `${classDescriptor} - ${slotDescriptor} - Group ${nextGroupNumber}`;
    while (existingGroupNamesNormalized.has(fallbackGeneratedGroupName.toLowerCase())) {
      nextGroupNumber += 1;
      fallbackGeneratedGroupName = `${classDescriptor} - ${slotDescriptor} - Group ${nextGroupNumber}`;
    }

    const generatedGroupName = body.group_name?.trim()
      ? body.group_name.trim()
      : fallbackGeneratedGroupName;

    const { data: createdGroup, error: createGroupError } = await supabase
      .from("class_group")
      .insert({
        class_id: body.class_id,
        name: generatedGroupName,
      })
      .select("group_id, class_id, name")
      .single();

    if (createGroupError || !createdGroup) {
      return NextResponse.json(
        { error: `Failed to create group: ${createGroupError?.message ?? "Unknown error"}` },
        { status: 500 },
      );
    }

    const { error: updateEnrollmentError } = await supabase
      .from("enrollment")
      .update({ group_id: createdGroup.group_id })
      .eq("class_id", body.class_id)
      .in("member_id", memberIds);

    if (updateEnrollmentError) {
      await supabase.from("class_group").delete().eq("group_id", createdGroup.group_id);
      return NextResponse.json(
        { error: `Failed to assign swimmers to new group: ${updateEnrollmentError.message}` },
        { status: 500 },
      );
    }

    for (const previousGroupId of previousGroupIds) {
      if (previousGroupId === createdGroup.group_id) continue;
      const cleanupResult = await deleteGroupIfEmpty(
        supabase,
        previousGroupId,
        organizationId,
      );
      if (!cleanupResult.ok) {
        console.warn(cleanupResult.error);
      }
    }

    return NextResponse.json({
      success: true,
      group: {
        group_id: createdGroup.group_id,
        class_id: createdGroup.class_id,
        group_name: createdGroup.name,
        class_name: classRow.name || "Unnamed class",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      member_id?: string;
      class_id?: string;
      group_id?: string;
      group_ids?: string[];
      instructor_person_id?: string | null;
    };

    if (body.member_id && body.class_id) {
      const supabase = getSupabaseAdminClient();
      const adminContext = await resolveAdminRequestContext(request, supabase);
      const organizationId = adminContext.organizationId;

      const { data: existingEnrollment, error: existingEnrollmentError } =
        await supabase
          .from("enrollment")
          .select("group_id")
          .eq("member_id", body.member_id)
          .eq("class_id", body.class_id)
          .maybeSingle();

      if (existingEnrollmentError) {
        return NextResponse.json(
          {
            error: `Failed to read current assignment: ${existingEnrollmentError.message}`,
          },
          { status: 500 },
        );
      }

      if (!existingEnrollment) {
        return NextResponse.json(
          { error: "Enrollment not found for this swimmer and class." },
          { status: 400 },
        );
      }

      const previousGroupId = existingEnrollment.group_id as string | null;

      const { data: memberRow, error: memberError } = await supabase
        .from("member")
        .select("member_id")
        .eq("member_id", body.member_id)
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (memberError || !memberRow) {
        return NextResponse.json(
          { error: "Member is not in this organization." },
          { status: 400 },
        );
      }

      const { data: classRow, error: classError } = await supabase
        .from("class_entity")
        .select("class_id")
        .eq("class_id", body.class_id)
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (classError || !classRow) {
        return NextResponse.json(
          { error: "Class is not in this organization." },
          { status: 400 },
        );
      }

      if (body.group_id) {
        const { data: groupRow, error: groupError } = await supabase
          .from("class_group")
          .select("group_id, class_id, class_entity!inner(organization_id)")
          .eq("group_id", body.group_id)
          .eq("class_id", body.class_id)
          .eq("class_entity.organization_id", organizationId)
          .maybeSingle();

        if (groupError || !groupRow) {
          return NextResponse.json(
            { error: "Group does not belong to this class." },
            { status: 400 },
          );
        }
      }

      const { error: updateError } = await supabase
        .from("enrollment")
        .update({ group_id: body.group_id ?? null })
        .eq("member_id", body.member_id)
        .eq("class_id", body.class_id);

      if (updateError) {
        return NextResponse.json(
          { error: `Failed to update group assignment: ${updateError.message}` },
          { status: 500 },
        );
      }

      if (previousGroupId && previousGroupId !== (body.group_id ?? null)) {
        const cleanupResult = await deleteGroupIfEmpty(
          supabase,
          previousGroupId,
          organizationId,
        );
        if (!cleanupResult.ok) {
          return NextResponse.json(
            { error: cleanupResult.error || "Failed to clean up empty group." },
            { status: 500 },
          );
        }
      }

      return NextResponse.json({ success: true });
    }

    const groupIds = Array.from(
      new Set(
        [body.group_id, ...(body.group_ids ?? [])].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    );

    if (groupIds.length === 0) {
      return NextResponse.json(
        { error: "At least one group_id is required" },
        { status: 400 },
      );
    }

    if (!body.instructor_person_id) {
      return NextResponse.json(
        { error: "instructor_person_id is required" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdminClient();
    const adminContext = await resolveAdminRequestContext(request, supabase);
    const organizationId = adminContext.organizationId;

    const groupValidation = await validateGroupsInOrg(
      supabase,
      groupIds,
      organizationId,
    );
    if (!groupValidation.ok) {
      return NextResponse.json({ error: groupValidation.error }, { status: 400 });
    }

    const instructorValidation = await validateInstructorInOrg(
      supabase,
      body.instructor_person_id,
      organizationId,
    );
    if (!instructorValidation.ok) {
      return NextResponse.json(
        { error: instructorValidation.error },
        { status: 400 },
      );
    }

    const rows = groupIds.map((groupId) => ({
      instructor_person_id: body.instructor_person_id as string,
      group_id: groupId,
    }));

    const { error: upsertError } = await supabase
      .from("group_instructor")
      .upsert(rows, {
        onConflict: "group_id,instructor_person_id",
        ignoreDuplicates: true,
      });

    if (upsertError) {
      return NextResponse.json(
        { error: `Failed to create assignment: ${upsertError.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      member_id?: string;
      class_id?: string;
      group_id?: string;
      group_ids?: string[];
      instructor_person_id?: string;
      delete_group?: boolean;
    };

    if (body.member_id && body.class_id) {
      const supabase = getSupabaseAdminClient();
      const adminContext = await resolveAdminRequestContext(request, supabase);
      const organizationId = adminContext.organizationId;

      const { data: existingEnrollment, error: existingEnrollmentError } =
        await supabase
          .from("enrollment")
          .select("group_id")
          .eq("member_id", body.member_id)
          .eq("class_id", body.class_id)
          .maybeSingle();

      if (existingEnrollmentError) {
        return NextResponse.json(
          {
            error: `Failed to read current assignment: ${existingEnrollmentError.message}`,
          },
          { status: 500 },
        );
      }

      if (!existingEnrollment) {
        return NextResponse.json(
          { error: "Enrollment not found for this swimmer and class." },
          { status: 400 },
        );
      }

      const previousGroupId = existingEnrollment.group_id as string | null;

      const { data: memberRow, error: memberError } = await supabase
        .from("member")
        .select("member_id")
        .eq("member_id", body.member_id)
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (memberError || !memberRow) {
        return NextResponse.json(
          { error: "Member is not in this organization." },
          { status: 400 },
        );
      }

      const { data: classRow, error: classError } = await supabase
        .from("class_entity")
        .select("class_id")
        .eq("class_id", body.class_id)
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (classError || !classRow) {
        return NextResponse.json(
          { error: "Class is not in this organization." },
          { status: 400 },
        );
      }

      const { error: updateError } = await supabase
        .from("enrollment")
        .update({ group_id: null })
        .eq("member_id", body.member_id)
        .eq("class_id", body.class_id);

      if (updateError) {
        return NextResponse.json(
          { error: `Failed to clear group assignment: ${updateError.message}` },
          { status: 500 },
        );
      }

      if (previousGroupId) {
        const cleanupResult = await deleteGroupIfEmpty(
          supabase,
          previousGroupId,
          organizationId,
        );
        if (!cleanupResult.ok) {
          return NextResponse.json(
            { error: cleanupResult.error || "Failed to clean up empty group." },
            { status: 500 },
          );
        }
      }

      return NextResponse.json({ success: true });
    }

    if (body.delete_group && body.group_id) {
      const supabase = getSupabaseAdminClient();
      const adminContext = await resolveAdminRequestContext(request, supabase);
      const organizationId = adminContext.organizationId;

      const { data: groupRow, error: groupError } = await supabase
        .from("class_group")
        .select("group_id, class_entity!inner(organization_id)")
        .eq("group_id", body.group_id)
        .eq("class_entity.organization_id", organizationId)
        .maybeSingle();

      if (groupError) {
        return NextResponse.json(
          { error: `Failed to validate group: ${groupError.message}` },
          { status: 500 },
        );
      }

      if (!groupRow) {
        return NextResponse.json(
          { error: "Group not found in this organization." },
          { status: 400 },
        );
      }

      const { error: clearEnrollmentsError } = await supabase
        .from("enrollment")
        .update({ group_id: null })
        .eq("group_id", body.group_id);

      if (clearEnrollmentsError) {
        return NextResponse.json(
          { error: `Failed to clear swimmer assignments: ${clearEnrollmentsError.message}` },
          { status: 500 },
        );
      }

      const { error: clearInstructorsError } = await supabase
        .from("group_instructor")
        .delete()
        .eq("group_id", body.group_id);

      if (clearInstructorsError) {
        return NextResponse.json(
          { error: `Failed to remove instructor assignments: ${clearInstructorsError.message}` },
          { status: 500 },
        );
      }

      const { error: deleteGroupError } = await supabase
        .from("class_group")
        .delete()
        .eq("group_id", body.group_id);

      if (deleteGroupError) {
        return NextResponse.json(
          { error: `Failed to delete group: ${deleteGroupError.message}` },
          { status: 500 },
        );
      }

      return NextResponse.json({ success: true });
    }

    const groupIds = Array.from(
      new Set(
        [body.group_id, ...(body.group_ids ?? [])].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    );

    if (!body.instructor_person_id || groupIds.length === 0) {
      return NextResponse.json(
        { error: "instructor_person_id and at least one group are required" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdminClient();
    const adminContext = await resolveAdminRequestContext(request, supabase);
    const organizationId = adminContext.organizationId;

    const instructorValidation = await validateInstructorInOrg(
      supabase,
      body.instructor_person_id,
      organizationId,
    );
    if (!instructorValidation.ok) {
      return NextResponse.json(
        { error: instructorValidation.error },
        { status: 400 },
      );
    }

    const groupValidation = await validateGroupsInOrg(
      supabase,
      groupIds,
      organizationId,
    );
    if (!groupValidation.ok) {
      return NextResponse.json({ error: groupValidation.error }, { status: 400 });
    }

    const { error: deleteError } = await supabase
      .from("group_instructor")
      .delete()
      .eq("instructor_person_id", body.instructor_person_id)
      .in("group_id", groupIds);

    if (deleteError) {
      return NextResponse.json(
        { error: `Failed to remove assignment: ${deleteError.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
