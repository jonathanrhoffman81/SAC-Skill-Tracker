import { NextRequest, NextResponse } from "next/server";
import {
  AuthContextError,
  getCurrentPersonFromRequest,
} from "@/lib/serverAuth";
import { normalizeRole } from "@/lib/authRoles";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

interface DashboardClassPayload {
  id: string;
  name: string;
  schedule: string;
  startDate?: string;
  endDate?: string;
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
  classes: DashboardClassPayload[];
  skills: DashboardSkillPayload[];
  skillSummary?: {
    totalSkills: number;
    masteredSkills: number;
    averageProficiency: number;
  };
  evaluationSummary: {
    evaluationCount: number;
    lastEvaluationDate?: string;
    instructors: string[];
  };
}

interface DashboardPayload {
  userName: string;
  organizationName: string;
  swimmers: DashboardSwimmerPayload[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

const INSTRUCTOR_ROUTE_ROLE_SET = new Set([
  "instructor",
  "admin",
  "org-admin",
  "super-admin",
  "superadmin",
]);
const PAGE_SIZE = 10;

function parsePage(request: NextRequest): number {
  const rawPage = Number(request.nextUrl.searchParams.get("page") ?? "1");
  if (!Number.isFinite(rawPage) || rawPage < 1) return 1;
  return Math.floor(rawPage);
}

function parseSearchQuery(request: NextRequest): string {
  return (request.nextUrl.searchParams.get("q") ?? "").trim();
}

function parseLightweightMode(request: NextRequest): boolean {
  const rawValue = (request.nextUrl.searchParams.get("lightweight") ?? "").trim().toLowerCase();
  return rawValue === "1" || rawValue === "true";
}

function parseFetchAll(request: NextRequest): boolean {
  const rawValue = (request.nextUrl.searchParams.get("all") ?? "").trim().toLowerCase();
  return rawValue === "1" || rawValue === "true";
}

function buildPagination(page: number, pageSize: number, total: number) {
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;
  const safePage = Math.min(Math.max(page, 1), totalPages);
  return {
    page: safePage,
    pageSize,
    total,
    totalPages,
    hasNextPage: safePage < totalPages,
    hasPreviousPage: safePage > 1,
  };
}

function formatDate(value?: string | null): string | undefined {
  if (!value) return undefined;
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function normalizeProgress(
  value: number | null | undefined,
): 0 | 1 | 2 | 3 | 4 {
  if (value === 0) return 0;
  if (value === 25) return 1;
  if (value === 50) return 2;
  if (value === 75) return 3;
  if (value === 100) return 4;
  return 0;
}

async function resolveInstructorEmail(request: NextRequest): Promise<string> {
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
      INSTRUCTOR_ROUTE_ROLE_SET.has(normalizeRole(role)),
    );

    if (!hasAllowedRole) {
      throw new Error(
        "FORBIDDEN:You do not have access to this instructor route.",
      );
    }

    return sessionPerson.email;
  }

  const email = request.nextUrl.searchParams.get("email");
  if (!email) {
    throw new Error("Missing instructor email");
  }

  return email;
}

export async function GET(request: NextRequest) {
  try {
    const email = await resolveInstructorEmail(request);
    const page = parsePage(request);
    const searchQuery = parseSearchQuery(request);
    const lightweight = parseLightweightMode(request);
    const fetchAll = parseFetchAll(request);

    const supabaseAdmin = getSupabaseAdminClient();

    // Get instructor info
    const { data: person, error: personError } = await supabaseAdmin
      .from("person")
      .select("person_id, first_name, last_name, email")
      .ilike("email", email)
      .maybeSingle();

    if (personError) {
      console.error("Person error:", personError);
      return NextResponse.json(
        { error: `Failed to load person: ${personError.message}` },
        { status: 500 },
      );
    }

    if (!person) {
      return NextResponse.json(
        { error: `No instructor found for email ${email}` },
        { status: 400 },
      );
    }

    const userName =
      `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim() ||
      person.email;

    // Get instructor's organization
    const { data: personOrg, error: personOrgError } = await supabaseAdmin
      .from("person_organization")
      .select("organization_id")
      .eq("person_id", person.person_id)
      .eq("status", "active")
      .order("joined_at", { ascending: false })
      .maybeSingle();

    if (personOrgError) {
      console.error("Person org error:", personOrgError);
      return NextResponse.json(
        {
          error: `Failed to load organization membership: ${personOrgError.message}`,
        },
        { status: 500 },
      );
    }

    const organizationId = personOrg?.organization_id;
    if (!organizationId) {
      return NextResponse.json({
        userName,
        organizationName: "SAC Skill Tracker",
        swimmers: [],
        pagination: buildPagination(page, PAGE_SIZE, 0),
      } as DashboardPayload);
    }

    // Get organization info
    const { data: organization, error: organizationError } = await supabaseAdmin
      .from("organization")
      .select("name")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (organizationError) {
      console.error("Organization error:", organizationError);
      return NextResponse.json(
        { error: `Failed to load organization: ${organizationError.message}` },
        { status: 500 },
      );
    }

    let pagination = buildPagination(page, PAGE_SIZE, 0);
    let members: Array<{ member_id: string; first_name: string | null; last_name: string | null }> = [];

    if (fetchAll) {
      let allMembersQuery = supabaseAdmin
        .from("member")
        .select("member_id, first_name, last_name")
        .eq("organization_id", organizationId)
        .order("first_name", { ascending: true })
        .order("last_name", { ascending: true });

      if (searchQuery) {
        allMembersQuery = allMembersQuery.or(
          `first_name.ilike.%${searchQuery}%,last_name.ilike.%${searchQuery}%`,
        );
      }

      const { data: allMembers, error: allMembersError } = await allMembersQuery;
      if (allMembersError) {
        console.error("Members error:", allMembersError);
        return NextResponse.json(
          { error: `Failed to load members: ${allMembersError.message}` },
          { status: 500 },
        );
      }

      members = allMembers ?? [];
      pagination = buildPagination(1, PAGE_SIZE, members.length);
    } else {
      let memberCountQuery = supabaseAdmin
        .from("member")
        .select("member_id", { count: "exact", head: true })
        .eq("organization_id", organizationId);

      if (searchQuery) {
        memberCountQuery = memberCountQuery.or(
          `first_name.ilike.%${searchQuery}%,last_name.ilike.%${searchQuery}%`,
        );
      }

      const { count: totalCount, error: memberCountError } =
        await memberCountQuery;
      if (memberCountError) {
        console.error("Member count error:", memberCountError);
        return NextResponse.json(
          { error: `Failed to count members: ${memberCountError.message}` },
          { status: 500 },
        );
      }

      pagination = buildPagination(page, PAGE_SIZE, totalCount ?? 0);
      const from = (pagination.page - 1) * pagination.pageSize;
      const to = from + pagination.pageSize - 1;

      let pagedMembersQuery = supabaseAdmin
        .from("member")
        .select("member_id, first_name, last_name")
        .eq("organization_id", organizationId)
        .order("first_name", { ascending: true })
        .order("last_name", { ascending: true })
        .range(from, to);

      if (searchQuery) {
        pagedMembersQuery = pagedMembersQuery.or(
          `first_name.ilike.%${searchQuery}%,last_name.ilike.%${searchQuery}%`,
        );
      }

      const { data: pagedMembers, error: membersError } = await pagedMembersQuery;

      if (membersError) {
        console.error("Members error:", membersError);
        return NextResponse.json(
          { error: `Failed to load members: ${membersError.message}` },
          { status: 500 },
        );
      }

      members = pagedMembers ?? [];
    }

    if (!members || members.length === 0) {
      return NextResponse.json({
        userName,
        organizationName: organization?.name || "SAC Skill Tracker",
        swimmers: [],
        pagination,
      } as DashboardPayload);
    }

    const memberIds = members.map((m) => m.member_id);

    // Batch size to avoid header overflow (Supabase limits URLs to ~16KB)
    const BATCH_SIZE = 100;

    // Helper to batch queries
    async function batchQuery(
      table: string,
      selectStr: string,
      ids: string[],
      filterColumn: string,
    ) {
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

    const loadOrgSkillsPromise = !lightweight
      ? supabaseAdmin
        .from("skill")
        .select("skill_id, name")
        .eq("organization_id", organizationId)
        .order("name", { ascending: true })
      : supabaseAdmin
        .from("skill")
        .select("skill_id", { count: "exact", head: true })
        .eq("organization_id", organizationId);

    const loadMemberSkillsPromise =
      memberIds.length > 0
        ? batchQuery(
          "member_skill",
          "member_id, skill_id, progress, date_acquired",
          memberIds,
          "member_id",
        )
        : Promise.resolve([] as any[]);

    const loadEnrollmentsPromise =
      memberIds.length > 0
        ? batchQuery("enrollment", "member_id, class_id", memberIds, "member_id")
        : Promise.resolve([] as any[]);

    const loadEvaluationsPromise =
      memberIds.length > 0
        ? batchQuery(
          "evaluation",
          "member_id, evaluation_date, instructor_person_id",
          memberIds,
          "member_id",
        )
        : Promise.resolve([] as any[]);

    let orgSkills: Array<{ skill_id: string; name: string }> = [];
    let totalOrgSkills = 0;
    let memberSkillRows: any[] = [];
    let enrollments: any[] = [];
    let evaluations: any[] = [];

    try {
      const [orgSkillsResult, loadedMemberSkills, loadedEnrollments, loadedEvaluations] =
        await Promise.all([
          loadOrgSkillsPromise,
          loadMemberSkillsPromise,
          loadEnrollmentsPromise,
          loadEvaluationsPromise,
        ]);

      if (!lightweight) {
        const skillRows = (orgSkillsResult as { data: Array<{ skill_id: string; name: string }> | null; error: any }).data;
        const orgSkillsError = (orgSkillsResult as { data: Array<{ skill_id: string; name: string }> | null; error: any }).error;

        if (orgSkillsError) {
          console.error("Org skills error:", orgSkillsError);
          return NextResponse.json(
            { error: `Failed to load skills: ${orgSkillsError.message}` },
            { status: 500 },
          );
        }

        orgSkills = skillRows ?? [];
        totalOrgSkills = orgSkills.length;
      } else {
        const skillCount = (orgSkillsResult as { count: number | null; error: any }).count;
        const skillCountError = (orgSkillsResult as { count: number | null; error: any }).error;

        if (skillCountError) {
          console.error("Org skill count error:", skillCountError);
          return NextResponse.json(
            { error: `Failed to count skills: ${skillCountError.message}` },
            { status: 500 },
          );
        }

        totalOrgSkills = skillCount ?? 0;
      }

      memberSkillRows = loadedMemberSkills;
      enrollments = loadedEnrollments;
      evaluations = loadedEvaluations;
    } catch (error) {
      console.error("Parallel instructor dashboard query error:", error);
      return NextResponse.json(
        {
          error: `Failed to load evaluation data: ${error instanceof Error ? error.message : String(error)}`,
        },
        { status: 500 },
      );
    }

    console.log(
      `Retrieved ${memberSkillRows.length} member skill records and ${enrollments.length} enrollment records`,
    );

    const classIds = Array.from(
      new Set((enrollments ?? []).map((e) => e.class_id)),
    );

    // Get classes in batches
    let classes: any[] = [];
    if (classIds.length > 0) {
      try {
        classes = await batchQuery(
          "class_entity",
          "class_id, name, schedule, start_date, end_date",
          classIds,
          "class_id",
        );
      } catch (error) {
        console.error("Classes error:", error);
        return NextResponse.json(
          {
            error: `Failed to load classes: ${error instanceof Error ? error.message : String(error)}`,
          },
          { status: 500 },
        );
      }
    }

    const classById = new Map<string, DashboardClassPayload>();
    (classes ?? []).forEach((row) => {
      classById.set(row.class_id, {
        id: row.class_id,
        name: row.name,
        schedule: row.schedule ?? "Schedule TBD",
        startDate: row.start_date ?? undefined,
        endDate: row.end_date ?? undefined,
      });
    });

    const instructorIds = Array.from(
      new Set(
        (evaluations ?? [])
          .map((evaluation) => evaluation.instructor_person_id)
          .filter(Boolean),
      ),
    );

    const instructorNameById = new Map<string, string>();
    if (instructorIds.length > 0) {
      try {
        const instructors = await batchQuery(
          "person",
          "person_id, first_name, last_name",
          instructorIds,
          "person_id",
        );

        instructors.forEach((row: any) => {
          instructorNameById.set(
            row.person_id,
            `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "Instructor",
          );
        });
      } catch (error) {
        console.error("Instructor names error:", error);
        return NextResponse.json(
          {
            error: `Failed to load instructor names: ${error instanceof Error ? error.message : String(error)}`,
          },
          { status: 500 },
        );
      }
    }

    const evaluationSummaryByMemberId = new Map<
      string,
      { evaluationCount: number; lastEvaluationDate?: string; instructors: string[] }
    >();

    (evaluations ?? []).forEach((row) => {
      const existing =
        evaluationSummaryByMemberId.get(row.member_id) ??
        {
          evaluationCount: 0,
          lastEvaluationDate: undefined,
          instructors: [],
        };

      existing.evaluationCount += 1;

      if (row.evaluation_date) {
        const currentLastDate = existing.lastEvaluationDate
          ? new Date(existing.lastEvaluationDate)
          : null;
        const incomingDate = new Date(row.evaluation_date);

        if (!currentLastDate || incomingDate > currentLastDate) {
          existing.lastEvaluationDate = row.evaluation_date;
        }
      }

      const instructorName = instructorNameById.get(row.instructor_person_id);
      if (instructorName && !existing.instructors.includes(instructorName)) {
        existing.instructors.push(instructorName);
      }

      evaluationSummaryByMemberId.set(row.member_id, existing);
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

    const skillSummaryByMemberId = new Map<
      string,
      { masteredSkills: number; totalProgressPercent: number }
    >();

    (memberSkillRows ?? []).forEach((row) => {
      const existing = skillSummaryByMemberId.get(row.member_id) ?? {
        masteredSkills: 0,
        totalProgressPercent: 0,
      };

      const progress = Number(row.progress ?? 0);
      existing.totalProgressPercent += Number.isFinite(progress) ? progress : 0;
      if (progress === 100 || Boolean(row.date_acquired)) {
        existing.masteredSkills += 1;
      }

      skillSummaryByMemberId.set(row.member_id, existing);
    });

    const swimmers: DashboardSwimmerPayload[] = members.map((member) => {
      const memberSkillSummary = skillSummaryByMemberId.get(member.member_id) ?? {
        masteredSkills: 0,
        totalProgressPercent: 0,
      };

      const memberSkills: DashboardSkillPayload[] = !lightweight
        ? (orgSkills ?? []).map((skill) => {
          const memberSkill = memberSkillByKey.get(
            `${member.member_id}:${skill.skill_id}`,
          );
          const progress = memberSkill?.progress ?? 0;

          return {
            id: skill.skill_id,
            name: skill.name,
            progress,
            mastered: progress === 4 || Boolean(memberSkill?.dateAcquired),
            dateAcquired: memberSkill?.dateAcquired,
          };
        })
        : [];

      const averageProficiency =
        totalOrgSkills > 0
          ? Math.round(memberSkillSummary.totalProgressPercent / totalOrgSkills)
          : 0;

      return {
        id: member.member_id,
        name:
          `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim() ||
          "Unnamed swimmer",
        classes: classesByMemberId.get(member.member_id) ?? [],
        skills: memberSkills,
        skillSummary: {
          totalSkills: totalOrgSkills,
          masteredSkills: memberSkillSummary.masteredSkills,
          averageProficiency,
        },
        evaluationSummary: {
          evaluationCount:
            evaluationSummaryByMemberId.get(member.member_id)?.evaluationCount ?? 0,
          lastEvaluationDate: formatDate(
            evaluationSummaryByMemberId.get(member.member_id)?.lastEvaluationDate,
          ),
          instructors:
            evaluationSummaryByMemberId.get(member.member_id)?.instructors ?? [],
        },
      };
    });

    const payload: DashboardPayload = {
      userName,
      organizationName: organization?.name || "SAC Skill Tracker",
      swimmers,
      pagination,
    };

    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";
    console.error("All-swimmers route error:", message, error);
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
    if (message === "Missing instructor email") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
