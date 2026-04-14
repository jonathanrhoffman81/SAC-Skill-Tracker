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
}

interface DashboardPayload {
  userName: string;
  organizationName: string;
  swimmers: DashboardSwimmerPayload[];
  organizationLogoUrl: string | null;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

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

function getOrganizationLogoUrl(organizationId: string | undefined) {
  if (!organizationId) return null;

  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;

  return `${baseUrl}/storage/v1/object/public/organization-logos/${organizationId}/logo.png`;
}

const INSTRUCTOR_ROUTE_ROLE_SET = new Set([
  "instructor",
  "admin",
  "super-admin",
  "superadmin",
]);

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

async function buildDashboardFallback(
  email: string,
  page: number,
  searchQuery: string,
): Promise<DashboardPayload> {
  const supabaseAdmin = getSupabaseAdminClient();

  const { data: person, error: personError } = await supabaseAdmin
    .from("person")
    .select("person_id, first_name, last_name, email")
    .ilike("email", email)
    .maybeSingle();

  if (personError) {
    throw new Error(`Failed to load person: ${personError.message}`);
  }

  if (!person) {
    throw new Error(`No instructor found for email ${email}`);
  }

  const userName =
    `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim() ||
    person.email;

  const [
    { data: personOrg, error: personOrgError },
    { data: instructorGroups, error: instructorGroupsError },
  ] = await Promise.all([
    supabaseAdmin
      .from("person_organization")
      .select("organization_id")
      .eq("person_id", person.person_id)
      .maybeSingle(),
    supabaseAdmin
      .from("group_instructor")
      .select("group_id")
      .eq("instructor_person_id", person.person_id),
  ]);

  if (personOrgError) {
    throw new Error(
      `Failed to load organization membership: ${personOrgError.message}`,
    );
  }

  if (instructorGroupsError) {
    throw new Error(
      `Failed to load instructor groups: ${instructorGroupsError.message}`,
    );
  }

  const organizationId = personOrg?.organization_id;
  if (!organizationId) {
    return {
      userName,
      organizationName: "SAC Skill Tracker",
      organizationLogoUrl: getOrganizationLogoUrl(organizationId),
      swimmers: [],
      pagination: buildPagination(page, PAGE_SIZE, 0),
    };
  }

  const { data: organization, error: organizationError } = await supabaseAdmin
    .from("organization")
    .select("name")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (organizationError) {
    throw new Error(
      `Failed to load organization: ${organizationError.message}`,
    );
  }

  const groupIds = Array.from(
    new Set((instructorGroups ?? []).map((row) => row.group_id)),
  );

  const [
    { data: orgSkills, error: orgSkillsError },
    { data: groupRows, error: groupRowsError },
  ] = await Promise.all([
    supabaseAdmin
      .from("skill")
      .select("skill_id, name")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true }),
    groupIds.length
      ? supabaseAdmin
        .from("class_group")
        .select("group_id, class_id, name")
        .in("group_id", groupIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (orgSkillsError) {
    throw new Error(`Failed to load skills: ${orgSkillsError.message}`);
  }

  if (groupRowsError) {
    throw new Error(`Failed to load class groups: ${groupRowsError.message}`);
  }

  const visibleGroupIds = Array.from(
    new Set((groupRows ?? []).map((row) => row.group_id).filter(Boolean)),
  );

  const { data: enrollments, error: enrollmentsError } = visibleGroupIds.length
    ? await supabaseAdmin
      .from("enrollment")
      .select("member_id, class_id, group_id")
      .in("group_id", visibleGroupIds)
    : { data: [], error: null };

  if (enrollmentsError) {
    throw new Error(`Failed to load enrollments: ${enrollmentsError.message}`);
  }

  const classIds = Array.from(
    new Set((enrollments ?? []).map((row) => row.class_id).filter(Boolean)),
  );
  const enrollmentMemberIds = Array.from(
    new Set((enrollments ?? []).map((row) => row.member_id).filter(Boolean)),
  );

  const { data: enrollmentMembers, error: enrollmentMembersError } =
    enrollmentMemberIds.length > 0
      ? await supabaseAdmin
        .from("member")
        .select("member_id, slot")
        .in("member_id", enrollmentMemberIds)
      : { data: [], error: null };

  if (enrollmentMembersError) {
    throw new Error(
      `Failed to load member slots: ${enrollmentMembersError.message}`,
    );
  }

  const slotByMemberId = new Map(
    (enrollmentMembers ?? []).map((row) => [row.member_id, row.slot]),
  );

  const accessibleEnrollments = (enrollments ?? []).filter((row) => {
    if (!row.class_id) return false;
    const allowedSlots = allowedSlotsByClassId.get(row.class_id);
    if (!allowedSlots) return false;
    const memberSlot = slotByMemberId.get(row.member_id);
    if (memberSlot === null || memberSlot === undefined) return false;
    return allowedSlots.has(memberSlot);
  });

  const memberIds = Array.from(
    new Set(accessibleEnrollments.map((row) => row.member_id)),
  );

  if (memberIds.length === 0) {
    return {
      userName,
      organizationName: organization?.name || "SAC Skill Tracker",
      organizationLogoUrl: getOrganizationLogoUrl(organizationId),
      swimmers: [],
      pagination: buildPagination(page, PAGE_SIZE, 0),
    };
  }

  let memberCountQuery = supabaseAdmin
    .from("member")
    .select("member_id", { count: "exact", head: true })
    .in("member_id", memberIds);

  if (searchQuery) {
    memberCountQuery = memberCountQuery.or(
      `first_name.ilike.%${searchQuery}%,last_name.ilike.%${searchQuery}%`,
    );
  }

  const { count: totalCount, error: memberCountError } = await memberCountQuery;
  if (memberCountError) {
    throw new Error(`Failed to count members: ${memberCountError.message}`);
  }

  const pagination = buildPagination(page, PAGE_SIZE, totalCount ?? 0);
  const from = (pagination.page - 1) * pagination.pageSize;
  const to = from + pagination.pageSize - 1;

  let pagedMembersQuery = supabaseAdmin
    .from("member")
    .select("member_id, first_name, last_name")
    .in("member_id", memberIds)
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
    throw new Error(`Failed to load members: ${membersError.message}`);
  }

  const pagedMemberIds = (members ?? []).map((member) => member.member_id);
  if (pagedMemberIds.length === 0) {
    return {
      userName,
      organizationName: organization?.name || "SAC Skill Tracker",
      organizationLogoUrl: getOrganizationLogoUrl(organizationId),
      swimmers: [],
      pagination,
    };
  }

  const { data: memberSkillRows, error: memberSkillError } = await supabaseAdmin
    .from("member_skill")
    .select("member_id, skill_id, progress, date_acquired")
    .in("member_id", pagedMemberIds);

  if (memberSkillError) {
    throw new Error(
      `Failed to load member skills: ${memberSkillError.message}`,
    );
  }

  const { data: pagedEnrollments, error: pagedEnrollmentsError } = classIds.length
    ? await supabaseAdmin
      .from("enrollment")
      .select("member_id, class_id")
      .in("member_id", pagedMemberIds)
      .in("class_id", classIds)
    : { data: [], error: null };

  if (pagedEnrollmentsError) {
    throw new Error(
      `Failed to load enrollments: ${pagedEnrollmentsError.message}`,
    );
  }

  const { data: pagedMemberSlots, error: pagedMemberSlotsError } =
    pagedMemberIds.length > 0
      ? await supabaseAdmin
        .from("member")
        .select("member_id, slot")
        .in("member_id", pagedMemberIds)
      : { data: [], error: null };

  if (pagedMemberSlotsError) {
    throw new Error(
      `Failed to load member slots: ${pagedMemberSlotsError.message}`,
    );
  }

  const pagedSlotByMemberId = new Map(
    (pagedMemberSlots ?? []).map((row) => [row.member_id, row.slot]),
  );

  const filteredPagedEnrollments = (pagedEnrollments ?? []).filter((row) => {
    if (!row.class_id) return false;
    const allowedSlots = allowedSlotsByClassId.get(row.class_id);
    if (!allowedSlots) return false;
    const memberSlot = pagedSlotByMemberId.get(row.member_id);
    if (memberSlot === null || memberSlot === undefined) return false;
    return allowedSlots.has(memberSlot);
  });

  const pagedClassIds = Array.from(
    new Set(filteredPagedEnrollments.map((row) => row.class_id)),
  );
  let pagedClasses: Array<{
    class_id: string;
    name: string;
    schedule: string | null;
  }> = [];

  if (pagedClassIds.length > 0) {
    const { data: classesData, error: classesError } = await supabaseAdmin
      .from("class_entity")
      .select("class_id, name, schedule")
      .in("class_id", pagedClassIds);

    if (classesError) {
      throw new Error(`Failed to load classes: ${classesError.message}`);
    }

    pagedClasses = classesData ?? [];
  }

  const classById = new Map<string, DashboardClassPayload>();
  pagedClasses.forEach((row) => {
    classById.set(row.class_id, {
      id: row.class_id,
      name: row.name,
      schedule: row.schedule ?? "Schedule TBD",
    });
  });

  const classesByMemberId = new Map<string, DashboardClassPayload[]>();
  filteredPagedEnrollments.forEach((row) => {
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

  const swimmers = (members ?? [])
    .map((member) => {
      const swimmerSkills: DashboardSkillPayload[] = (orgSkills ?? []).map(
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

      return {
        id: member.member_id,
        name:
          `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim() ||
          "Unnamed swimmer",
        classes: classesByMemberId.get(member.member_id) ?? [],
        skills: swimmerSkills,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    userName,
    organizationName: organization?.name || "SAC Skill Tracker",
    organizationLogoUrl: getOrganizationLogoUrl(organizationId),
    swimmers,
    pagination,
  };
}

async function resolveInstructorEmail(
  request: NextRequest,
): Promise<{ email: string; source: "session" | "email" }> {
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
        "FORBIDDEN:You do not have access to the instructor dashboard.",
      );
    }

    return { email: sessionPerson.email, source: "session" };
  }

  const email = request.nextUrl.searchParams.get("email");
  if (!email) {
    throw new Error("Missing required query param: email");
  }

  return { email, source: "email" };
}

export async function GET(request: NextRequest) {
  try {
    const page = parsePage(request);
    const searchQuery = parseSearchQuery(request);
    const { email } = await resolveInstructorEmail(request);

    const fallbackPayload = await buildDashboardFallback(
      email,
      page,
      searchQuery,
    );
    return NextResponse.json(fallbackPayload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error";
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
