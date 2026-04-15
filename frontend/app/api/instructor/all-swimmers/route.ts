import { NextRequest, NextResponse } from "next/server";
import {
  AuthContextError,
  getCurrentPersonFromRequest,
} from "@/lib/serverAuth";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

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
  classes: DashboardClassPayload[];
  skills: DashboardSkillPayload[];
  needsEvaluation?: boolean; // determined by if a class is over
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
  "super-admin",
  "superadmin",
]);
const PAGE_SIZE = 25;

function parsePage(request: NextRequest): number {
  const rawPage = Number(request.nextUrl.searchParams.get("page") ?? "1");
  if (!Number.isFinite(rawPage) || rawPage < 1) return 1;
  return Math.floor(rawPage);
}

function parseSearchQuery(request: NextRequest): string {
  return (request.nextUrl.searchParams.get("q") ?? "").trim();
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
      INSTRUCTOR_ROUTE_ROLE_SET.has(role.toLowerCase()),
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

    // GET INSTRUCTOR'S GROUPS
    const { data: instructorGroups } = await supabaseAdmin
      .from("group_instructor")
      .select("group_id")
      .eq("instructor_person_id", person.person_id);

    const instructorGroupIds = new Set(instructorGroups?.map(g => g.group_id) || []);

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

    const pagination = buildPagination(page, PAGE_SIZE, totalCount ?? 0);
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

    const { data: members, error: membersError } = await pagedMembersQuery;

    if (membersError) {
      console.error("Members error:", membersError);
      return NextResponse.json(
        { error: `Failed to load members: ${membersError.message}` },
        { status: 500 },
      );
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

    // Get all skills for organization
    const { data: orgSkills, error: orgSkillsError } = await supabaseAdmin
      .from("skill")
      .select("skill_id, name")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true });

    if (orgSkillsError) {
      console.error("Org skills error:", orgSkillsError);
      return NextResponse.json(
        { error: `Failed to load skills: ${orgSkillsError.message}` },
        { status: 500 },
      );
    }

    // Get member skills in batches
    let memberSkillRows: any[] = [];
    if (memberIds.length > 0) {
      try {
        memberSkillRows = await batchQuery(
          "member_skill",
          "member_id, skill_id, progress, date_acquired",
          memberIds,
          "member_id",
        );
      } catch (error) {
        console.error("Member skills error:", error);
        return NextResponse.json(
          {
            error: `Failed to load member skills: ${error instanceof Error ? error.message : String(error)}`,
          },
          { status: 500 },
        );
      }
    }

    // Get enrollments in batches
    let enrollments: any[] = [];
    if (memberIds.length > 0) {
      try {
        enrollments = await batchQuery(
          "enrollment",
          "member_id, class_id, group_id", // Add group_id here
          memberIds,
          "member_id",
        );
      } catch (error) {
        console.error("Enrollments error:", error);
        return NextResponse.json(
          {
            error: `Failed to load enrollments: ${error instanceof Error ? error.message : String(error)}`,
          },
          { status: 500 },
        );
      }
    }

    // Get evaluations in batches
    let evaluations: any[] = [];
    if (memberIds.length > 0) {
      try {
        evaluations = await batchQuery(
          "evaluation",
          "member_id, class_id, evaluation_date",
          memberIds,
          "member_id",
        );
      } catch (error) {
        console.error("Evaluations error:", error);
        evaluations = [];
      }
    }

    console.log(
      `Retrieved ${memberSkillRows.length} member skill records, ${enrollments.length} enrollment records, and ${evaluations.length} evaluation records`,
    );

    // DEBUG: Log evaluations
    if (evaluations.length > 0) {
      console.log("[DEBUG] Evaluations fetched:");
      evaluations.forEach(e => {
        console.log(`  - member_id: ${e.member_id}, class_id: ${e.class_id}, evaluation_date: ${e.evaluation_date}`);
      });
    } else {
      console.log("[DEBUG] No evaluations found in database");
    }

    const classIds = Array.from(
      new Set((enrollments ?? []).map((e) => e.class_id)),
    );

    // Get classes in batches
    let classes: any[] = [];
    if (classIds.length > 0) {
      try {
        classes = await batchQuery(
          "class_entity",
          "class_id, name, schedule, end_date",
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
      const memberName = `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim();
      
      // 1. Get enrollments specific to THIS swimmer
      const memberEnrollments = enrollments.filter(e => e.member_id === member.member_id);
      console.log(`[DEBUG] Processing swimmer: ${memberName}, enrollments: ${memberEnrollments.length}`);

      // 2. Determine if the swimmer needs an evaluation
      const needsEvaluation = memberEnrollments.some(enrol => {
        const classData = classes.find(c => c.class_id === enrol.class_id);
        const isMySection = instructorGroupIds.has(enrol.group_id);
        
        console.log(`  [ENROLLMENT] classData exists: ${!!classData}, has end_date: ${!!classData?.end_date}, isMySection: ${isMySection}`);
        
        if (!classData?.end_date || !isMySection) {
          console.log(`    → Returning false early (no classData.end_date or not my section)`);
          return false;
        }

        // Date Calculation logic
        const endDate = new Date(classData.end_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Normalize to start of day
        endDate.setHours(0, 0, 0, 0); // Normalize to start of day
        const diffTime = endDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        // Check if there's already a recent evaluation for this class FIRST
        const recentEval = evaluations.find(
          e => e.member_id === member.member_id && e.class_id === enrol.class_id
        );
        
        if (recentEval) {
          // There's an evaluation - check if it's within 14 days
          const evalDate = new Date(recentEval.evaluation_date);
          evalDate.setHours(0, 0, 0, 0);
          const evalDiffTime = today.getTime() - evalDate.getTime();
          const evalDiffDays = Math.ceil(evalDiffTime / (1000 * 60 * 60 * 24));
          
          // If eval is recent (within 14 days), don't need new one
          if (evalDiffDays <= 14) {
            return false;
          }
        }

        // Then check if class is ending within next 3 days
        if (diffDays <= 3 && diffDays >= 0) return true;

        // Or if class ended within last 14 days
        if (diffDays < 0 && diffDays >= -14) {
          return true; // No recent evaluation found
        }

        return false;
      });

      const memberSkills: DashboardSkillPayload[] = (orgSkills ?? []).map(
        (skill) => {
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
        },
      );
 
      console.log(`  → Final needsEvaluation for ${memberName}: ${needsEvaluation}`);

      return {
        id: member.member_id,
        name:
          `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim() ||
          "Unnamed swimmer",
        classes: classesByMemberId.get(member.member_id) ?? [],
        skills: memberSkills,
        needsEvaluation,
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
 