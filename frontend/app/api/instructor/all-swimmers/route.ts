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
  progress: 0 | 1 | 2 | 3 | 4;
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

function formatDate(value?: string | null): string | undefined {
  if (!value) return undefined;
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function normalizeProgress(value: number | null | undefined): 0 | 1 | 2 | 3 | 4 {
  if (value === 0) return 0;
  if (value === 25) return 1;
  if (value === 50) return 2;
  if (value === 75) return 3;
  if (value === 100) return 4;
  return 0;
}

export async function GET(request: NextRequest) {
  try {
    const email = request.nextUrl.searchParams.get('email');

    if (!email) {
      return NextResponse.json({ error: 'Missing instructor email' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdminClient();

    // Get instructor info
    const { data: person, error: personError } = await supabaseAdmin
      .from('person')
      .select('person_id, first_name, last_name, email')
      .ilike('email', email)
      .maybeSingle();

    if (personError) {
      console.error('Person error:', personError);
      return NextResponse.json({ error: `Failed to load person: ${personError.message}` }, { status: 500 });
    }

    if (!person) {
      return NextResponse.json({ error: `No instructor found for email ${email}` }, { status: 400 });
    }

    const userName =
      `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() || person.email;

    // Get instructor's organization
    const { data: personOrg, error: personOrgError } = await supabaseAdmin
      .from('person_organization')
      .select('organization_id')
      .eq('person_id', person.person_id)
      .eq('status', 'active')
      .order('joined_at', { ascending: false })
      .maybeSingle();

    if (personOrgError) {
      console.error('Person org error:', personOrgError);
      return NextResponse.json(
        { error: `Failed to load organization membership: ${personOrgError.message}` },
        { status: 500 }
      );
    }

    const organizationId = personOrg?.organization_id;
    if (!organizationId) {
      return NextResponse.json({
        userName,
        organizationName: 'SAC Skill Tracker',
        swimmers: [],
      } as DashboardPayload);
    }

    // Get organization info
    const { data: organization, error: organizationError } = await supabaseAdmin
      .from('organization')
      .select('name')
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (organizationError) {
      console.error('Organization error:', organizationError);
      return NextResponse.json(
        { error: `Failed to load organization: ${organizationError.message}` },
        { status: 500 }
      );
    }

    // Get ALL members in organization
    const { data: members, error: membersError } = await supabaseAdmin
      .from('member')
      .select('member_id, first_name, last_name, level')
      .eq('organization_id', organizationId)
      .order('first_name', { ascending: true })
      .order('last_name', { ascending: true });

    if (membersError) {
      console.error('Members error:', membersError);
      return NextResponse.json({ error: `Failed to load members: ${membersError.message}` }, { status: 500 });
    }

    if (!members || members.length === 0) {
      return NextResponse.json({
        userName,
        organizationName: organization?.name || 'SAC Skill Tracker',
        swimmers: [],
      } as DashboardPayload);
    }

    const memberIds = members.map((m) => m.member_id);

    // Batch size to avoid header overflow (Supabase limits URLs to ~16KB)
    const BATCH_SIZE = 100;

    // Helper to batch queries
    async function batchQuery(table: string, selectStr: string, ids: string[], filterColumn: string) {
      if (ids.length === 0) return [];

      const batches = [];
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const batch = ids.slice(i, i + BATCH_SIZE);
        const { data, error } = await supabaseAdmin
          .from(table)
          .select(selectStr)
          .in(filterColumn, batch);

        if (error) throw error;
        batches.push(...(data || []));
      }
      return batches;
    }

    // Get all skills for organization
    const { data: orgSkills, error: orgSkillsError } = await supabaseAdmin
      .from('skill')
      .select('skill_id, name')
      .eq('organization_id', organizationId)
      .order('name', { ascending: true });

    if (orgSkillsError) {
      console.error('Org skills error:', orgSkillsError);
      return NextResponse.json({ error: `Failed to load skills: ${orgSkillsError.message}` }, { status: 500 });
    }

    // Get member skills in batches
    let memberSkillRows: any[] = [];
    if (memberIds.length > 0) {
      try {
        memberSkillRows = await batchQuery('member_skill', 'member_id, skill_id, progress, date_acquired', memberIds, 'member_id');
      } catch (error) {
        console.error('Member skills error:', error);
        return NextResponse.json(
          { error: `Failed to load member skills: ${error instanceof Error ? error.message : String(error)}` },
          { status: 500 }
        );
      }
    }

    // Get enrollments in batches
    let enrollments: any[] = [];
    if (memberIds.length > 0) {
      try {
        enrollments = await batchQuery('enrollment', 'member_id, class_id', memberIds, 'member_id');
      } catch (error) {
        console.error('Enrollments error:', error);
        return NextResponse.json({ error: `Failed to load enrollments: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
      }
    }

    console.log(`Retrieved ${memberSkillRows.length} member skill records and ${enrollments.length} enrollment records`);


    const classIds = Array.from(new Set((enrollments ?? []).map((e) => e.class_id)));

    // Get classes in batches
    let classes: any[] = [];
    if (classIds.length > 0) {
      try {
        classes = await batchQuery('class_entity', 'class_id, name, schedule', classIds, 'class_id');
      } catch (error) {
        console.error('Classes error:', error);
        return NextResponse.json({ error: `Failed to load classes: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
      }
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
      { progress: 0 | 1 | 2 | 3 | 4; dateAcquired?: string }
    >();

    (memberSkillRows ?? []).forEach((row) => {
      memberSkillByKey.set(`${row.member_id}:${row.skill_id}`, {
        progress: normalizeProgress(row.progress),
        dateAcquired: formatDate(row.date_acquired),
      });
    });

    const swimmers: DashboardSwimmerPayload[] = members.map((member) => {
      const memberSkills: DashboardSkillPayload[] = (orgSkills ?? []).map((skill) => {
        const memberSkill = memberSkillByKey.get(`${member.member_id}:${skill.skill_id}`);
        const progress = memberSkill?.progress ?? 0;

        return {
          id: skill.skill_id,
          name: skill.name,
          progress,
          mastered: progress === 4 || Boolean(memberSkill?.dateAcquired),
          dateAcquired: memberSkill?.dateAcquired,
        };
      });

      return {
        id: member.member_id,
        name: `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() || 'Unnamed swimmer',
        level: member.level ?? 'Unassigned level',
        classes: classesByMemberId.get(member.member_id) ?? [],
        skills: memberSkills,
      };
    });

    const payload: DashboardPayload = {
      userName,
      organizationName: organization?.name || 'SAC Skill Tracker',
      swimmers,
    };

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    console.error('All-swimmers route error:', message, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
