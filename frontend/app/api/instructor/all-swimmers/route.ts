import { NextRequest, NextResponse } from "next/server";
import {
  AuthContextError,
  getCurrentPersonFromRequest,
} from "@/lib/serverAuth";
import { normalizeRole } from "@/lib/authRoles";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getCachedOrRevalidate } from "@/lib/serverRouteCache";

interface DashboardClassPayload {
  id: string;
  name: string;
  schedule: string;
  slot?: number | null;
  startDate?: string;
  endDate?: string;
}

interface DashboardSkillPayload {
  id: string;
  name: string;
  progress: 0 | 1 | 2 | 3 | 4;
  // True only when the swimmer has an actual member_skill row for this
  // skill. Lets the UI distinguish "evaluated as 0" from "never evaluated"
  // (both surface as progress=0 otherwise).
  hasProgressHistory: boolean;
  mastered: boolean;
  dateAcquired?: string;
}

interface DashboardSwimmerPayload {
  id: string;
  name: string;
  classes: DashboardClassPayload[];
  skills: DashboardSkillPayload[];
  isActive?: boolean;
  hasCurrentInstructorEvaluation?: boolean;
  classEvaluations?: Array<{
    classId: string;
    evaluationCount: number;
    generalNoteCount: number;
    skillNoteCount: number;
    lastEvaluationDate?: string;
    latestGeneralNote?: string;
    instructors: string[];
    recentEntries: Array<{
      evaluationId: string;
      date: string;
      instructor: string;
      skillName?: string;
      feedback?: string;
      isSkillNote: boolean;
    }>;
  }>;
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
  isMySwimmer?: boolean;
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
const CACHE_MAX_AGE_MS = 20 * 1000;
const CACHE_STALE_REVALIDATE_MS = 2 * 60 * 1000;

async function timed<T>(label: string, operation: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    return await operation();
  } finally {
    const durationMs = Date.now() - startedAt;
    console.info(`[all-swimmers] ${label} took ${durationMs}ms`);
  }
}

function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const code = (error as { code?: string }).code;
  if (code === "42P01") return true;

  const message = String((error as { message?: string }).message ?? "").toLowerCase();
  return message.includes("does not exist") || message.includes("relation") || message.includes("undefined table");
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const candidate = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
      error?: unknown;
    };

    const pieces = [
      typeof candidate.message === "string" ? candidate.message : "",
      typeof candidate.details === "string" ? candidate.details : "",
      typeof candidate.hint === "string" ? candidate.hint : "",
      typeof candidate.code === "string" ? `code=${candidate.code}` : "",
      typeof candidate.error === "string" ? candidate.error : "",
    ].filter(Boolean);

    if (pieces.length > 0) {
      return pieces.join(" | ");
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return String(error);
}

function normalizeInstructorIds(rawValue: unknown): string[] {
  if (Array.isArray(rawValue)) {
    return rawValue
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
  }

  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      return trimmed
        .slice(1, -1)
        .split(",")
        .map((item) => item.replace(/^"|"$/g, "").trim())
        .filter(Boolean);
    }

    return [trimmed];
  }

  return [];
}

function withCacheHeaders(response: NextResponse, cacheStatus: string) {
  response.headers.set("Cache-Control", "private, max-age=20, stale-while-revalidate=120");
  response.headers.set("X-Cache-Status", cacheStatus);
  return response;
}

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

function formatEmailToName(email?: string | null): string | undefined {
  if (!email) return undefined;
  const local = String(email).split("@")[0];
  // Replace common separators with spaces, split into words and title-case them
  const words = local.replace(/[._\-]+/g, " ").split(" ").filter(Boolean);
  if (words.length === 0) return undefined;
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function normalizeProgress(
  value: number | null | undefined,
): 0 | 1 | 2 | 3 | 4 {
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
      formatEmailToName(person.email) || person.email;

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

    // Load members taught by this instructor
    let mySwimmerIds = new Set<string>();
    try {
      const { data: groupInstructorRows } = await supabaseAdmin
        .from("group_instructor")
        .select("group_id")
        .eq("instructor_person_id", person.person_id);

      if (groupInstructorRows && groupInstructorRows.length > 0) {
        const groupIds = groupInstructorRows.map((row: any) => row.group_id);
        const { data: enrollmentRows } = await supabaseAdmin
          .from("enrollment")
          .select("member_id")
          .in("group_id", groupIds);

        if (enrollmentRows) {
          mySwimmerIds = new Set(enrollmentRows.map((row: any) => row.member_id));
        }
      }
    } catch (error) {
      console.warn("Failed to load instructor's swimmers:", error);
    }

    const buildPayload = async (): Promise<DashboardPayload> => {
      let pagination = buildPagination(page, PAGE_SIZE, 0);
      let members: Array<{ member_id: string; first_name: string | null; last_name: string | null; is_active?: boolean | null }> = [];

      if (fetchAll) {
        let allMembersQuery = supabaseAdmin
          .from("member")
          .select("member_id, first_name, last_name, is_active")
          .eq("organization_id", organizationId)
          .order("first_name", { ascending: true })
          .order("last_name", { ascending: true });

        if (searchQuery) {
          allMembersQuery = allMembersQuery.or(
            `first_name.ilike.%${searchQuery}%,last_name.ilike.%${searchQuery}%`,
          );
        }

        const allMembersResult = await timed<any>(
          "load-members-all",
          async () => await allMembersQuery,
        );
        const { data: allMembers, error: allMembersError } = allMembersResult;
        if (allMembersError) {
          console.error("Members error:", allMembersError);
          throw new Error(`Failed to load members: ${allMembersError.message}`);
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

        const memberCountResult = await timed<any>(
          "count-members",
          async () => await memberCountQuery,
        );
        const { count: totalCount, error: memberCountError } = memberCountResult;
        if (memberCountError) {
          console.error("Member count error:", memberCountError);
          throw new Error(`Failed to count members: ${memberCountError.message}`);
        }

        pagination = buildPagination(page, PAGE_SIZE, totalCount ?? 0);
        const from = (pagination.page - 1) * pagination.pageSize;
        const to = from + pagination.pageSize - 1;

        let pagedMembersQuery = supabaseAdmin
          .from("member")
          .select("member_id, first_name, last_name, is_active")
          .eq("organization_id", organizationId)
          .order("first_name", { ascending: true })
          .order("last_name", { ascending: true })
          .range(from, to);

        if (searchQuery) {
          pagedMembersQuery = pagedMembersQuery.or(
            `first_name.ilike.%${searchQuery}%,last_name.ilike.%${searchQuery}%`,
          );
        }

        const pagedMembersResult = await timed<any>(
          "load-members-page",
          async () => await pagedMembersQuery,
        );
        const { data: pagedMembers, error: membersError } = pagedMembersResult;

        if (membersError) {
          console.error("Members error:", membersError);
          throw new Error(`Failed to load members: ${membersError.message}`);
        }

        members = pagedMembers ?? [];
      }

      if (!members || members.length === 0) {
        return {
          userName,
          organizationName: organization?.name || "SAC Skill Tracker",
          swimmers: [],
          pagination,
        } as DashboardPayload;
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

      async function batchQueryOptional(
        table: string,
        selectStr: string,
        ids: string[],
        filterColumn: string,
      ): Promise<any[] | null> {
        try {
          return await batchQuery(table, selectStr, ids, filterColumn);
        } catch (error) {
          if (isMissingRelationError(error)) {
            console.warn(
              `[all-swimmers] Optional relation unavailable (${table}); falling back to base-table summary computation.`,
            );
            return null;
          }

          throw error;
        }
      }

      const loadOrgSkillsPromise = !lightweight
        ? supabaseAdmin
          .from("skill")
          .select("skill_id, name, display_order")
          .eq("organization_id", organizationId)
          .order("display_order", { ascending: true, nullsFirst: false })
          .order("name", { ascending: true })
        : supabaseAdmin
          .from("skill")
          .select("skill_id", { count: "exact", head: true })
          .eq("organization_id", organizationId);

      const loadMemberSkillRowsPromise =
        !lightweight && memberIds.length > 0
          ? batchQuery(
            "member_skill_current",
            "member_id, skill_id, progress, date_acquired",
            memberIds,
            "member_id",
          )
          : Promise.resolve([] as any[]);

      const loadMemberSkillSummaryPromise =
        lightweight && memberIds.length > 0
          ? batchQueryOptional(
            "member_skill_summary_mv",
            "member_id, mastered_skills, avg_progress_percent",
            memberIds,
            "member_id",
          )
          : Promise.resolve([] as any[] | null);

      const loadEnrollmentsPromise =
        memberIds.length > 0
          ? batchQuery("enrollment", "member_id, class_id, group_id, slot", memberIds, "member_id")
          : Promise.resolve([] as any[]);

      const loadEvaluationRowsPromise =
        !lightweight && memberIds.length > 0
          ? batchQuery(
            "evaluation",
            "evaluation_id, member_id, class_id, skill_id, feedback, evaluation_date, instructor_person_id",
            memberIds,
            "member_id",
          )
          : Promise.resolve([] as any[]);

      const loadEvaluationSummaryPromise =
        lightweight && memberIds.length > 0
          ? batchQueryOptional(
            "member_evaluation_summary_mv",
            "member_id, evaluation_count, last_evaluation_date, instructor_person_ids",
            memberIds,
            "member_id",
          )
          : Promise.resolve([] as any[] | null);

      let orgSkills: Array<{ skill_id: string; name: string }> = [];
      let totalOrgSkills = 0;
      let memberSkillRows: any[] = [];
      let memberSkillSummaryRows: any[] | null = [];
      let enrollments: any[] = [];
      let evaluationRows: any[] = [];
      let evaluationSummaryRows: any[] | null = [];

      try {
        const [
          orgSkillsResult,
          loadedMemberSkills,
          loadedMemberSkillSummaries,
          loadedEnrollments,
          loadedEvaluations,
          loadedEvaluationSummaries,
        ] =
          await timed("parallel-core-data", () => Promise.all([
            loadOrgSkillsPromise,
            loadMemberSkillRowsPromise,
            loadMemberSkillSummaryPromise,
            loadEnrollmentsPromise,
            loadEvaluationRowsPromise,
            loadEvaluationSummaryPromise,
          ]));

        if (!lightweight) {
          const skillRows = (orgSkillsResult as { data: Array<{ skill_id: string; name: string }> | null; error: any }).data;
          const orgSkillsError = (orgSkillsResult as { data: Array<{ skill_id: string; name: string }> | null; error: any }).error;

          if (orgSkillsError) {
            console.error("Org skills error:", orgSkillsError);
            throw new Error(`Failed to load skills: ${orgSkillsError.message}`);
          }

          orgSkills = skillRows ?? [];
          totalOrgSkills = orgSkills.length;
        } else {
          const skillCount = (orgSkillsResult as { count: number | null; error: any }).count;
          const skillCountError = (orgSkillsResult as { count: number | null; error: any }).error;

          if (skillCountError) {
            console.error("Org skill count error:", skillCountError);
            throw new Error(`Failed to count skills: ${skillCountError.message}`);
          }

          totalOrgSkills = skillCount ?? 0;
        }

        memberSkillRows = loadedMemberSkills;
        memberSkillSummaryRows = loadedMemberSkillSummaries;
        enrollments = loadedEnrollments;
        evaluationRows = loadedEvaluations;
        evaluationSummaryRows = loadedEvaluationSummaries;

        if (lightweight && memberIds.length > 0 && memberSkillSummaryRows === null) {
          memberSkillRows = await timed("fallback-member-skill-rows", () =>
            batchQuery(
              "member_skill_current",
              "member_id, skill_id, progress, date_acquired",
              memberIds,
              "member_id",
            ),
          );
          memberSkillSummaryRows = [];
        }

        if (lightweight && memberIds.length > 0 && evaluationSummaryRows === null) {
          evaluationRows = await timed("fallback-evaluation-rows", () =>
            batchQuery(
              "evaluation",
              "evaluation_id, member_id, class_id, skill_id, feedback, evaluation_date, instructor_person_id",
              memberIds,
              "member_id",
            ),
          );
          evaluationSummaryRows = [];
        }
      } catch (error) {
        console.error("Parallel instructor dashboard query error:", error);
        throw new Error(
          `Failed to load evaluation data: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      console.log(
        `Retrieved ${memberSkillRows.length} member skill rows, ${(memberSkillSummaryRows ?? []).length} skill summary rows, ${evaluationRows.length} evaluation rows, and ${(evaluationSummaryRows ?? []).length} evaluation summary rows`,
      );

      const classIds = Array.from(
        new Set((enrollments ?? []).map((e) => e.class_id)),
      );

      // Get classes in batches
      let classes: any[] = [];
      if (classIds.length > 0) {
        try {
          classes = await timed("load-classes", () => batchQuery(
            "class_entity",
            "class_id, name, schedule, start_date, end_date",
            classIds,
            "class_id",
          ));
        } catch (error) {
          console.error("Classes error:", error);
          throw new Error(
            `Failed to load classes: ${error instanceof Error ? error.message : String(error)}`,
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
          (!lightweight
            ? (evaluationRows ?? []).flatMap((evaluation) =>
              normalizeInstructorIds(evaluation.instructor_person_id),
            )
            : (evaluationSummaryRows ?? []).flatMap((evaluation) =>
              normalizeInstructorIds(evaluation.instructor_person_ids),
            ))
            .filter(Boolean),
        ),
      );

      const instructorNameById = new Map<string, string>();
      if (instructorIds.length > 0) {
        try {
          const instructors = await timed("load-instructor-names", () => batchQuery(
            "person",
            "person_id, first_name, last_name, email",
            instructorIds,
            "person_id",
          ));

          instructors.forEach((row: any) => {
            const composed = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
            const fallback = composed || formatEmailToName(row.email) || "Instructor";
            // Map both the person_id (usual case) and email (some rows store email)
            if (row.person_id) instructorNameById.set(row.person_id, fallback);
            if (row.email) instructorNameById.set(row.email, fallback);
          });
        } catch (error) {
          console.error(
            "Instructor names lookup failed; continuing without instructor name labels:",
            formatUnknownError(error),
          );
        }
      }

      // Build assigned-instructor map from group_instructor so swimmers show their
      // instructor even before any evaluations have been saved.
      const assignedInstructorNamesByMemberId = new Map<string, string[]>();
      try {
        const groupIds = Array.from(
          new Set(
            (enrollments ?? []).map((e: any) => e.group_id).filter(Boolean),
          ),
        ) as string[];

        if (groupIds.length > 0) {
          const groupInstructorRows = await batchQuery(
            "group_instructor",
            "group_id, instructor_person_id",
            groupIds,
            "group_id",
          );

          const assignedInstructorIds = Array.from(
            new Set(
              groupInstructorRows
                .map((r: any) => r.instructor_person_id)
                .filter(Boolean),
            ),
          ) as string[];

          // Load names for any instructors not already in instructorNameById
          const missingIds = assignedInstructorIds.filter((id) => !instructorNameById.has(id));
          if (missingIds.length > 0) {
            const missingPersonRows = await batchQuery("person", "person_id, first_name, last_name", missingIds, "person_id");
            missingPersonRows.forEach((row: any) => {
              instructorNameById.set(
                row.person_id,
                `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "Instructor",
              );
            });
          }

          // Map group_id → instructor_person_ids
          const instructorIdsByGroupId = new Map<string, string[]>();
          groupInstructorRows.forEach((row: any) => {
            if (!row.group_id || !row.instructor_person_id) return;
            const existing = instructorIdsByGroupId.get(row.group_id) ?? [];
            existing.push(row.instructor_person_id);
            instructorIdsByGroupId.set(row.group_id, existing);
          });

          // Map member_id → assigned instructor names via enrollment group_id
          (enrollments ?? []).forEach((row: any) => {
            if (!row.group_id) return;
            const instructorIds = instructorIdsByGroupId.get(row.group_id) ?? [];
            instructorIds.forEach((instructorId) => {
              const name = instructorNameById.get(instructorId);
              if (!name) return;
              const existing = assignedInstructorNamesByMemberId.get(row.member_id) ?? [];
              if (!existing.includes(name)) existing.push(name);
              assignedInstructorNamesByMemberId.set(row.member_id, existing);
            });
          });
        }
      } catch (err) {
        console.warn("[all-swimmers] Failed to load group instructor assignments:", err);
      }

      const evaluationSummaryByMemberId = new Map<
        string,
        { evaluationCount: number; lastEvaluationDate?: string; instructors: string[] }
      >();
      const classEvaluationSummaryByMemberId = new Map<
        string,
        Map<
          string,
          {
            evaluationCount: number;
            generalNoteCount: number;
            skillNoteCount: number;
            lastEvaluationDate?: string;
            latestGeneralNote?: string;
            instructors: string[];
            recentEntries: Array<{
              evaluationId: string;
              date: string;
              instructor: string;
              skillName?: string;
              feedback?: string;
              isSkillNote: boolean;
            }>;
          }
        >
      >();
      const currentInstructorEvaluatedMemberIds = new Set<string>();

      if (!lightweight) {
        (evaluationRows ?? []).forEach((row) => {
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

          if (row.instructor_person_id === person.person_id) {
            currentInstructorEvaluatedMemberIds.add(row.member_id);
          }

          evaluationSummaryByMemberId.set(row.member_id, existing);

          if (row.class_id) {
            const memberClassSummary =
              classEvaluationSummaryByMemberId.get(row.member_id) ??
              new Map<
                string,
                {
                  evaluationCount: number;
                  generalNoteCount: number;
                  skillNoteCount: number;
                  lastEvaluationDate?: string;
                  latestGeneralNote?: string;
                  instructors: string[];
                  recentEntries: Array<{
                    evaluationId: string;
                    date: string;
                    instructor: string;
                    skillName?: string;
                    feedback?: string;
                    isSkillNote: boolean;
                  }>;
                }
              >();

            const existingClassSummary = memberClassSummary.get(row.class_id) ?? {
              evaluationCount: 0,
              generalNoteCount: 0,
              skillNoteCount: 0,
              lastEvaluationDate: undefined,
              latestGeneralNote: undefined,
              instructors: [],
              recentEntries: [],
            };

            existingClassSummary.evaluationCount += 1;
            if (row.skill_id) {
              existingClassSummary.skillNoteCount += 1;
            } else {
              existingClassSummary.generalNoteCount += 1;
              if (!existingClassSummary.latestGeneralNote && row.feedback) {
                existingClassSummary.latestGeneralNote = row.feedback;
              }
            }

            if (row.evaluation_date) {
              const currentLastClassDate = existingClassSummary.lastEvaluationDate
                ? new Date(existingClassSummary.lastEvaluationDate)
                : null;
              const incomingClassDate = new Date(row.evaluation_date);

              if (!currentLastClassDate || incomingClassDate > currentLastClassDate) {
                existingClassSummary.lastEvaluationDate = row.evaluation_date;
                if (!row.skill_id && row.feedback) {
                  existingClassSummary.latestGeneralNote = row.feedback;
                }
              }
            }

            const classInstructorName = instructorNameById.get(row.instructor_person_id);
            if (classInstructorName && !existingClassSummary.instructors.includes(classInstructorName)) {
              existingClassSummary.instructors.push(classInstructorName);
            }

            // Cap raised from 4 to 100: a single evaluation session can produce
            // many skill notes (one per skill) plus an anchor row, and capping
            // low silently dropped notes from the dashboard view.
            if (existingClassSummary.recentEntries.length < 100) {
              const skillName = row.skill_id
                ? orgSkills.find((skill) => skill.skill_id === row.skill_id)?.name
                : undefined;
              existingClassSummary.recentEntries.push({
                evaluationId: row.evaluation_id,
                date: formatDate(row.evaluation_date) ?? "Date unknown",
                instructor: classInstructorName ?? "Instructor",
                skillName,
                feedback: row.feedback ?? undefined,
                isSkillNote: Boolean(row.skill_id),
              });
            }

            memberClassSummary.set(row.class_id, existingClassSummary);
            classEvaluationSummaryByMemberId.set(row.member_id, memberClassSummary);
          }
        });
      } else {
        (evaluationSummaryRows ?? []).forEach((row) => {
          const instructorNames = normalizeInstructorIds(row.instructor_person_ids)
            .map((personId) => instructorNameById.get(personId))
            .filter((name): name is string => Boolean(name));

          if (normalizeInstructorIds(row.instructor_person_ids).includes(person.person_id)) {
            currentInstructorEvaluatedMemberIds.add(row.member_id);
          }

          evaluationSummaryByMemberId.set(row.member_id, {
            evaluationCount: Number(row.evaluation_count ?? 0),
            lastEvaluationDate: row.last_evaluation_date ?? undefined,
            instructors: instructorNames,
          });
        });
      }

      const classesByMemberId = new Map<string, DashboardClassPayload[]>();
      (enrollments ?? []).forEach((row) => {
        const classItem = classById.get(row.class_id);
        if (!classItem) return;

        const existing = classesByMemberId.get(row.member_id) ?? [];
        if (!existing.some((item) => item.id === classItem.id)) {
          existing.push({
            ...classItem,
            slot: row.slot ?? null,
          });
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

      if (!lightweight) {
        (memberSkillRows ?? []).forEach((row) => {
          const existing = skillSummaryByMemberId.get(row.member_id) ?? {
            masteredSkills: 0,
            totalProgressPercent: 0,
          };

          const progress = Number(row.progress ?? 0);
          const normalizedProgress = normalizeProgress(progress);
          existing.totalProgressPercent += Number.isFinite(progress) ? normalizedProgress * 25 : 0;
          if (normalizedProgress === 4 || Boolean(row.date_acquired)) {
            existing.masteredSkills += 1;
          }

          skillSummaryByMemberId.set(row.member_id, existing);
        });
      } else {
        (memberSkillSummaryRows ?? []).forEach((row) => {
          const avgProgress = Number(row.avg_progress_percent ?? 0);
          skillSummaryByMemberId.set(row.member_id, {
            masteredSkills: Number(row.mastered_skills ?? 0),
            totalProgressPercent: totalOrgSkills > 0 ? avgProgress * totalOrgSkills : 0,
          });
        });
      }

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
              hasProgressHistory: Boolean(memberSkill),
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
          isActive: member.is_active ?? true,
          classEvaluations: Array.from(
            (classEvaluationSummaryByMemberId.get(member.member_id) ?? new Map()).entries(),
          ).map(([classId, summary]) => ({
            classId,
            evaluationCount: summary.evaluationCount,
            generalNoteCount: summary.generalNoteCount,
            skillNoteCount: summary.skillNoteCount,
            lastEvaluationDate: formatDate(summary.lastEvaluationDate),
            latestGeneralNote: summary.latestGeneralNote,
            instructors: summary.instructors,
            recentEntries: summary.recentEntries,
          })),
          evaluationSummary: {
            evaluationCount:
              evaluationSummaryByMemberId.get(member.member_id)?.evaluationCount ?? 0,
            lastEvaluationDate: formatDate(
              evaluationSummaryByMemberId.get(member.member_id)?.lastEvaluationDate,
            ),
            instructors: Array.from(
              new Set([
                ...(evaluationSummaryByMemberId.get(member.member_id)?.instructors ?? []),
                ...(assignedInstructorNamesByMemberId.get(member.member_id) ?? []),
              ]),
            ),
          },
          hasCurrentInstructorEvaluation: currentInstructorEvaluatedMemberIds.has(member.member_id),
          isMySwimmer: mySwimmerIds.has(member.member_id),
        };
      });

      const payload: DashboardPayload = {
        userName,
        organizationName: organization?.name || "SAC Skill Tracker",
        swimmers,
        pagination,
      };

      return payload;
    };

    const cacheEligible = fetchAll && lightweight;
    if (cacheEligible) {
      const cacheKey = `instructor-all-swimmers:${organizationId}:person=${person.person_id}:q=${searchQuery.toLowerCase()}`;
      const { value, cacheStatus } = await getCachedOrRevalidate({
        key: cacheKey,
        maxAgeMs: CACHE_MAX_AGE_MS,
        staleWhileRevalidateMs: CACHE_STALE_REVALIDATE_MS,
        loader: buildPayload,
      });

      return withCacheHeaders(NextResponse.json(value), cacheStatus);
    }

    const payload = await buildPayload();
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
