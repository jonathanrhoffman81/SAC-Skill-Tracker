import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabaseAdmin';

interface DashboardClassPayload {
  id: string;
  name: string;
  schedule: string;
}

interface DashboardSkillPayload {
  id: string;
  name: string;
  progress: 0 | 25 | 50 | 75 | 100;
  mastered: boolean;
  dateAcquired?: string;
}

interface DashboardSwimmerPayload {
  id: string;
  name: string;
  level: string;
  classes: DashboardClassPayload[];
  skills: DashboardSkillPayload[];
}

interface DashboardPayload {
  userName: string;
  organizationName: string;
  swimmers: DashboardSwimmerPayload[];
}

interface RpcDashboardRow {
  userName?: string;
  organizationName?: string;
  swimmers?: DashboardSwimmerPayload[];
}

function formatDate(value?: string | null): string | undefined {
  if (!value) return undefined;
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function normalizeProgress(value: number | null | undefined): 0 | 25 | 50 | 75 | 100 {
  if (value === 25 || value === 50 || value === 75 || value === 100) {
    return value;
  }
  return 0;
}

function normalizeRpcPayload(data: RpcDashboardRow | RpcDashboardRow[] | null): DashboardPayload | null {
  if (!data) return null;

  const payload = Array.isArray(data) ? data[0] : data;
  if (!payload) return null;

  return {
    userName: payload.userName || '',
    organizationName: payload.organizationName || 'SAC Skill Tracker',
    swimmers: Array.isArray(payload.swimmers) ? payload.swimmers : [],
  };
}

async function buildDashboardFallback(email: string): Promise<DashboardPayload> {
  const supabaseAdmin = getSupabaseAdminClient();

  const { data: person, error: personError } = await supabaseAdmin
    .from('person')
    .select('person_id, first_name, last_name, email')
    .ilike('email', email)
    .maybeSingle();

  if (personError) {
    throw new Error(`Failed to load person: ${personError.message}`);
  }

  if (!person) {
    throw new Error(`No instructor found for email ${email}`);
  }

  const userName =
    `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() || person.email;

  const [{ data: personOrg, error: personOrgError }, { data: classAssignments, error: classAssignmentsError }, { data: directAssignments, error: directAssignmentsError }] =
    await Promise.all([
      supabaseAdmin
        .from('person_organization')
        .select('organization_id')
        .eq('person_id', person.person_id)
        .maybeSingle(),
      supabaseAdmin
        .from('class_instructor')
        .select('class_id')
        .eq('person_id', person.person_id),
      supabaseAdmin
        .from('instructor_member_assignment')
        .select('member_id')
        .eq('instructor_person_id', person.person_id),
    ]);

  if (personOrgError) {
    throw new Error(`Failed to load organization membership: ${personOrgError.message}`);
  }

  if (classAssignmentsError) {
    throw new Error(`Failed to load instructor classes: ${classAssignmentsError.message}`);
  }

  if (directAssignmentsError) {
    throw new Error(`Failed to load direct instructor assignments: ${directAssignmentsError.message}`);
  }

  const organizationId = personOrg?.organization_id;
  if (!organizationId) {
    return {
      userName,
      organizationName: 'SAC Skill Tracker',
      swimmers: [],
    };
  }

  const { data: organization, error: organizationError } = await supabaseAdmin
    .from('organization')
    .select('name')
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (organizationError) {
    throw new Error(`Failed to load organization: ${organizationError.message}`);
  }

  const classIds = Array.from(
    new Set((classAssignments ?? []).map((row) => row.class_id))
  );
  const directMemberIds = Array.from(
    new Set((directAssignments ?? []).map((row) => row.member_id))
  );

  const [{ data: orgSkills, error: orgSkillsError }, { data: classes, error: classesError }, { data: enrollments, error: enrollmentsError }] =
    await Promise.all([
      supabaseAdmin
        .from('skill')
        .select('skill_id, name')
        .eq('organization_id', organizationId)
        .order('name', { ascending: true }),
      classIds.length
        ? supabaseAdmin
            .from('class_entity')
            .select('class_id, name, schedule')
            .in('class_id', classIds)
        : Promise.resolve({ data: [], error: null }),
      classIds.length
        ? supabaseAdmin
            .from('enrollment')
            .select('member_id, class_id')
            .in('class_id', classIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (orgSkillsError) {
    throw new Error(`Failed to load skills: ${orgSkillsError.message}`);
  }

  if (classesError) {
    throw new Error(`Failed to load classes: ${classesError.message}`);
  }

  if (enrollmentsError) {
    throw new Error(`Failed to load enrollments: ${enrollmentsError.message}`);
  }

  const memberIds = Array.from(
    new Set([...(enrollments ?? []).map((row) => row.member_id), ...directMemberIds])
  );

  if (memberIds.length === 0) {
    return {
      userName,
      organizationName: organization?.name || 'SAC Skill Tracker',
      swimmers: [],
    };
  }

  const [{ data: members, error: membersError }, { data: memberSkillRows, error: memberSkillError }] =
    await Promise.all([
      supabaseAdmin
        .from('member')
        .select('member_id, first_name, last_name, level')
        .in('member_id', memberIds),
      supabaseAdmin
        .from('member_skill')
        .select('member_id, skill_id, progress, date_acquired')
        .in('member_id', memberIds),
    ]);

  if (membersError) {
    throw new Error(`Failed to load members: ${membersError.message}`);
  }

  if (memberSkillError) {
    throw new Error(`Failed to load member skills: ${memberSkillError.message}`);
  }

  const classById = new Map<string, DashboardClassPayload>();
  (classes ?? []).forEach((row) => {
    classById.set(row.class_id, {
      id: row.class_id,
      name: row.name,
      schedule: row.schedule ?? 'Schedule TBD',
    });
  });

  const classesByMemberId = new Map<string, DashboardClassPayload[]>();
  (enrollments ?? []).forEach((row) => {
    const classItem = classById.get(row.class_id);
    if (!classItem) return;

    const existing = classesByMemberId.get(row.member_id) ?? [];
    if (!existing.some((item) => item.id === classItem.id)) {
      existing.push(classItem);
      existing.sort((a, b) => a.name.localeCompare(b.name));
      classesByMemberId.set(row.member_id, existing);
    }
  });

  const memberSkillByKey = new Map<
    string,
    { progress: 0 | 25 | 50 | 75 | 100; dateAcquired?: string }
  >();

  (memberSkillRows ?? []).forEach((row) => {
    memberSkillByKey.set(`${row.member_id}:${row.skill_id}`, {
      progress: normalizeProgress(row.progress),
      dateAcquired: formatDate(row.date_acquired),
    });
  });

  const swimmers = (members ?? [])
    .map((member) => {
      const swimmerSkills: DashboardSkillPayload[] = (orgSkills ?? []).map((skill) => {
        const memberSkill = memberSkillByKey.get(`${member.member_id}:${skill.skill_id}`);
        const progress = memberSkill?.progress ?? 0;

        return {
          id: skill.skill_id,
          name: skill.name,
          progress,
          mastered: progress === 100 || Boolean(memberSkill?.dateAcquired),
          dateAcquired: memberSkill?.dateAcquired,
        };
      });

      return {
        id: member.member_id,
        name: `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() || 'Unnamed swimmer',
        level: member.level ?? 'Unassigned level',
        classes: classesByMemberId.get(member.member_id) ?? [],
        skills: swimmerSkills,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    userName,
    organizationName: organization?.name || 'SAC Skill Tracker',
    swimmers,
  };
}

export async function GET(request: NextRequest) {
  try {
    const email = request.nextUrl.searchParams.get('email');

    if (!email) {
      return NextResponse.json(
        { error: 'Missing required query param: email' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdminClient();
    const { data, error } = await supabaseAdmin.rpc('get_instructor_dashboard_payload', {
      instructor_email: email,
    });

    if (!error) {
      const payload = normalizeRpcPayload(data as RpcDashboardRow | RpcDashboardRow[] | null);
      if (payload) {
        return NextResponse.json(payload);
      }
    } else {
      console.warn('Instructor dashboard RPC unavailable, using fallback:', error.message);
    }

    const fallbackPayload = await buildDashboardFallback(email);
    return NextResponse.json(fallbackPayload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
