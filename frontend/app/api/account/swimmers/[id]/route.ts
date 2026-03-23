import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabaseAdmin';

interface RouteParams {
    params: { id: string };
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
    };
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

function formatDate(value?: string | null): string | undefined {
    if (!value) return undefined;
    // Keep DATE columns (YYYY-MM-DD) as local calendar dates to avoid timezone day shifts.
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)))
        : new Date(value);

    return parsed.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

function calculateAge(dateOfBirth?: string | null): number | null {
    if (!dateOfBirth) return null;
    const dob = /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)
        ? new Date(Number(dateOfBirth.slice(0, 4)), Number(dateOfBirth.slice(5, 7)) - 1, Number(dateOfBirth.slice(8, 10)))
        : new Date(dateOfBirth);
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const monthDelta = now.getMonth() - dob.getMonth();
    if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) {
        age -= 1;
    }
    return age;
}

function isSkillFormattedFeedback(feedback?: string | null): boolean {
    if (!feedback) return false;
    return /skill\s*notes?:|^\s*skill\s*:/im.test(feedback);
}

async function resolveAccountPersonId(email?: string | null) {
    if (!email) {
        return { error: 'Missing account email' as const };
    }

    const supabaseAdmin = getSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
        .from('person')
        .select('person_id')
        .ilike('email', email)
        .maybeSingle();

    if (error) {
        return { error: `Failed to load account: ${error.message}` as const };
    }

    if (!data) {
        return { error: `No account found for email ${email}` as const };
    }

    return { person: data };
}

async function accountCanAccessMember(
    accountPersonId: string,
    memberId: string
): Promise<{ ok: boolean; error?: string }> {
    const supabaseAdmin = getSupabaseAdminClient();

    const [
        { data: guardianLink, error: guardianLinkError },
        { data: personMemberLink, error: personMemberLinkError },
    ] = await Promise.all([
        supabaseAdmin
            .from('guardian_member')
            .select('member_id')
            .eq('guardian_person_id', accountPersonId)
            .eq('member_id', memberId)
            .maybeSingle(),
        supabaseAdmin
            .from('person_member')
            .select('member_id')
            .eq('person_id', accountPersonId)
            .eq('member_id', memberId)
            .maybeSingle(),
    ]);

    if (guardianLinkError || personMemberLinkError) {
        const message = guardianLinkError?.message ?? personMemberLinkError?.message;
        return { ok: false, error: `Failed to verify swimmer access: ${message}` };
    }

    if (guardianLink || personMemberLink) {
        return { ok: true };
    }

    return { ok: false, error: 'You do not have access to this swimmer.' };
}

async function buildParentSwimmerProfile(email: string, memberId: string): Promise<SwimmerProfilePayload> {
    const supabaseAdmin = getSupabaseAdminClient();

    const accountResolution = await resolveAccountPersonId(email);
    if ('error' in accountResolution) {
        throw new Error(accountResolution.error);
    }
    const account = accountResolution.person;

    const accessCheck = await accountCanAccessMember(account.person_id, memberId);
    if (!accessCheck.ok) {
        const accessError = accessCheck.error ?? 'You do not have access to this swimmer.';
        const prefixedError = accessError.startsWith('Failed') ? accessError : `FORBIDDEN:${accessError}`;
        throw new Error(prefixedError);
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

    const [
        { data: skills, error: skillsError },
        { data: orgSkills, error: orgSkillsError },
        { data: evaluations, error: evaluationsError },
    ] = await Promise.all([
        supabaseAdmin
            .from('member_skill')
            .select('skill_id, progress, date_acquired')
            .eq('member_id', memberId),
        supabaseAdmin
            .from('skill')
            .select('skill_id, name')
            .eq('organization_id', member.organization_id)
            .order('name', { ascending: true }),
        supabaseAdmin
            .from('evaluation')
            .select('evaluation_id, feedback, evaluation_date, instructor_person_id, skill_id')
            .eq('member_id', memberId)
            .order('evaluation_date', { ascending: false })
            .limit(100),
    ]);

    if (skillsError) {
        throw new Error(`Failed to load swimmer skills: ${skillsError.message}`);
    }

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

    if (evaluationsError) {
        throw new Error(`Failed to load swimmer notes: ${evaluationsError.message}`);
    }

    const authorIds = Array.from(new Set((evaluations ?? []).map((row) => row.instructor_person_id)));
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

    const skillNotesBySkillId = new Map<string, SwimmerProfileNote[]>();

    const sessionNotes = (evaluations ?? [])
        .filter((row) => !row.skill_id && !isSkillFormattedFeedback(row.feedback))
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
        },
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
            return NextResponse.json({ error: 'Missing account email' }, { status: 400 });
        }

        const payload = await buildParentSwimmerProfile(email, memberId);
        return NextResponse.json(payload);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown server error';

        if (message === 'Missing account email') {
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

        return NextResponse.json({ error: message }, { status: 500 });
    }
}
