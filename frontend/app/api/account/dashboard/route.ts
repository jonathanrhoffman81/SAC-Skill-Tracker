/**
 * Account dashboard data endpoint.
 * Returns all parent-dashboard data from a single database RPC.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  AuthContextError,
  getCurrentPersonFromRequest,
} from "@/lib/serverAuth";
import {
  buildParentSwimmerProfiles,
  type SwimmerProfilePayload,
} from "@/lib/accountSwimmerProfiles";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

type SkillProgress = 0 | 1 | 2 | 3 | 4;

interface DashboardPayload {
  userName: string;
  organizationName?: string;
  logoUrl?: string | null;
  swimmers: Array<{
    id: string;
    name: string;
    nextClass: string;
    classIds?: string[];
  }>;
  skillsBySwimmer: Record<
    string,
    Array<{
      id: string;
      name: string;
      progress?: 0 | 1 | 2 | 3 | 4;
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
  profilesBySwimmer?: Record<string, SwimmerProfilePayload>;
}

const ACCOUNT_ROUTE_ROLE_SET = new Set([
  "guardian",
  "parent",
  "account",
  "member",
  "human",
  "swimmer",
  "admin",
  "super-admin",
  "superadmin",
]);

function formatDate(value?: string | null): string | null {
  if (!value) return null;
  // Keep DATE columns (YYYY-MM-DD) as local calendar dates to avoid timezone day shifts.
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(
        Number(value.slice(0, 4)),
        Number(value.slice(5, 7)) - 1,
        Number(value.slice(8, 10)),
      )
    : new Date(value);

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function resolveAccountContext(request: NextRequest): Promise<{
  email: string;
  personId: string;
}> {
  let sessionPerson = null;
  try {
    sessionPerson = await getCurrentPersonFromRequest(request);
  } catch (error) {
    if (!(error instanceof AuthContextError)) {
      throw error;
    }

    const fallbackEmail = request.nextUrl.searchParams.get("email");
    if (!fallbackEmail) {
      throw new Error(`UNAUTHORIZED:${error.message}`);
    }
  }

  if (sessionPerson?.email) {
    const hasAllowedRole = sessionPerson.roleNames.some((role) =>
      ACCOUNT_ROUTE_ROLE_SET.has(role.toLowerCase()),
    );

    if (!hasAllowedRole) {
      throw new Error(
        "FORBIDDEN:You do not have access to the account dashboard.",
      );
    }

    return {
      email: sessionPerson.email,
      personId: sessionPerson.personId,
    };
  }

  const email = request.nextUrl.searchParams.get("email");
  if (!email) {
    throw new Error("Missing required query param: email");
  }

  const supabaseAdmin = getSupabaseAdminClient();
  const { data: person, error: personError } = await supabaseAdmin
    .from("person")
    .select("person_id")
    .ilike("email", email)
    .maybeSingle();

  if (personError) {
    throw new Error(`Failed to load account: ${personError.message}`);
  }

  if (!person) {
    throw new Error(`No account found for email ${email}`);
  }

  return {
    email,
    personId: person.person_id,
  };
}

export async function GET(request: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const { email, personId } = await resolveAccountContext(request);

    const { data, error } = await supabaseAdmin.rpc("get_parent_dashboard", {
      p_email: email,
    });

    if (error) {
      return NextResponse.json(
        { error: `Failed to load dashboard: ${error.message}` },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        {
          userName: "",
          swimmers: [],
          skillsBySwimmer: {},
          error: `No person found for email ${email}`,
        },
        { status: 404 },
      );
    }

    const payload = data as DashboardPayload;
    const memberIds = (payload.swimmers ?? []).map((swimmer) => swimmer.id);

    if (memberIds.length > 0) {
      const { data: memberSkillRows, error: memberSkillError } =
        await supabaseAdmin
          .from("member_skill_current")
          .select("member_id, skill_id, progress, date_acquired")
          .in("member_id", memberIds);

      if (memberSkillError) {
        return NextResponse.json(
          {
            error: `Failed to load member skills: ${memberSkillError.message}`,
          },
          { status: 500 },
        );
      }

      const progressByMemberSkill = new Map<
        string,
        { progress: SkillProgress; dateAcquired: string | null }
      >();
      (memberSkillRows ?? []).forEach((row) => {
        const key = `${row.member_id}:${row.skill_id}`;
        progressByMemberSkill.set(key, {
          progress: row.progress,
          dateAcquired: formatDate(row.date_acquired),
        });
      });

      payload.skillsBySwimmer = Object.fromEntries(
        Object.entries(payload.skillsBySwimmer ?? {}).map(
          ([memberId, skills]) => [
            memberId,
            (skills ?? []).map((skill) => {
              const key = `${memberId}:${skill.id}`;
              const memberSkill = progressByMemberSkill.get(key);
              if (!memberSkill) {
                return {
                  ...skill,
                  progress: skill.progress,
                };
              }

              return {
                ...skill,
                progress: memberSkill.progress,
                mastered: memberSkill.progress === 4,
                dateAcquired:
                  memberSkill.dateAcquired ?? skill.dateAcquired ?? null,
              };
            }),
          ],
        ),
      );

      const profileMap = await buildParentSwimmerProfiles(personId, memberIds);
      payload.profilesBySwimmer = Object.fromEntries(profileMap.entries());
    }

    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    if (message.startsWith("FORBIDDEN:")) {
      return NextResponse.json(
        { error: message.replace("FORBIDDEN:", "") },
        { status: 403 },
      );
    }
    if (message.startsWith("UNAUTHORIZED:")) {
      return NextResponse.json(
        { error: message.replace("UNAUTHORIZED:", "") },
        { status: 401 },
      );
    }
    if (message === "Missing required query param: email") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
