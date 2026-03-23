import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabaseAdmin';
import { getOrgIdByEmail, getRoleIdByName } from '@/lib/adminQueries';

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
    const email = request.nextUrl.searchParams.get('email');

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();
    const organizationId = await getOrgIdByEmail(supabase, email);

    if (!organizationId) {
      return NextResponse.json({ error: 'Failed to find organization for user' }, { status: 500 });
    }

    const { data: rawMembers, error: membersError } = await supabase
      .from('member')
      .select('member_id, first_name, last_name, level')
      .eq('organization_id', organizationId)
      .order('first_name', { ascending: true })
      .order('last_name', { ascending: true });

    if (membersError) {
      return NextResponse.json({ error: `Failed to load members: ${membersError.message}` }, { status: 500 });
    }

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

    const members = rawMembers ?? [];
    const memberIds = members.map((m: any) => m.member_id);
    const memberIdSet = new Set(memberIds);

    // Load class tags for each member via enrollment -> class_entity.
    // Use chunked IN queries to avoid oversized Supabase requests.
    const memberClassNames = new Map<string, string[]>();
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

      const classNameById = new Map<string, string>();
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
      email?: string;
      member_id?: string;
      instructor_person_id?: string | null;
    };

    if (!body.email || !body.member_id) {
      return NextResponse.json(
        { error: 'email and member_id are required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdminClient();
    const organizationId = await getOrgIdByEmail(supabase, body.email);

    if (!organizationId) {
      return NextResponse.json({ error: 'Failed to resolve requester context' }, { status: 500 });
    }

    const memberValidation = await validateMemberInOrg(supabase, body.member_id, organizationId);
    if (!memberValidation.ok) {
      return NextResponse.json({ error: memberValidation.error }, { status: 400 });
    }

    // Validate instructor BEFORE deleting to prevent orphaned unassignments
    if (body.instructor_person_id) {
      const instructorValidation = await validateInstructorInOrg(
        supabase,
        body.instructor_person_id,
        organizationId
      );
      if (!instructorValidation.ok) {
        return NextResponse.json({ error: instructorValidation.error }, { status: 400 });
      }
    }

    // Delete any existing assignment for this member
    const { error: deleteError } = await supabase
      .from('instructor_member_assignment')
      .delete()
      .eq('member_id', body.member_id);

    if (deleteError) {
      return NextResponse.json(
        { error: `Failed to update assignment: ${deleteError.message}` },
        { status: 500 }
      );
    }

    // If a new instructor is provided, create the assignment
    if (body.instructor_person_id) {

      const { error: insertError } = await supabase
        .from('instructor_member_assignment')
        .insert({
          instructor_person_id: body.instructor_person_id,
          member_id: body.member_id,
        });

      if (insertError) {
        return NextResponse.json(
          { error: `Failed to create assignment: ${insertError.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
