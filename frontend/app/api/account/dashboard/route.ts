/**
 * Account dashboard data endpoint.
 * Returns all parent-dashboard data from a single database RPC.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabaseAdmin';

type SkillProgress = 0 | 25 | 50 | 75 | 100;

interface DashboardPayload {
  userName: string;
  organizationName?: string;
  swimmers: Array<{
    id: string;
    name: string;
    level: string;
    nextSession: string;
    classIds?: string[];
  }>;
  skillsBySwimmer: Record<
    string,
    Array<{
      id: string;
      name: string;
      progress?: 0 | 25 | 50 | 75 | 100;
      mastered: boolean;
      dateAcquired?: string | null;
      notes?: Array<{
        id: string;
        author: string;
        content: string;
        date: string;
      }>;
    }>
  >;
}

function normalizeProgress(value?: number | null, mastered?: boolean): SkillProgress {
  if (value === 0 || value === 25 || value === 50 || value === 75 || value === 100) {
    return value;
  }
  return mastered ? 100 : 0;
}

function formatDate(value?: string | null): string | null {
  if (!value) return null;
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

    const { data, error } = await supabaseAdmin.rpc('get_parent_dashboard', {
      p_email: email,
    });

    if (error) {
      return NextResponse.json(
        { error: `Failed to load dashboard: ${error.message}` },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        {
          userName: '',
          swimmers: [],
          skillsBySwimmer: {},
          error: `No person found for email ${email}`,
        },
        { status: 404 }
      );
    }

    const payload = data as DashboardPayload;
    const memberIds = (payload.swimmers ?? []).map((swimmer) => swimmer.id);

    if (memberIds.length > 0) {
      const { data: memberSkillRows, error: memberSkillError } = await supabaseAdmin
        .from('member_skill')
        .select('member_id, skill_id, progress, date_acquired')
        .in('member_id', memberIds);

      if (memberSkillError) {
        return NextResponse.json(
          { error: `Failed to load member skills: ${memberSkillError.message}` },
          { status: 500 }
        );
      }

      const progressByMemberSkill = new Map<string, { progress: SkillProgress; dateAcquired: string | null }>();
      (memberSkillRows ?? []).forEach((row) => {
        const key = `${row.member_id}:${row.skill_id}`;
        progressByMemberSkill.set(key, {
          progress: normalizeProgress(row.progress, Boolean(row.date_acquired)),
          dateAcquired: formatDate(row.date_acquired),
        });
      });

      payload.skillsBySwimmer = Object.fromEntries(
        Object.entries(payload.skillsBySwimmer ?? {}).map(([memberId, skills]) => [
          memberId,
          (skills ?? []).map((skill) => {
            const key = `${memberId}:${skill.id}`;
            const memberSkill = progressByMemberSkill.get(key);
            if (!memberSkill) {
              return {
                ...skill,
                progress: normalizeProgress(skill.progress, skill.mastered),
              };
            }

            return {
              ...skill,
              progress: memberSkill.progress,
              mastered: memberSkill.progress === 100,
              dateAcquired: memberSkill.dateAcquired ?? skill.dateAcquired ?? null,
            };
          }),
        ])
      );
    }

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
