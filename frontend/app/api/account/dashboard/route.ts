/**
 * Account dashboard data endpoint.
 * Returns all parent-dashboard data in one payload so the page can stay
 * focused on rendering and avoid multiple client-side round trips.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabaseAdmin';

interface DashboardSkillItem {
  id: string;
  name: string;
  mastered: boolean;
  dateAcquired?: string;
}

interface DashboardSwimmer {
  id: string;
  name: string;
  level: string;
  nextSession: string;
}

interface DashboardNote {
  id: string;
  swimmerName: string;
  note: string;
  date: string;
}

function formatDate(dateValue?: string | null): string | undefined {
  if (!dateValue) return undefined;
  return new Date(dateValue).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export async function GET(request: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const email = request.nextUrl.searchParams.get('email');

    if (!email) {
      return NextResponse.json(
        { error: 'Missing required query param: email' },
        { status: 400 }
      );
    }

    // 1) Resolve person by email (temporary while login is still localStorage based).
    const { data: person, error: personError } = await supabaseAdmin
      .from('person')
      .select('person_id, first_name, last_name, email')
      .ilike('email', email)
      .maybeSingle();

    if (personError) {
      return NextResponse.json(
        { error: `Failed to load person: ${personError.message}` },
        { status: 500 }
      );
    }

    if (!person) {
      return NextResponse.json(
        {
          userName: '',
          swimmers: [],
          skillsBySwimmer: {},
          notes: [],
          error: `No person found for email ${email}`,
        },
        { status: 404 }
      );
    }

    const personDisplayName = `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim();

    // 2) Fetch linked swimmers for this guardian.
    const { data: guardianLinks, error: guardianLinksError } = await supabaseAdmin
      .from('guardian_member')
      .select('member_id')
      .eq('guardian_person_id', person.person_id);

    if (guardianLinksError) {
      return NextResponse.json(
        { error: `Failed to load guardian links: ${guardianLinksError.message}` },
        { status: 500 }
      );
    }

    const memberIds = (guardianLinks ?? []).map((link) => link.member_id);

    if (memberIds.length === 0) {
      return NextResponse.json({
        userName: personDisplayName || person.email,
        swimmers: [],
        skillsBySwimmer: {},
        notes: [],
      });
    }

    // 3) Core swimmer rows.
    const { data: members, error: membersError } = await supabaseAdmin
      .from('member')
      .select('member_id, first_name, last_name, level')
      .in('member_id', memberIds);

    if (membersError) {
      return NextResponse.json(
        { error: `Failed to load members: ${membersError.message}` },
        { status: 500 }
      );
    }

    // 4) Skills + progress rows.
    const { data: memberSkillRows, error: memberSkillsError } = await supabaseAdmin
      .from('member_skill')
      .select('member_id, skill_id, progress, date_acquired')
      .in('member_id', memberIds);

    if (memberSkillsError) {
      return NextResponse.json(
        { error: `Failed to load member skills: ${memberSkillsError.message}` },
        { status: 500 }
      );
    }

    const uniqueSkillIds = Array.from(
      new Set((memberSkillRows ?? []).map((row) => row.skill_id))
    );

    const skillsById = new Map<string, string>();
    if (uniqueSkillIds.length > 0) {
      const { data: skills, error: skillsError } = await supabaseAdmin
        .from('skill')
        .select('skill_id, name')
        .in('skill_id', uniqueSkillIds);

      if (skillsError) {
        return NextResponse.json(
          { error: `Failed to load skills: ${skillsError.message}` },
          { status: 500 }
        );
      }

      (skills ?? []).forEach((skill) => {
        skillsById.set(skill.skill_id, skill.name);
      });
    }

    // 5) Enrollment + class schedule (for next session text).
    const { data: enrollments, error: enrollmentsError } = await supabaseAdmin
      .from('enrollment')
      .select('member_id, class_id')
      .in('member_id', memberIds);

    if (enrollmentsError) {
      return NextResponse.json(
        { error: `Failed to load enrollments: ${enrollmentsError.message}` },
        { status: 500 }
      );
    }

    const classIds = Array.from(new Set((enrollments ?? []).map((row) => row.class_id)));
    const classById = new Map<string, { name: string; schedule: string | null }>();

    if (classIds.length > 0) {
      const { data: classes, error: classesError } = await supabaseAdmin
        .from('class_entity')
        .select('class_id, name, schedule')
        .in('class_id', classIds);

      if (classesError) {
        return NextResponse.json(
          { error: `Failed to load classes: ${classesError.message}` },
          { status: 500 }
        );
      }

      (classes ?? []).forEach((cls) => {
        classById.set(cls.class_id, { name: cls.name, schedule: cls.schedule });
      });
    }

    // 6) Notes/evaluations.
    const { data: evaluations, error: evaluationsError } = await supabaseAdmin
      .from('evaluation')
      .select('evaluation_id, member_id, feedback, evaluation_date')
      .in('member_id', memberIds)
      .order('evaluation_date', { ascending: false })
      .limit(20);

    if (evaluationsError) {
      return NextResponse.json(
        { error: `Failed to load evaluations: ${evaluationsError.message}` },
        { status: 500 }
      );
    }

    const memberNameById = new Map<string, string>();
    (members ?? []).forEach((member) => {
      memberNameById.set(
        member.member_id,
        `${member.first_name} ${member.last_name}`.trim()
      );
    });

    const nextSessionByMemberId = new Map<string, string>();
    (enrollments ?? []).forEach((enrollment) => {
      // Keep the first class found as a lightweight "next session" placeholder.
      if (nextSessionByMemberId.has(enrollment.member_id)) return;
      const classInfo = classById.get(enrollment.class_id);
      if (!classInfo) return;
      nextSessionByMemberId.set(
        enrollment.member_id,
        classInfo.schedule
          ? `${classInfo.name}: ${classInfo.schedule}`
          : `${classInfo.name}: Schedule TBD`
      );
    });

    const swimmers: DashboardSwimmer[] = (members ?? []).map((member) => ({
      id: member.member_id,
      name: `${member.first_name} ${member.last_name}`.trim(),
      level: member.level ?? 'Unassigned level',
      nextSession: nextSessionByMemberId.get(member.member_id) ?? 'No upcoming session',
    }));

    const skillsBySwimmer: Record<string, DashboardSkillItem[]> = {};
    (memberSkillRows ?? []).forEach((row) => {
      if (!skillsBySwimmer[row.member_id]) {
        skillsBySwimmer[row.member_id] = [];
      }

      skillsBySwimmer[row.member_id].push({
        id: row.skill_id,
        name: skillsById.get(row.skill_id) ?? 'Unknown skill',
        // date_acquired is the source of truth for "mastered" in current UI.
        mastered: Boolean(row.date_acquired),
        dateAcquired: formatDate(row.date_acquired),
      });
    });

    // Stable display order: mastered first, then by skill name.
    Object.keys(skillsBySwimmer).forEach((memberId) => {
      skillsBySwimmer[memberId].sort((a, b) => {
        if (a.mastered !== b.mastered) return a.mastered ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    });

    const notes: DashboardNote[] = (evaluations ?? []).map((evaluation) => ({
      id: evaluation.evaluation_id,
      swimmerName: memberNameById.get(evaluation.member_id) ?? 'Unknown swimmer',
      note: evaluation.feedback ?? '',
      date: formatDate(evaluation.evaluation_date) ?? '',
    }));

    return NextResponse.json({
      userName: personDisplayName || person.email,
      swimmers,
      skillsBySwimmer,
      notes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
