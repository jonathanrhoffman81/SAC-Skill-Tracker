import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabaseAdmin';
import { getRoleIdByName, resolveAdminRequestContext } from '@/lib/adminQueries';

type SupabaseClient = ReturnType<typeof getSupabaseAdminClient>;

interface PersonOrganizationRow {
  person_organization_id: string;
  person_id: string;
}

interface MemberRow {
  member_id: string;
  first_name: string | null;
  last_name: string | null;
  level?: string | null;
}

interface InstructorRow {
  person_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

interface EnrollmentRow {
  member_id: string;
  class_id: string;
}

interface ClassRow {
  class_id: string;
  name: string | null;
}

interface AssignmentRow {
  instructor_person_id: string;
  member_id: string;
}

interface PersonOrgRoleRow {
  person_organization_id: string;
}

interface AssignmentRequestBody {
  email?: string;
  member_id?: string;
  member_ids?: string[];
  instructor_person_id?: string | null;
}

async function validateInstructorInOrg(
  supabase: SupabaseClient,
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
  supabase: SupabaseClient,
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
    let instructors: InstructorRow[] = [];
    const instructorRoleId = await getRoleIdByName(supabase, 'instructor');
    if (instructorRoleId) {
      const { data: activePersonOrgs, error: activePersonOrgsError } = await supabase
        .from('person_organization')
        .select('person_organization_id, person_id')
        .eq('organization_id', organizationId)
        .eq('status', 'active');

      if (!activePersonOrgsError) {
        const typedActivePersonOrgs = (activePersonOrgs ?? []) as PersonOrganizationRow[];
        const personOrgIds = typedActivePersonOrgs.map((row) => row.person_organization_id);
        const personIdByPersonOrgId = new Map<string, string>(
          typedActivePersonOrgs.map((row) => [row.person_organization_id, row.person_id])
        );

        if (personOrgIds.length > 0) {
          const allInstructorRoleRows: PersonOrgRoleRow[] = [];
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

            allInstructorRoleRows.push(
              ...((instructorRoleRows || []) as PersonOrgRoleRow[])
            );
          }

          const instructorPersonIds = Array.from(
            new Set(
              allInstructorRoleRows
                .map((row) => personIdByPersonOrgId.get(row.person_organization_id))
                .filter((id: string | undefined): id is string => Boolean(id))
            )
          );

          if (instructorPersonIds.length > 0) {
            const allInstructors: InstructorRow[] = [];
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

              allInstructors.push(...((instructorsData || []) as InstructorRow[]));
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

    const members = (rawMembers ?? []) as MemberRow[];
    const memberIds = members.map((member) => member.member_id);
    const memberIdSet = new Set<string>(memberIds);

    // Load class tags for each member via enrollment -> class_entity.
    // Use chunked IN queries to avoid oversized Supabase requests.
    const memberClassNames = new Map<string, string[]>();
    if (memberIds.length > 0) {
      const allEnrollments: EnrollmentRow[] = [];

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

        allEnrollments.push(...((enrollmentChunk || []) as EnrollmentRow[]));
      }

      const classIds = Array.from(
        new Set(
          allEnrollments
            .map((enrollment) => enrollment.class_id)
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

          for (const row of (classRows ?? []) as ClassRow[]) {
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

    const scopedAssignments: AssignmentRow[] = [];
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

        scopedAssignments.push(...((assignmentsChunk || []) as AssignmentRow[]));
      }
    }

    const uniqueAssignments = Array.from<AssignmentRow>(
      new Map<string, AssignmentRow>(
        scopedAssignments
          .filter((assignment) => memberIdSet.has(assignment.member_id))
          .map((assignment) => [
            `${assignment.member_id}:${assignment.instructor_person_id}`,
            assignment,
          ])
      ).values()
    );

    // Deduplicate likely duplicate roster entries by normalized full name.
    const dedupedMembers = Array.from(
      new Map<string, MemberRow>(
        members.map((member) => {
          const normalizedName = `${member.first_name || ''} ${member.last_name || ''}`
            .trim()
            .toLowerCase();
          return [normalizedName, member];
        })
      ).values()
    ).map((member) => ({
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
    const body = (await request.json()) as AssignmentRequestBody;

    const memberIds = Array.from(
      new Set(
        [body.member_id, ...(body.member_ids ?? [])].filter(
          (value): value is string => Boolean(value)
        )
      )
    );

    if (memberIds.length === 0 || !body.instructor_person_id) {
      return NextResponse.json(
        { error: 'instructor_person_id and at least one member are required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdminClient();
    const adminContext = await resolveAdminRequestContext(request, supabase, body.email);
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
    const body = (await request.json()) as AssignmentRequestBody;

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
    const adminContext = await resolveAdminRequestContext(request, supabase, body.email);
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
