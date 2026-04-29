import { NextRequest, NextResponse } from 'next/server';
import { AuthContextError, getCurrentPersonFromRequest } from '@/lib/serverAuth';
import { normalizeRole } from '@/lib/authRoles';
import { getSupabaseAdminClient } from '@/lib/supabaseAdmin';
import {
  buildAuthorizedSwimmerProfile,
  type SwimmerProfilePayload as SharedSwimmerProfilePayload,
} from '@/lib/accountSwimmerProfiles';

interface RouteParams {
  params: { id: string };
}

interface SkillUpdatePayload {
  skillId: string;
  progress: 0 | 1 | 2 | 3 | 4;
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

interface SkillProgressHistoryItem {
  id: string;
  date: string;
  progress: number;
  dateAcquired?: string;
}

interface SwimmerProfilePayload {
  swimmer: {
    id: string;
    name: string;
    age: number | null;
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
    obtainedInClass?: boolean;
    progressHistory?: SkillProgressHistoryItem[];
    notes: SwimmerProfileNote[];
  }>;
  sessionNotes: SwimmerProfileNote[];
}

type InstructorSwimmerProfilePayload = SharedSwimmerProfilePayload & {
  swimmer: SharedSwimmerProfilePayload['swimmer'] & {
    guardianName: string;
    guardianEmail: string;
    guardianRelationship: string;
  };
};

const VALID_PROGRESS_VALUES = new Set([0, 1, 2, 3, 4]);
const INSTRUCTOR_ROUTE_ROLE_SET = new Set(['instructor', 'admin', 'org-admin', 'super-admin', 'superadmin']);

function normalizeIncomingProgress(value: number | undefined): SkillUpdatePayload['progress'] | null {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }

  if (VALID_PROGRESS_VALUES.has(value)) {
    return value as SkillUpdatePayload['progress'];
  }

  const percentToLevelMap: Record<number, SkillUpdatePayload['progress']> = {
    0: 0,
    25: 1,
    50: 2,
    75: 3,
    100: 4,
  };

  return percentToLevelMap[value] ?? null;
}

function normalizeStoredProgress(
  value: number | null | undefined,
): SkillUpdatePayload['progress'] {
  if (value === 0) return 0;
  if (value === 1 || value === 2 || value === 3 || value === 4) {
    return value;
  }
  if (value === 25) return 1;
  if (value === 50) return 2;
  if (value === 75) return 3;
  if (value === 100) return 4;
  return 0;
}

function formatDate(value?: string | null): string | undefined {
  if (!value) return undefined;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(
      Number(value.slice(0, 4)),
      Number(value.slice(5, 7)) - 1,
      Number(value.slice(8, 10)),
    )
    : new Date(value);

  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function toIsoDate(value?: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function calculateAge(dateOfBirth?: string | null): number | null {
  if (!dateOfBirth) return null;
  const dob = /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)
    ? new Date(
      Number(dateOfBirth.slice(0, 4)),
      Number(dateOfBirth.slice(5, 7)) - 1,
      Number(dateOfBirth.slice(8, 10)),
    )
    : new Date(dateOfBirth);
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
      const normalizedProgress = normalizeIncomingProgress(update?.progress);
      if (!update?.skillId || normalizedProgress === null) {
        return;
      }

      normalizedUpdates.set(update.skillId, {
        skillId: update.skillId,
        progress: normalizedProgress,
      });
    });
  }

  if (body.skillId) {
    let progress: number | undefined = body.progress;
    if (typeof progress !== 'number' && typeof body.mastered === 'boolean') {
      progress = body.mastered ? 4 : 0;
    }

    const normalizedProgress = normalizeIncomingProgress(progress);
    if (normalizedProgress !== null) {
      normalizedUpdates.set(body.skillId, {
        skillId: body.skillId,
        progress: normalizedProgress,
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

async function resolveInstructorPersonForRequest(
  request: NextRequest,
  fallbackEmail?: string | null
) {
  let sessionPerson = null;
  try {
    sessionPerson = await getCurrentPersonFromRequest(request);
  } catch (error) {
    if (!(error instanceof AuthContextError)) {
      throw error;
    }

    if (!fallbackEmail) {
      return { error: `UNAUTHORIZED:${error.message}` as const };
    }
  }

  if (sessionPerson) {
    const normalizedRoleNames = sessionPerson.roleNames.map((role) => normalizeRole(role));
    const hasAllowedRole = sessionPerson.roleNames.some((role) =>
      INSTRUCTOR_ROUTE_ROLE_SET.has(normalizeRole(role))
    );

    if (!hasAllowedRole) {
      return { error: 'FORBIDDEN:You do not have access to this instructor route.' as const };
    }

    return {
      person: {
        person_id: sessionPerson.personId,
        email: sessionPerson.email,
        first_name: sessionPerson.firstName,
        last_name: sessionPerson.lastName,
      },
      hasAdminAccess:
        normalizedRoleNames.includes('admin') ||
        normalizedRoleNames.includes('org-admin') ||
        normalizedRoleNames.includes('super-admin') ||
        normalizedRoleNames.includes('superadmin'),
      source: 'session' as const,
    };
  }

  const instructorResolution = await resolveInstructorPersonId(fallbackEmail);
  if ('error' in instructorResolution) {
    return { error: instructorResolution.error };
  }

  return {
    person: instructorResolution.person,
    hasAdminAccess: false,
    source: 'email' as const,
  };
}

async function loadPrimaryGuardianContact(memberId: string) {
  const supabaseAdmin = getSupabaseAdminClient();

  const { data: guardianLinks, error: guardianLinksError } = await supabaseAdmin
    .from('guardian_member')
    .select('guardian_person_id, relationship')
    .eq('member_id', memberId);

  if (guardianLinksError) {
    throw new Error(`Failed to load guardians: ${guardianLinksError.message}`);
  }

  const firstGuardianLink = guardianLinks?.[0];
  if (!firstGuardianLink?.guardian_person_id) {
    return {
      guardianName: 'No guardian on file',
      guardianEmail: '',
      guardianRelationship: '',
    };
  }

  const { data: guardianRow, error: guardianRowError } = await supabaseAdmin
    .from('person')
    .select('first_name, last_name, email')
    .eq('person_id', firstGuardianLink.guardian_person_id)
    .maybeSingle();

  if (guardianRowError) {
    throw new Error(`Failed to load guardian contacts: ${guardianRowError.message}`);
  }

  return {
    guardianName:
      `${guardianRow?.first_name ?? ''} ${guardianRow?.last_name ?? ''}`.trim() || 'Guardian',
    guardianEmail: guardianRow?.email ?? '',
    guardianRelationship: firstGuardianLink.relationship ?? '',
  };
}

async function saveMemberSkillProgress(args: {
  memberId: string;
  skillId: string;
  progress: SkillUpdatePayload['progress'];
  updatedByPersonId: string;
  evaluationId?: string;
}) {
  const supabaseAdmin = getSupabaseAdminClient();
  const dateAcquired = args.progress === 4 ? new Date().toISOString().slice(0, 10) : null;

  if (args.evaluationId) {
    // Evaluation-linked saves always insert a new history row so deleting the
    // evaluation can cleanly revert the skill to its previous value.
    const { error: insertError } = await supabaseAdmin
      .from('member_skill')
      .insert({
        member_id: args.memberId,
        skill_id: args.skillId,
        progress: args.progress,
        date_acquired: dateAcquired,
        updated_by_person_id: args.updatedByPersonId,
        evaluation_id: args.evaluationId,
      });

    if (insertError) {
      return { error: insertError.message };
    }

    return { error: null };
  }

  // Manual updates (PATCH without an evaluation) update the existing row in-place.
  const { data: existingRow, error: existingRowError } = await supabaseAdmin
    .from('member_skill')
    .select('member_skill_id')
    .eq('member_id', args.memberId)
    .eq('skill_id', args.skillId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingRowError) {
    return { error: existingRowError.message };
  }

  if (existingRow?.member_skill_id) {
    const { error: updateError } = await supabaseAdmin
      .from('member_skill')
      .update({
        progress: args.progress,
        date_acquired: dateAcquired,
        updated_by_person_id: args.updatedByPersonId,
        updated_at: new Date().toISOString(),
      })
      .eq('member_skill_id', existingRow.member_skill_id);

    if (updateError) {
      return { error: updateError.message };
    }

    return { error: null };
  }

  const { error: insertError } = await supabaseAdmin
    .from('member_skill')
    .insert({
      member_id: args.memberId,
      skill_id: args.skillId,
      progress: args.progress,
      date_acquired: dateAcquired,
      updated_by_person_id: args.updatedByPersonId,
    });

  if (insertError) {
    return { error: insertError.message };
  }

  return { error: null };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const memberId = params.id;
    const instructorResolution = await resolveInstructorPersonForRequest(
      request,
      request.nextUrl.searchParams.get('email')
    );

    if ('error' in instructorResolution) {
      const errorMessage = instructorResolution.error ?? 'Missing instructor email';
      const status = errorMessage.startsWith('FORBIDDEN:')
        ? 403
        : errorMessage.startsWith('UNAUTHORIZED:')
          ? 401
          : errorMessage === 'Missing instructor email'
            ? 400
            : 400;
      return NextResponse.json(
        {
          error: errorMessage
            .replace('FORBIDDEN:', '')
            .replace('UNAUTHORIZED:', ''),
        },
        { status }
      );
    }
    const [profilePayload, guardianContact] = await Promise.all([
      buildAuthorizedSwimmerProfile(memberId),
      loadPrimaryGuardianContact(memberId),
    ]);

    if (!profilePayload) {
      return NextResponse.json(
        { error: 'Swimmer not found.' },
        { status: 404 },
      );
    }

    const responsePayload: InstructorSwimmerProfilePayload = {
      ...profilePayload,
      swimmer: {
        ...profilePayload.swimmer,
        ...guardianContact,
      },
    };

    return NextResponse.json(responsePayload);
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
      evaluationId?: string;
      feedback?: string;
      skillId?: string;
      mastered?: boolean;
      progress?: number;
    };

    const instructorResolution = await resolveInstructorPersonForRequest(request, body.email);
    if ('error' in instructorResolution) {
      const errorMessage = instructorResolution.error ?? 'Missing instructor email';
      return NextResponse.json(
        {
          error: errorMessage
            .replace('FORBIDDEN:', '')
            .replace('UNAUTHORIZED:', ''),
        },
        {
          status: errorMessage.startsWith('FORBIDDEN:')
            ? 403
            : errorMessage.startsWith('UNAUTHORIZED:')
              ? 401
              : 400,
        }
      );
    }
    const instructor = instructorResolution.person;

    if (body.evaluationId) {
      const trimmedFeedback = body.feedback?.trim() ?? '';

      const { data: evaluationRow, error: evaluationLookupError } = await supabaseAdmin
        .from('evaluation')
        .select('evaluation_id, member_id')
        .eq('evaluation_id', body.evaluationId)
        .eq('member_id', memberId)
        .maybeSingle();

      if (evaluationLookupError) {
        return NextResponse.json(
          { error: `Failed to load evaluation: ${evaluationLookupError.message}` },
          { status: 500 }
        );
      }

      if (!evaluationRow) {
        return NextResponse.json(
          { error: 'Evaluation not found for this swimmer.' },
          { status: 404 }
        );
      }

      const { error: evaluationUpdateError } = await supabaseAdmin
        .from('evaluation')
        .update({
          feedback: trimmedFeedback || null,
        })
        .eq('evaluation_id', body.evaluationId);

      if (evaluationUpdateError) {
        return NextResponse.json(
          { error: `Failed to update evaluation: ${evaluationUpdateError.message}` },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true });
    }

    const skillUpdates = normalizeSkillUpdates(body);

    if (skillUpdates.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields: skillId and valid progress value' },
        { status: 400 }
      );
    }

    const skillUpdate = skillUpdates[0];

    const { error: upsertError } = await saveMemberSkillProgress({
      memberId,
      skillId: skillUpdate.skillId,
      progress: skillUpdate.progress,
      updatedByPersonId: instructor.person_id,
    });

    if (upsertError) {
      return NextResponse.json(
        { error: `Failed to update skill: ${upsertError}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const memberId = params.id;
    const evaluationId = request.nextUrl.searchParams.get('evaluationId')?.trim() ?? '';
    const email = request.nextUrl.searchParams.get('email')?.trim() ?? undefined;

    if (!evaluationId) {
      return NextResponse.json(
        { error: 'Evaluation id is required.' },
        { status: 400 }
      );
    }

    const instructorResolution = await resolveInstructorPersonForRequest(request, email);
    if ('error' in instructorResolution) {
      const errorMessage = instructorResolution.error ?? 'Missing instructor email';
      return NextResponse.json(
        {
          error: errorMessage
            .replace('FORBIDDEN:', '')
            .replace('UNAUTHORIZED:', ''),
        },
        {
          status: errorMessage.startsWith('FORBIDDEN:')
            ? 403
            : errorMessage.startsWith('UNAUTHORIZED:')
              ? 401
              : 400,
        }
      );
    }

    const { data: evaluationRow, error: evaluationLookupError } = await supabaseAdmin
      .from('evaluation')
      .select('evaluation_id, member_id, class_id, evaluation_date, instructor_person_id')
      .eq('evaluation_id', evaluationId)
      .eq('member_id', memberId)
      .maybeSingle();

    if (evaluationLookupError) {
      return NextResponse.json(
        { error: `Failed to load evaluation: ${evaluationLookupError.message}` },
        { status: 500 }
      );
    }

    if (!evaluationRow) {
      return NextResponse.json(
        { error: 'Evaluation not found for this swimmer.' },
        { status: 404 }
      );
    }

    let sessionRowsQuery = supabaseAdmin
      .from('evaluation')
      .select('evaluation_id')
      .eq('member_id', memberId)
      .eq('evaluation_date', evaluationRow.evaluation_date)
      .eq('instructor_person_id', evaluationRow.instructor_person_id);

    if (evaluationRow.class_id) {
      sessionRowsQuery = sessionRowsQuery.eq('class_id', evaluationRow.class_id);
    } else {
      sessionRowsQuery = sessionRowsQuery.is('class_id', null);
    }

    const { data: sessionRows, error: sessionRowsError } = await sessionRowsQuery;

    if (sessionRowsError) {
      return NextResponse.json(
        { error: `Failed to load related evaluation entries: ${sessionRowsError.message}` },
        { status: 500 }
      );
    }

    const evaluationIdsToDelete = Array.from(
      new Set(
        (sessionRows ?? [])
          .map((row) => row.evaluation_id)
          .filter(Boolean)
          .concat(evaluationId)
      )
    );

    if (evaluationIdsToDelete.length === 0) {
      return NextResponse.json(
        { error: 'No evaluation entries were found to delete.' },
        { status: 404 }
      );
    }

    // Delete member_skill rows explicitly linked to this evaluation session.
    const { error: deleteSkillHistoryError } = await supabaseAdmin
      .from('member_skill')
      .delete()
      .in('evaluation_id', evaluationIdsToDelete);

    if (deleteSkillHistoryError) {
      return NextResponse.json(
        { error: `Failed to revert skill progress: ${deleteSkillHistoryError.message}` },
        { status: 500 }
      );
    }

    // Fallback: also delete rows created on the same date with no evaluation_id
    // (covers evaluations saved before evaluation_id tracking was added).
    const evalDate = evaluationRow.evaluation_date; // YYYY-MM-DD
    const { error: deleteLegacySkillsError } = await supabaseAdmin
      .from('member_skill')
      .delete()
      .eq('member_id', memberId)
      .is('evaluation_id', null)
      .gte('updated_at', `${evalDate}T00:00:00.000Z`)
      .lt('updated_at', `${evalDate}T23:59:59.999Z`);

    if (deleteLegacySkillsError) {
      return NextResponse.json(
        { error: `Failed to revert skill progress: ${deleteLegacySkillsError.message}` },
        { status: 500 }
      );
    }

    const { error: deleteError } = await supabaseAdmin
      .from('evaluation')
      .delete()
      .in('evaluation_id', evaluationIdsToDelete);

    if (deleteError) {
      return NextResponse.json(
        { error: `Failed to delete evaluation: ${deleteError.message}` },
        { status: 500 }
      );
    }

    // If the member has no evaluations left, wipe all remaining skill rows so
    // skills fully reset rather than showing stale manual-update values.
    const { count: remainingEvalCount, error: remainingEvalError } = await supabaseAdmin
      .from('evaluation')
      .select('evaluation_id', { count: 'exact', head: true })
      .eq('member_id', memberId);

    if (!remainingEvalError && remainingEvalCount === 0) {
      await supabaseAdmin
        .from('member_skill')
        .delete()
        .eq('member_id', memberId);
    }

    return NextResponse.json({ success: true, deletedEvaluationIds: evaluationIdsToDelete });
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

    const instructorResolution = await resolveInstructorPersonForRequest(request, body.email);
    if ('error' in instructorResolution) {
      const errorMessage = instructorResolution.error ?? 'Missing instructor email';
      return NextResponse.json(
        {
          error: errorMessage
            .replace('FORBIDDEN:', '')
            .replace('UNAUTHORIZED:', ''),
        },
        {
          status: errorMessage.startsWith('FORBIDDEN:')
            ? 403
            : errorMessage.startsWith('UNAUTHORIZED:')
              ? 401
              : 400,
        }
      );
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
        { error: 'Skill updates must use progress values of 0, 1, 2, 3, or 4.' },
        { status: 400 }
      );
    }

    const hasSkillUpdate = skillUpdates.length > 0;
    const hasSkillNote = skillNotes.length > 0;

    const { data: memberEnrollments, error: memberEnrollmentsError } = await supabaseAdmin
      .from('enrollment')
      .select('class_id')
      .eq('member_id', memberId);

    if (memberEnrollmentsError) {
      return NextResponse.json(
        { error: `Failed to load member enrollments: ${memberEnrollmentsError.message}` },
        { status: 500 }
      );
    }

    const enrolledClassIds = Array.from(
      new Set((memberEnrollments ?? []).map((row) => row.class_id).filter(Boolean))
    );

    let classId = body.classId;
    if (classId && !enrolledClassIds.includes(classId)) {
      return NextResponse.json(
        { error: 'Selected class is not enrolled for this swimmer.' },
        { status: 403 }
      );
    }

    if (!classId && enrolledClassIds.length > 0) {
      classId = enrolledClassIds[0];
    }

    const evaluationInstructorPersonId = instructor.person_id;
    const evaluationDate = new Date().toISOString().slice(0, 10);

    // Always create a session-level anchor row so skill progress can be linked
    // to this evaluation (enabling clean revert on delete).
    const anchorRow = {
      instructor_person_id: evaluationInstructorPersonId,
      member_id: memberId,
      class_id: classId ?? null,
      skill_id: null as string | null,
      feedback: trimmedNote || null,
      evaluation_date: evaluationDate,
    };

    const skillNoteRows = skillNotes.map((entry) => ({
      instructor_person_id: evaluationInstructorPersonId,
      member_id: memberId,
      class_id: classId ?? null,
      skill_id: entry.skillId as string | null,
      feedback: entry.note,
      evaluation_date: evaluationDate,
    }));

    const evaluationRows = [anchorRow, ...skillNoteRows];

    const { data: insertedEvaluations, error: insertError } = await supabaseAdmin
      .from('evaluation')
      .insert(evaluationRows)
      .select('evaluation_id, class_id, skill_id, feedback, evaluation_date');

    if (insertError) {
      return NextResponse.json(
        { error: `Failed to save evaluation: ${insertError.message}` },
        { status: 500 }
      );
    }

    // The anchor row is always first — link all skill progress to its ID so
    // deleting this evaluation reverts the skills to their previous values.
    const anchorEvaluationId = insertedEvaluations?.[0]?.evaluation_id ?? null;

    if (hasSkillUpdate && anchorEvaluationId) {
      for (const update of skillUpdates) {
        const { error: skillUpsertError } = await saveMemberSkillProgress({
          memberId,
          skillId: update.skillId,
          progress: update.progress,
          updatedByPersonId: instructor.person_id,
          evaluationId: anchorEvaluationId,
        });

        if (skillUpsertError) {
          return NextResponse.json(
            { error: `Failed to update skill: ${skillUpsertError}` },
            { status: 500 }
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      createdEvaluations: insertedEvaluations ?? [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
