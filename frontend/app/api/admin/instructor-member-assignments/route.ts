import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabaseAdmin';
import { getRoleIdByName, resolveAdminRequestContext } from '@/lib/adminQueries';

async function validateInstructorInOrg(
  supabase: any,
  instructorPersonId: string,
  organizationId: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: instructorOrg, error: instructorOrgError } = await supabase
    .from('person_organization')
    .select('person_organization_id')
    .eq('person_id', instructorPersonId)
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .maybeSingle();

  if (instructorOrgError) {
    return { ok: false, error: `Failed to validate instructor org membership: ${instructorOrgError.message}` };
  }

  if (!instructorOrg) {
    return { ok: false, error: 'Instructor is not active in this organization.' };
  }

  const instructorRoleId = await getRoleIdByName(supabase, 'instructor');
  if (!instructorRoleId) {
    return { ok: false, error: 'Instructor role not found.' };
  }

  const { data: instructorRoleRow, error: instructorRoleError } = await supabase
    .from('person_org_role')
    .select('role_id')
    .eq('person_organization_id', instructorOrg.person_organization_id)
    .eq('role_id', instructorRoleId)
    .maybeSingle();

  if (instructorRoleError) {
    return { ok: false, error: `Failed to validate instructor role: ${instructorRoleError.message}` };
  }

  if (!instructorRoleRow) {
    return { ok: false, error: 'Person does not have instructor role in this organization.' };
  }

  return { ok: true };
}

async function validateMemberInOrg(
  supabase: any,
  memberId: string,
  organizationId: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: member, error: memberError } = await supabase
    .from('member')
    .select('member_id')
    .eq('member_id', memberId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (memberError) {
    return { ok: false, error: `Failed to validate member org membership: ${memberError.message}` };
  }

  return member ? { ok: true } : { ok: false, error: 'Member is not in this organization.' };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdminClient();
    const adminContext = await resolveAdminRequestContext(request, supabase, request.nextUrl.searchParams.get('email'));
    const organizationId = adminContext.organizationId;
    const sessionId = request.nextUrl.searchParams.get('session_id');

    const chunkSize = 200;

    // Best-effort instructor loading so member/assignment data still returns even if role metadata has issues.
    let instructors: any[] = [];
    const instructorRoleId = await getRoleIdByName(supabase, 'instructor');
    if (instructorRoleId) {
      const { data: activePersonOrgs, error: activePersonOrgsError } = await supabase
        .from('person_organization')
        .select('person_organization_id, person_id')
        .eq('organization_id', organizationId)
        .eq('status', 'active');

      if (!activePersonOrgsError) {
        const personOrgIds = (activePersonOrgs ?? []).map((row: any) => row.person_organization_id);
        const personIdByPersonOrgId = new Map(
          (activePersonOrgs ?? []).map((row: any) => [row.person_organization_id, row.person_id])
        );

        if (personOrgIds.length > 0) {
          const allInstructorRoleRows: Array<{ person_organization_id: string }> = [];
          for (let i = 0; i < personOrgIds.length; i += chunkSize) {
            const personOrgIdChunk = personOrgIds.slice(i, i + chunkSize);
            const { data: instructorRoleRows, error: instructorRoleRowsError } = await supabase
              .from('person_org_role')
              .select('person_organization_id')
              .in('person_organization_id', personOrgIdChunk)
              .eq('role_id', instructorRoleId);

            if (instructorRoleRowsError) {
              console.warn('Instructor role mapping failed:', instructorRoleRowsError.message);
              continue;
            }

            allInstructorRoleRows.push(...((instructorRoleRows || []) as Array<{ person_organization_id: string }>));
          }

          const instructorPersonIds = Array.from(
            new Set(
              allInstructorRoleRows
                .map((row) => personIdByPersonOrgId.get(row.person_organization_id))
                .filter((id: string | undefined): id is string => Boolean(id))
            )
          );

          if (instructorPersonIds.length > 0) {
            const allInstructors: any[] = [];
            for (let i = 0; i < instructorPersonIds.length; i += chunkSize) {
              const personIdChunk = instructorPersonIds.slice(i, i + chunkSize);
              const { data: instructorsData, error: instructorsError } = await supabase
                .from('person')
                .select('person_id, first_name, last_name, email')
                .in('person_id', personIdChunk);

              if (instructorsError) {
                console.warn('Instructor lookup failed:', instructorsError.message);
                continue;
              }

              allInstructors.push(...(instructorsData || []));
            }

            instructors = allInstructors;
          }
        }
      } else {
        console.warn('Active person organization lookup failed:', activePersonOrgsError.message);
      }
    } else {
      console.warn('Instructor role not found; returning members/assignments without instructor list.');
    }

    let rawMembers: Array<{ member_id: string; first_name?: string; last_name?: string; slot?: number | null; date_of_birth?: string | null }> = [];
    let classNameById = new Map<string, string>();
    let memberClassNames = new Map<string, string[]>();

    if (sessionId) {
      const { data: classRows, error: classRowsError } = await supabase
        .from('class_entity')
        .select('class_id, name')
        .eq('organization_id', organizationId)
        .eq('session_id', sessionId);

      if (classRowsError) {
        return NextResponse.json({ error: `Failed to load classes: ${classRowsError.message}` }, { status: 500 });
      }

      for (const row of classRows ?? []) {
        classNameById.set(row.class_id, row.name || 'Unnamed class');
      }

      const classIds = Array.from(classNameById.keys());
      if (classIds.length === 0) {
        return NextResponse.json({ members: [], instructors, assignments: [] });
      }

      const allEnrollments: Array<{ member_id: string; class_id: string }> = [];
      for (let i = 0; i < classIds.length; i += chunkSize) {
        const classIdChunk = classIds.slice(i, i + chunkSize);
        const { data: enrollmentChunk, error: enrollmentsError } = await supabase
          .from('enrollment')
          .select('member_id, class_id')
          .in('class_id', classIdChunk);

        if (enrollmentsError) {
          console.warn('Enrollment lookup for session classes failed:', enrollmentsError.message);
          continue;
        }

        allEnrollments.push(...((enrollmentChunk || []) as Array<{ member_id: string; class_id: string }>));
      }

      const memberIds = Array.from(
        new Set(
          allEnrollments
            .map((enrollment) => enrollment.member_id)
            .filter((id): id is string => Boolean(id))
        )
      );

      for (let i = 0; i < memberIds.length; i += chunkSize) {
        const memberIdChunk = memberIds.slice(i, i + chunkSize);
        const { data: memberChunk, error: membersError } = await supabase
          .from('member')
          .select('member_id, first_name, last_name, slot, date_of_birth')
          .in('member_id', memberIdChunk)
          .order('first_name', { ascending: true })
          .order('last_name', { ascending: true });

        if (membersError) {
          return NextResponse.json({ error: `Failed to load members: ${membersError.message}` }, { status: 500 });
        }

        rawMembers.push(...((memberChunk || []) as Array<{ member_id: string; first_name?: string; last_name?: string; slot?: number | null; date_of_birth?: string | null }>));
      }

      for (const enrollment of allEnrollments) {
        const className = classNameById.get(enrollment.class_id);
        if (!className) continue;
        const existing = memberClassNames.get(enrollment.member_id) || [];
        if (!existing.includes(className)) {
          existing.push(className);
          memberClassNames.set(enrollment.member_id, existing);
        }
      }
    } else {
      const { data: membersData, error: membersError } = await supabase
        .from('member')
        .select('member_id, first_name, last_name, slot, date_of_birth')
        .eq('organization_id', organizationId)
        .order('first_name', { ascending: true })
        .order('last_name', { ascending: true });

      if (membersError) {
        return NextResponse.json({ error: `Failed to load members: ${membersError.message}` }, { status: 500 });
      }

      rawMembers = membersData || [];

      // Load class tags for each member via enrollment -> class_entity.
      // Use chunked IN queries to avoid oversized Supabase requests.
      const memberIds = rawMembers.map((m: any) => m.member_id);
      if (memberIds.length > 0) {
        const allEnrollments: Array<{ member_id: string; class_id: string }> = [];

        for (let i = 0; i < memberIds.length; i += chunkSize) {
          const memberIdChunk = memberIds.slice(i, i + chunkSize);
          const { data: enrollmentChunk, error: enrollmentsError } = await supabase
            .from('enrollment')
            .select('member_id, class_id')
            .in('member_id', memberIdChunk);

          if (enrollmentsError) {
            console.warn('Enrollment lookup for class tags failed:', enrollmentsError.message);
            continue;
          }

          allEnrollments.push(...((enrollmentChunk || []) as Array<{ member_id: string; class_id: string }>));
        }

        const classIds = Array.from(
          new Set(
            allEnrollments
              .map((enrollment: any) => enrollment.class_id)
              .filter((id: string | null | undefined): id is string => Boolean(id))
          )
        );

        if (classIds.length > 0) {
          for (let i = 0; i < classIds.length; i += chunkSize) {
            const classIdChunk = classIds.slice(i, i + chunkSize);
            const { data: classRows, error: classRowsError } = await supabase
              .from('class_entity')
              .select('class_id, name')
              .in('class_id', classIdChunk)
              .eq('organization_id', organizationId);

            if (classRowsError) {
              console.warn('Class tag lookup failed:', classRowsError.message);
              continue;
            }

            for (const row of classRows ?? []) {
              classNameById.set(row.class_id, row.name || 'Unnamed class');
            }
          }
        }

        for (const enrollment of allEnrollments) {
          const className = classNameById.get(enrollment.class_id);
          if (!className) continue;
          const existing = memberClassNames.get(enrollment.member_id) || [];
          if (!existing.includes(className)) {
            existing.push(className);
            memberClassNames.set(enrollment.member_id, existing);
          }
        }
      }
    }

    const members = rawMembers ?? [];
    const memberIds = members.map((m: any) => m.member_id);
    const memberIdSet = new Set(memberIds);

    const scopedAssignments: Array<{ instructor_person_id: string; member_id: string }> = [];
    if (memberIds.length > 0) {
      for (let i = 0; i < memberIds.length; i += chunkSize) {
        const memberIdChunk = memberIds.slice(i, i + chunkSize);
        const assignmentsQuery = supabase
          .from('instructor_member_assignment')
          .select('instructor_person_id, member_id')
          .in('member_id', memberIdChunk);

        const { data: assignmentsChunk, error: assignmentsError } = await assignmentsQuery;
        if (assignmentsError) {
          console.warn('Assignments chunk lookup failed:', assignmentsError.message);
          continue;
        }

        scopedAssignments.push(...((assignmentsChunk || []) as Array<{ instructor_person_id: string; member_id: string }>));
      }
    }

    const uniqueAssignments = Array.from(
      new Map(
        scopedAssignments
          .filter((assignment) => memberIdSet.has(assignment.member_id))
          .map((assignment) => [`${assignment.member_id}:${assignment.instructor_person_id}`, assignment])
      ).values()
    );

    // Deduplicate likely duplicate roster entries by normalized full name.
    const dedupedMembers = Array.from(
      new Map(
        members.map((member: any) => {
          const normalizedName = `${member.first_name || ''} ${member.last_name || ''}`
            .trim()
            .toLowerCase();
          return [normalizedName, member];
        })
      ).values()
    ).map((member: any) => ({
      ...member,
      class_names: memberClassNames.get(member.member_id) || [],
    }));

    return NextResponse.json({
      members: dedupedMembers,
      instructors,
      assignments: uniqueAssignments,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      member_id?: string;
      member_ids?: string[];
      instructor_person_id?: string | null;
    };

    const memberIds = Array.from(
      new Set(
        [body.member_id, ...(body.member_ids ?? [])].filter(
          (value): value is string => Boolean(value)
        )
      )
    );

    if (memberIds.length === 0) {
      return NextResponse.json(
        { error: 'At least one member_id is required' },
        { status: 400 }
      );
    }

    if (!body.instructor_person_id) {
      return NextResponse.json(
        { error: 'instructor_person_id is required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdminClient();
    const adminContext = await resolveAdminRequestContext(request, supabase);
    const organizationId = adminContext.organizationId;

    for (const memberId of memberIds) {
      const memberValidation = await validateMemberInOrg(supabase, memberId, organizationId);
      if (!memberValidation.ok) {
        return NextResponse.json({ error: memberValidation.error }, { status: 400 });
      }
    }

    const instructorValidation = await validateInstructorInOrg(
      supabase,
      body.instructor_person_id,
      organizationId
    );
    if (!instructorValidation.ok) {
      return NextResponse.json({ error: instructorValidation.error }, { status: 400 });
    }

    const rows = memberIds.map((memberId) => ({
      instructor_person_id: body.instructor_person_id as string,
      member_id: memberId,
    }));

    const { error: upsertError } = await supabase
      .from('instructor_member_assignment')
      .upsert(rows, { onConflict: 'member_id,instructor_person_id', ignoreDuplicates: true });

    if (upsertError) {
      return NextResponse.json(
        { error: `Failed to create assignment: ${upsertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      member_id?: string;
      member_ids?: string[];
      instructor_person_id?: string;
    };

    const memberIds = Array.from(
      new Set(
        [body.member_id, ...(body.member_ids ?? [])].filter(
          (value): value is string => Boolean(value)
        )
      )
    );

    if (!body.instructor_person_id || memberIds.length === 0) {
      return NextResponse.json(
        { error: 'instructor_person_id and at least one member are required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdminClient();
    const adminContext = await resolveAdminRequestContext(request, supabase);
    const organizationId = adminContext.organizationId;

    const instructorValidation = await validateInstructorInOrg(
      supabase,
      body.instructor_person_id,
      organizationId
    );
    if (!instructorValidation.ok) {
      return NextResponse.json({ error: instructorValidation.error }, { status: 400 });
    }

    for (const memberId of memberIds) {
      const memberValidation = await validateMemberInOrg(supabase, memberId, organizationId);
      if (!memberValidation.ok) {
        return NextResponse.json({ error: memberValidation.error }, { status: 400 });
      }
    }

    const { error: deleteError } = await supabase
      .from('instructor_member_assignment')
      .delete()
      .eq('instructor_person_id', body.instructor_person_id)
      .in('member_id', memberIds);

    if (deleteError) {
      return NextResponse.json(
        { error: `Failed to remove assignment: ${deleteError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
