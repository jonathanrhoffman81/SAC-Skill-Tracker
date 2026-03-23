import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabaseAdmin';

interface RouteParams {
  params: { id: string };
}

interface SkillUpdatePayload {
  skillId: string;
  progress: 0 | 25 | 50 | 75 | 100;
}

interface SkillNotePayload {
  skillId: string;
  note: string;
}

interface SwimmerProfileNote {
  id: string;
  date: string;
  content: string;
  author: string;
}

interface SwimmerProfilePayload {
  swimmer: {
    id: string;
    name: string;
    age: number | null;
    level: string;
    enrollmentDate: string;
    guardianName: string;
    guardianEmail: string;
    guardianRelationship: string;
  };
  classes: Array<{
    id: string;
    name: string;
    schedule: string;
  }>;
  skills: Array<{
    id: string;
    name: string;
    mastered: boolean;
    progress: number;
    dateAcquired?: string;
    notes: SwimmerProfileNote[];
  }>;
  sessionNotes: SwimmerProfileNote[];
}

const VALID_PROGRESS_VALUES = new Set([0, 25, 50, 75, 100]);

function formatDate(value?: string | null): string | undefined {
  if (!value) return undefined;
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function calculateAge(dateOfBirth?: string | null): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDelta = now.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

function normalizeSkillUpdates(body: {
  skillId?: string;
  mastered?: boolean;
  progress?: number;
  skillUpdates?: Array<{ skillId?: string; progress?: number }>;
}): SkillUpdatePayload[] {
  const normalizedUpdates = new Map<string, SkillUpdatePayload>();

  if (Array.isArray(body.skillUpdates)) {
    body.skillUpdates.forEach((update) => {
      if (!update?.skillId || !VALID_PROGRESS_VALUES.has(update.progress ?? -1)) {
        return;
      }

      normalizedUpdates.set(update.skillId, {
        skillId: update.skillId,
        progress: update.progress as SkillUpdatePayload['progress'],
      });
    });
  }

  if (body.skillId) {
    let progress: number | undefined = body.progress;
    if (typeof progress !== 'number' && typeof body.mastered === 'boolean') {
      progress = body.mastered ? 100 : 0;
    }

    if (VALID_PROGRESS_VALUES.has(progress ?? -1)) {
      normalizedUpdates.set(body.skillId, {
        skillId: body.skillId,
        progress: progress as SkillUpdatePayload['progress'],
      });
    }
  }

  return Array.from(normalizedUpdates.values());
}

function normalizeSkillNotes(body: {
  skillNotes?: Array<{ skillId?: string; note?: string }>;
}): SkillNotePayload[] {
  if (!Array.isArray(body.skillNotes)) {
    return [];
  }

  return body.skillNotes
    .map((entry) => ({
      skillId: entry?.skillId ?? '',
      note: entry?.note?.trim() ?? '',
    }))
    .filter((entry): entry is SkillNotePayload => Boolean(entry.skillId && entry.note));
}

function normalizeRpcSwimmerProfilePayload(
  data: SwimmerProfilePayload | SwimmerProfilePayload[] | null
): SwimmerProfilePayload | null {
  if (!data) return null;
  const payload = Array.isArray(data) ? data[0] : data;
  if (!payload?.swimmer) return null;
  return payload;
}

async function resolveInstructorPersonId(email?: string | null) {
  if (!email) {
    return { error: 'Missing instructor email' as const };
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { data, error } = await supabaseAdmin
    .from('person')
    .select('person_id, email, first_name, last_name')
    .ilike('email', email)
    .maybeSingle();

  if (error) {
    return { error: `Failed to load instructor: ${error.message}` as const };
  }

  if (!data) {
    return { error: `No instructor found for email ${email}` as const };
  }

  return { person: data };
}

async function instructorCanAccessMember(
  instructorPersonId: string,
  memberId: string
): Promise<{ ok: boolean; error?: string }> {
  const supabaseAdmin = getSupabaseAdminClient();

  const { data: taughtClasses, error: taughtClassesError } = await supabaseAdmin
    .from('class_instructor')
    .select('class_id')
    .eq('person_id', instructorPersonId);

  if (taughtClassesError) {
    return {
      ok: false,
      error: `Failed to load instructor classes: ${taughtClassesError.message}`,
    };
  }

  const taughtClassIds = new Set((taughtClasses ?? []).map((row) => row.class_id));

  const { data: memberEnrollments, error: memberEnrollmentsError } = await supabaseAdmin
    .from('enrollment')
    .select('class_id')
    .eq('member_id', memberId);

  if (memberEnrollmentsError) {
    return {
      ok: false,
      error: `Failed to load member enrollments: ${memberEnrollmentsError.message}`,
    };
  }

  const canAccessViaClass = (memberEnrollments ?? []).some((row) =>
    taughtClassIds.has(row.class_id)
  );

  const { data: directAssignment, error: directAssignmentError } = await supabaseAdmin
    .from('instructor_member_assignment')
    .select('member_id')
    .eq('instructor_person_id', instructorPersonId)
    .eq('member_id', memberId)
    .maybeSingle();

  if (directAssignmentError) {
    return {
      ok: false,
      error: `Failed to load direct instructor assignments: ${directAssignmentError.message}`,
    };
  }

  const canAccessViaDirectAssignment = Boolean(directAssignment);

  return canAccessViaClass || canAccessViaDirectAssignment
    ? { ok: true }
    : { ok: false, error: 'You do not have access to this swimmer.' };
}

async function getSharedClassIdsForInstructorAndMember(
  instructorPersonId: string,
  memberId: string
): Promise<{ sharedClassIds: string[]; error?: string }> {
  const supabaseAdmin = getSupabaseAdminClient();

  const { data: taughtClasses, error: taughtClassesError } = await supabaseAdmin
    .from('class_instructor')
    .select('class_id')
    .eq('person_id', instructorPersonId);

  if (taughtClassesError) {
    return { sharedClassIds: [], error: `Failed to load instructor classes: ${taughtClassesError.message}` };
  }

  const { data: memberEnrollments, error: memberEnrollmentsError } = await supabaseAdmin
    .from('enrollment')
    .select('class_id')
    .eq('member_id', memberId);

  if (memberEnrollmentsError) {
    return { sharedClassIds: [], error: `Failed to load member enrollments: ${memberEnrollmentsError.message}` };
  }

  const taughtClassIds = new Set((taughtClasses ?? []).map((row) => row.class_id));
  const sharedClassIds = (memberEnrollments ?? [])
    .map((row) => row.class_id)
    .filter((classId) => taughtClassIds.has(classId));

  return { sharedClassIds };
}

async function buildSwimmerProfileFallback(email: string, memberId: string): Promise<SwimmerProfilePayload> {
  const supabaseAdmin = getSupabaseAdminClient();

  const instructorResolution = await resolveInstructorPersonId(email);
  if ('error' in instructorResolution) {
    throw new Error(instructorResolution.error);
  }
  const instructor = instructorResolution.person;

  const accessCheck = await instructorCanAccessMember(instructor.person_id, memberId);
  if (!accessCheck.ok) {
    const error = accessCheck.error ?? 'You do not have access to this swimmer.';
    const prefixedError = error.startsWith('Failed') ? error : `FORBIDDEN:${error}`;
    throw new Error(prefixedError);
  }

  const { sharedClassIds, error: sharedClassError } =
    await getSharedClassIdsForInstructorAndMember(instructor.person_id, memberId);
  if (sharedClassError) {
    throw new Error(sharedClassError);
  }

  const { data: member, error: memberError } = await supabaseAdmin
    .from('member')
    .select('member_id, organization_id, first_name, last_name, level, date_of_birth, created_at')
    .eq('member_id', memberId)
    .maybeSingle();

  if (memberError) {
    throw new Error(`Failed to load swimmer: ${memberError.message}`);
  }

  if (!member) {
    throw new Error('NOT_FOUND:Swimmer not found.');
  }

  const { data: classRows, error: classRowsError } = sharedClassIds.length
    ? await supabaseAdmin
        .from('class_entity')
        .select('class_id, name, schedule')
        .in('class_id', sharedClassIds)
    : { data: [], error: null };

  if (classRowsError) {
    throw new Error(`Failed to load classes: ${classRowsError.message}`);
  }

  const { data: skills, error: skillsError } = await supabaseAdmin
    .from('member_skill')
    .select('skill_id, progress, date_acquired')
    .eq('member_id', memberId);

  if (skillsError) {
    throw new Error(`Failed to load swimmer skills: ${skillsError.message}`);
  }

  const { data: orgSkills, error: orgSkillsError } = await supabaseAdmin
    .from('skill')
    .select('skill_id, name')
    .eq('organization_id', member.organization_id)
    .order('name', { ascending: true });

  if (orgSkillsError) {
    throw new Error(`Failed to load organization skills: ${orgSkillsError.message}`);
  }

  const memberSkillById = new Map(
    (skills ?? []).map((row) => [
      row.skill_id,
      {
        progress: row.progress ?? 0,
        dateAcquired: row.date_acquired,
      },
    ])
  );

  const { data: evaluations, error: evaluationsError } = await supabaseAdmin
    .from('evaluation')
    .select('evaluation_id, feedback, evaluation_date, instructor_person_id, class_id, skill_id')
    .eq('member_id', memberId)
    .order('evaluation_date', { ascending: false })
    .limit(100);

  if (evaluationsError) {
    throw new Error(`Failed to load swimmer notes: ${evaluationsError.message}`);
  }

  const authorIds = Array.from(
    new Set((evaluations ?? []).map((row) => row.instructor_person_id))
  );
  const authorNameById = new Map<string, string>();

  if (authorIds.length > 0) {
    const { data: authorRows, error: authorRowsError } = await supabaseAdmin
      .from('person')
      .select('person_id, first_name, last_name')
      .in('person_id', authorIds);

    if (authorRowsError) {
      throw new Error(`Failed to load note authors: ${authorRowsError.message}`);
    }

    (authorRows ?? []).forEach((row) => {
      authorNameById.set(
        row.person_id,
        `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || 'Instructor'
      );
    });
  }

  const { data: guardianLinks, error: guardianLinksError } = await supabaseAdmin
    .from('guardian_member')
    .select('guardian_person_id, relationship')
    .eq('member_id', memberId);

  if (guardianLinksError) {
    throw new Error(`Failed to load guardians: ${guardianLinksError.message}`);
  }

  const guardianIds = Array.from(
    new Set((guardianLinks ?? []).map((link) => link.guardian_person_id))
  );
  const guardianById = new Map<string, { name: string; email: string }>();

  if (guardianIds.length > 0) {
    const { data: guardianRows, error: guardianRowsError } = await supabaseAdmin
      .from('person')
      .select('person_id, first_name, last_name, email')
      .in('person_id', guardianIds);

    if (guardianRowsError) {
      throw new Error(`Failed to load guardian contacts: ${guardianRowsError.message}`);
    }

    (guardianRows ?? []).forEach((guardian) => {
      guardianById.set(guardian.person_id, {
        name:
          `${guardian.first_name ?? ''} ${guardian.last_name ?? ''}`.trim() || 'Guardian',
        email: guardian.email ?? '',
      });
    });
  }

  const firstGuardianLink = guardianLinks?.[0];
  const firstGuardian = firstGuardianLink
    ? guardianById.get(firstGuardianLink.guardian_person_id)
    : null;

  const skillNotesBySkillId = new Map<string, SwimmerProfileNote[]>();

  const sessionNotes = (evaluations ?? [])
    .filter((row) => !row.skill_id)
    .map((row) => ({
      id: row.evaluation_id,
      date: formatDate(row.evaluation_date) ?? '',
      content: row.feedback ?? '',
      author: authorNameById.get(row.instructor_person_id) ?? 'Instructor',
    }));

  (evaluations ?? [])
    .filter((row) => Boolean(row.skill_id))
    .forEach((row) => {
      const key = row.skill_id as string;
      const existing = skillNotesBySkillId.get(key) ?? [];
      existing.push({
        id: row.evaluation_id,
        date: formatDate(row.evaluation_date) ?? '',
        content: row.feedback ?? '',
        author: authorNameById.get(row.instructor_person_id) ?? 'Instructor',
      });
      skillNotesBySkillId.set(key, existing);
    });

  return {
    swimmer: {
      id: member.member_id,
      name: `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim(),
      age: calculateAge(member.date_of_birth),
      level: member.level ?? 'Unassigned level',
      enrollmentDate: formatDate(member.created_at) ?? '',
      guardianName: firstGuardian?.name ?? 'No guardian on file',
      guardianEmail: firstGuardian?.email ?? '',
      guardianRelationship: firstGuardianLink?.relationship ?? '',
    },
    classes: (classRows ?? []).map((row) => ({
      id: row.class_id,
      name: row.name,
      schedule: row.schedule ?? 'Schedule TBD',
    })),
    skills: (orgSkills ?? [])
      .map((row) => {
        const memberSkill = memberSkillById.get(row.skill_id);
        const progress = memberSkill?.progress ?? 0;
        return {
          id: row.skill_id,
          name: row.name,
          mastered: progress === 100 || Boolean(memberSkill?.dateAcquired),
          progress,
          dateAcquired: formatDate(memberSkill?.dateAcquired),
          notes: skillNotesBySkillId.get(row.skill_id) ?? [],
        };
      })
      .sort((a, b) => {
        if (a.mastered !== b.mastered) return a.mastered ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    sessionNotes,
  };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const memberId = params.id;
    const email = request.nextUrl.searchParams.get('email');

    if (!email) {
      return NextResponse.json({ error: 'Missing instructor email' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdminClient();
    const { data, error } = await supabaseAdmin.rpc('get_instructor_swimmer_profile_payload', {
      instructor_email: email,
      swimmer_member_id: memberId,
    });

    if (!error) {
      const payload = normalizeRpcSwimmerProfilePayload(
        data as SwimmerProfilePayload | SwimmerProfilePayload[] | null
      );
      if (payload) {
        return NextResponse.json(payload);
      }
    } else {
      console.warn('Instructor swimmer profile RPC unavailable, using fallback:', error.message);
    }

    const fallbackPayload = await buildSwimmerProfileFallback(email, memberId);
    return NextResponse.json(fallbackPayload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    if (message === 'Missing instructor email') {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (message.startsWith('FORBIDDEN:')) {
      return NextResponse.json({ error: message.replace('FORBIDDEN:', '') }, { status: 403 });
    }
    if (message.startsWith('NOT_FOUND:')) {
      return NextResponse.json({ error: message.replace('NOT_FOUND:', '') }, { status: 404 });
    }
    if (message.startsWith('Failed to')) {
      return NextResponse.json({ error: message }, { status: 500 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const memberId = params.id;
    const body = (await request.json()) as {
      email?: string;
      skillId?: string;
      mastered?: boolean;
      progress?: number;
    };

    const instructorResolution = await resolveInstructorPersonId(body.email);
    if ('error' in instructorResolution) {
      return NextResponse.json({ error: instructorResolution.error }, { status: 400 });
    }
    const instructor = instructorResolution.person;

    const skillUpdates = normalizeSkillUpdates(body);

    if (skillUpdates.length !== 1) {
      return NextResponse.json(
        { error: 'Missing required fields: skillId and valid progress value' },
        { status: 400 }
      );
    }

    const accessCheck = await instructorCanAccessMember(instructor.person_id, memberId);
    if (!accessCheck.ok) {
      return NextResponse.json(
        { error: accessCheck.error ?? 'You do not have access to this swimmer.' },
        { status: accessCheck.error?.startsWith('Failed') ? 500 : 403 }
      );
    }

    const skillUpdate = skillUpdates[0];

    const { error: upsertError } = await supabaseAdmin.from('member_skill').upsert(
      {
        member_id: memberId,
        skill_id: skillUpdate.skillId,
        progress: skillUpdate.progress,
        date_acquired: skillUpdate.progress === 100
          ? new Date().toISOString().slice(0, 10)
          : null,
        updated_by_person_id: instructor.person_id,
      },
      { onConflict: 'member_id,skill_id' }
    );

    if (upsertError) {
      return NextResponse.json(
        { error: `Failed to update skill: ${upsertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const memberId = params.id;
    const body = (await request.json()) as {
      email?: string;
      note?: string;
      classId?: string;
      skillId?: string;
      mastered?: boolean;
      progress?: number;
      skillUpdates?: Array<{ skillId?: string; progress?: number }>;
      skillNotes?: Array<{ skillId?: string; note?: string }>;
    };

    const instructorResolution = await resolveInstructorPersonId(body.email);
    if ('error' in instructorResolution) {
      return NextResponse.json({ error: instructorResolution.error }, { status: 400 });
    }
    const instructor = instructorResolution.person;

    const trimmedNote = body.note?.trim() ?? '';
    const skillUpdates = normalizeSkillUpdates(body);
    const skillNotes = normalizeSkillNotes(body);
    if (
      Array.isArray(body.skillUpdates) &&
      body.skillUpdates.length > 0 &&
      skillUpdates.length !== body.skillUpdates.length
    ) {
      return NextResponse.json(
        { error: 'One or more skill updates included an invalid progress value.' },
        { status: 400 }
      );
    }

    if (
      Array.isArray(body.skillNotes) &&
      body.skillNotes.length > 0 &&
      skillNotes.length !== body.skillNotes.filter((entry) => (entry?.note ?? '').trim().length > 0).length
    ) {
      return NextResponse.json(
        { error: 'One or more skill notes are missing a skill id.' },
        { status: 400 }
      );
    }

    if (body.skillId && skillUpdates.length === 0) {
      return NextResponse.json(
        { error: 'Skill updates must use progress values of 0, 25, 50, 75, or 100.' },
        { status: 400 }
      );
    }

    const hasSkillUpdate = skillUpdates.length > 0;
    const hasSkillNote = skillNotes.length > 0;
    const hasNote = Boolean(trimmedNote) || hasSkillNote;

    if (!hasSkillUpdate && !hasNote) {
      return NextResponse.json(
        { error: 'Note content or skill update is required.' },
        { status: 400 }
      );
    }

    const accessCheck = await instructorCanAccessMember(instructor.person_id, memberId);
    if (!accessCheck.ok) {
      return NextResponse.json(
        { error: accessCheck.error ?? 'You do not have access to this swimmer.' },
        { status: accessCheck.error?.startsWith('Failed') ? 500 : 403 }
      );
    }

    const { sharedClassIds, error: sharedClassError } =
      await getSharedClassIdsForInstructorAndMember(instructor.person_id, memberId);
    if (sharedClassError) {
      return NextResponse.json({ error: sharedClassError }, { status: 500 });
    }

    let classId = body.classId;
    if (classId && !sharedClassIds.includes(classId)) {
      return NextResponse.json(
        { error: 'Selected class is not assigned to this instructor for this swimmer.' },
        { status: 403 }
      );
    }

    if (hasSkillUpdate) {
      const skillUpsertRows = skillUpdates.map((update) => ({
        member_id: memberId,
        skill_id: update.skillId,
        progress: update.progress,
        date_acquired: update.progress === 100 ? new Date().toISOString().slice(0, 10) : null,
        updated_by_person_id: instructor.person_id,
      }));

      const { error: skillUpsertError } = await supabaseAdmin
        .from('member_skill')
        .upsert(skillUpsertRows, { onConflict: 'member_id,skill_id' });

      if (skillUpsertError) {
        return NextResponse.json(
          { error: `Failed to update skill: ${skillUpsertError.message}` },
          { status: 500 }
        );
      }
    }

    if (!hasNote) {
      return NextResponse.json({ success: true });
    }

    if (!classId && sharedClassIds.length > 0) {
      classId = sharedClassIds[0];
    }

    const evaluationDate = new Date().toISOString().slice(0, 10);
    const evaluationRows = [
      ...skillNotes.map((entry) => ({
        instructor_person_id: instructor.person_id,
        member_id: memberId,
        class_id: classId ?? null,
        skill_id: entry.skillId,
        feedback: entry.note,
        evaluation_date: evaluationDate,
      })),
      ...(trimmedNote
        ? [
            {
              instructor_person_id: instructor.person_id,
              member_id: memberId,
              class_id: classId ?? null,
              skill_id: null,
              feedback: trimmedNote,
              evaluation_date: evaluationDate,
            },
          ]
        : []),
    ];

    const { error: insertError } = await supabaseAdmin.from('evaluation').insert(evaluationRows);

    if (insertError) {
      return NextResponse.json(
        { error: `Failed to save note: ${insertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
