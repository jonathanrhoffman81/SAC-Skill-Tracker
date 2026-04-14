import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export interface SwimmerProfileNote {
  id: string;
  date: string;
  content: string;
  author: string;
}

export interface SessionClassItem {
  id: string;
  name: string;
  schedule: string;
}

export interface SessionSkillItem {
  id: string;
  name: string;
  mastered: boolean;
  progress: number;
  dateAcquired?: string;
  obtainedInSession?: boolean;
  notes: SwimmerProfileNote[];
}

export interface SessionPayload {
  id: string;
  name: string;
  startDate?: string;
  endDate?: string;
  isCurrent: boolean;
  isSynthetic: boolean;
  classes: SessionClassItem[];
  skills: SessionSkillItem[];
  sessionNotes: SwimmerProfileNote[];
  summary: {
    progressPct: number;
    masteredCount: number;
    totalSkills: number;
    noteCount: number;
  };
}

export interface SwimmerProfilePayload {
  swimmer: {
    id: string;
    name: string;
    age: number | null;
    enrollmentDate: string;
    organization: string;
  };
  sessions: SessionPayload[];
  defaultSessionId: string;
}

interface MemberSkillCurrentRow {
  member_skill_id: string;
  member_id: string;
  skill_id: string;
  progress: number | null;
  date_acquired: string | null;
  updated_at: string | null;
}

interface MemberSkillHistoryRow {
  member_skill_id: string;
  member_id: string;
  skill_id: string;
  progress: number | null;
  date_acquired: string | null;
  updated_at: string | null;
}

interface EvaluationRow {
  evaluation_id: string;
  member_id: string;
  feedback: string | null;
  evaluation_date: string;
  instructor_person_id: string;
  skill_id: string | null;
  class_id: string | null;
}


interface MemberRow {
  member_id: string;
  organization_id: string;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  created_at: string;
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

function isSkillFormattedFeedback(feedback?: string | null): boolean {
  if (!feedback) return false;
  return /skill\s*notes?:|^\s*skill\s*:/im.test(feedback);
}

function isDateWithinSession(
  dateValue: string,
  sessionStartDate: string,
  sessionEndDate: string,
) {
  return dateValue >= sessionStartDate && dateValue <= sessionEndDate;
}

function toUtcEndOfDayMillis(dateValue: string): number {
  const [year, month, day] = dateValue.split("-").map(Number);
  return Date.UTC(year, month - 1, day, 23, 59, 59, 999);
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

function computeSummary(
  skills: SessionSkillItem[],
  sessionNotes: SwimmerProfileNote[],
) {
  const totalSkills = skills.length;
  const masteredCount = skills.filter((skill) => skill.mastered).length;
  const progressPct =
    totalSkills === 0
      ? 0
      : Math.round(
        (skills.reduce((total, skill) => total + skill.progress, 0) /
          (totalSkills * 4)) *
        100,
      );
  const noteCount =
    sessionNotes.length +
    skills.reduce((total, skill) => total + skill.notes.length, 0);

  return {
    progressPct,
    masteredCount,
    totalSkills,
    noteCount,
  };
}

function buildNoteEntry(
  row: EvaluationRow,
  authorNameById: Map<string, string>,
): SwimmerProfileNote {
  return {
    id: row.evaluation_id,
    date: formatDate(row.evaluation_date) ?? "",
    content: row.feedback ?? "",
    author: authorNameById.get(row.instructor_person_id) ?? "Instructor",
  };
}

function findLatestSkillStateBefore(
  historyRows: MemberSkillHistoryRow[],
  cutoffMillis?: number,
) {
  if (!historyRows.length) return null;

  if (typeof cutoffMillis !== "number") {
    return historyRows[historyRows.length - 1] ?? null;
  }

  for (let index = historyRows.length - 1; index >= 0; index -= 1) {
    const row = historyRows[index];
    const updatedAtMillis = row.updated_at
      ? new Date(row.updated_at).getTime()
      : Number.NaN;

    if (!Number.isNaN(updatedAtMillis) && updatedAtMillis <= cutoffMillis) {
      return row;
    }
  }

  return null;
}

function findSkillObtainedDate(historyRows: MemberSkillHistoryRow[]) {
  for (const row of historyRows) {
    if ((row.progress ?? 0) >= 4 || row.date_acquired) {
      return row.date_acquired ?? toIsoDate(row.updated_at);
    }
  }

  return null;
}

async function loadAccessibleMemberIds(
  accountPersonId: string,
  memberIds: string[],
): Promise<Set<string>> {
  const supabaseAdmin = getSupabaseAdminClient();

  const [
    { data: guardianLinks, error: guardianLinkError },
    { data: personMemberLinks, error: personMemberLinkError },
  ] = await Promise.all([
    supabaseAdmin
      .from("guardian_member")
      .select("member_id")
      .eq("guardian_person_id", accountPersonId)
      .in("member_id", memberIds),
    supabaseAdmin
      .from("person_member")
      .select("member_id")
      .eq("person_id", accountPersonId)
      .in("member_id", memberIds),
  ]);

  if (guardianLinkError || personMemberLinkError) {
    const message =
      guardianLinkError?.message ?? personMemberLinkError?.message;
    throw new Error(`Failed to verify swimmer access: ${message}`);
  }

  return new Set([
    ...(guardianLinks ?? []).map((row) => row.member_id),
    ...(personMemberLinks ?? []).map((row) => row.member_id),
  ]);
}

export async function buildParentSwimmerProfiles(
  accountPersonId: string,
  memberIds: string[],
): Promise<Map<string, SwimmerProfilePayload>> {
  const uniqueMemberIds = Array.from(new Set(memberIds.filter(Boolean)));
  const profileByMemberId = new Map<string, SwimmerProfilePayload>();
  if (uniqueMemberIds.length === 0) {
    return profileByMemberId;
  }

  const accessibleMemberIds = await loadAccessibleMemberIds(
    accountPersonId,
    uniqueMemberIds,
  );

  const allowedMemberIds = uniqueMemberIds.filter((memberId) =>
    accessibleMemberIds.has(memberId),
  );

  if (allowedMemberIds.length === 0) {
    return profileByMemberId;
  }

  const supabaseAdmin = getSupabaseAdminClient();

  const [
    { data: memberRows, error: memberError },
    { data: currentSkillRows, error: currentSkillsError },
    { data: skillHistoryRows, error: skillHistoryError },
    { data: evaluationRows, error: evaluationsError },
    { data: enrollments, error: enrollmentError },
  ] = await Promise.all([
    supabaseAdmin
      .from("member")
      .select(
        "member_id, organization_id, first_name, last_name, date_of_birth, created_at",
      )
      .in("member_id", allowedMemberIds),
    supabaseAdmin
      .from("member_skill_current")
      .select(
        "member_skill_id, member_id, skill_id, progress, date_acquired, updated_at",
      )
      .in("member_id", allowedMemberIds),
    supabaseAdmin
      .from("member_skill")
      .select(
        "member_skill_id, member_id, skill_id, progress, date_acquired, updated_at",
      )
      .in("member_id", allowedMemberIds)
      .order("updated_at", { ascending: true })
      .order("member_skill_id", { ascending: true }),
    supabaseAdmin
      .from("evaluation")
      .select(
        "evaluation_id, member_id, feedback, evaluation_date, instructor_person_id, skill_id, class_id",
      )
      .in("member_id", allowedMemberIds)
      .order("evaluation_date", { ascending: false }),
    supabaseAdmin
      .from("enrollment")
      .select("member_id, class_id")
      .in("member_id", allowedMemberIds),
  ]);

  if (memberError) {
    throw new Error(`Failed to load swimmers: ${memberError.message}`);
  }

  if (currentSkillsError) {
    throw new Error(
      `Failed to load current skills: ${currentSkillsError.message}`,
    );
  }

  if (skillHistoryError) {
    throw new Error(
      `Failed to load skill history: ${skillHistoryError.message}`,
    );
  }

  if (evaluationsError) {
    throw new Error(
      `Failed to load swimmer notes: ${evaluationsError.message}`,
    );
  }

  if (enrollmentError) {
    throw new Error(`Failed to load classes: ${enrollmentError.message}`);
  }

  const members = (memberRows ?? []) as MemberRow[];
  const organizationIds = Array.from(
    new Set(members.map((member) => member.organization_id)),
  );

  const [organizationResult, orgSkillResult, authorResult] =
    await Promise.all([
      supabaseAdmin
        .from("organization")
        .select("organization_id, name")
        .in("organization_id", organizationIds),
      supabaseAdmin
        .from("skill")
        .select("skill_id, organization_id, name")
        .in("organization_id", organizationIds)
        .order("name", { ascending: true }),
      (() => {
        const authorIds = Array.from(
          new Set(
            (evaluationRows ?? []).map((row) => row.instructor_person_id),
          ),
        );

        if (authorIds.length === 0) {
          return Promise.resolve({ data: [], error: null });
        }

        return supabaseAdmin
          .from("person")
          .select("person_id, first_name, last_name")
          .in("person_id", authorIds);
      })(),
    ]);

  if (organizationResult.error) {
    throw new Error(
      `Failed to load organization: ${organizationResult.error.message}`,
    );
  }

  if (orgSkillResult.error) {
    throw new Error(
      `Failed to load organization skills: ${orgSkillResult.error.message}`,
    );
  }

  if (authorResult.error) {
    throw new Error(
      `Failed to load note authors: ${authorResult.error.message}`,
    );
  }

  const classIds = Array.from(
    new Set((enrollments ?? []).map((row) => row.class_id).filter(Boolean)),
  );
  const { data: classRows, error: classRowsError } = classIds.length
    ? await supabaseAdmin
      .from("class_entity")
      .select("class_id, name, schedule")
      .in("class_id", classIds)
    : {
      data: [] as Array<{
        class_id: string;
        name: string;
        schedule: string | null;
      }>,
      error: null,
    };

  if (classRowsError) {
    throw new Error(`Failed to load class history: ${classRowsError.message}`);
  }

  const organizationNameById = new Map(
    (organizationResult.data ?? []).map((row) => [
      row.organization_id,
      row.name,
    ]),
  );

  const orgSkillsByOrganizationId = new Map<
    string,
    Array<{ skill_id: string; name: string }>
  >();
  (orgSkillResult.data ?? []).forEach((row) => {
    const existing = orgSkillsByOrganizationId.get(row.organization_id) ?? [];
    existing.push({ skill_id: row.skill_id, name: row.name });
    orgSkillsByOrganizationId.set(row.organization_id, existing);
  });

  const authorNameById = new Map<string, string>();
  (authorResult.data ?? []).forEach((row) => {
    authorNameById.set(
      row.person_id,
      `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "Instructor",
    );
  });

  const currentSkillByMemberSkill = new Map<
    string,
    Map<string, MemberSkillCurrentRow>
  >();
  ((currentSkillRows ?? []) as MemberSkillCurrentRow[]).forEach((row) => {
    const existing = currentSkillByMemberSkill.get(row.member_id) ?? new Map();
    existing.set(row.skill_id, row);
    currentSkillByMemberSkill.set(row.member_id, existing);
  });

  const skillHistoryByMemberSkill = new Map<
    string,
    Map<string, MemberSkillHistoryRow[]>
  >();
  ((skillHistoryRows ?? []) as MemberSkillHistoryRow[]).forEach((row) => {
    const memberMap =
      skillHistoryByMemberSkill.get(row.member_id) ??
      new Map<string, MemberSkillHistoryRow[]>();
    const existing = memberMap.get(row.skill_id) ?? [];
    existing.push(row);
    memberMap.set(row.skill_id, existing);
    skillHistoryByMemberSkill.set(row.member_id, memberMap);
  });

  const evaluationsByMemberId = new Map<string, EvaluationRow[]>();
  ((evaluationRows ?? []) as EvaluationRow[]).forEach((row) => {
    const existing = evaluationsByMemberId.get(row.member_id) ?? [];
    existing.push(row);
    evaluationsByMemberId.set(row.member_id, existing);
  });

  const classRowById = new Map(
    (classRows ?? []).map((row) => [row.class_id, row]),
  );

  const classesByMemberId = new Map<
    string,
    Array<{
      id: string;
      name: string;
      schedule: string;
    }>
  >();
  (enrollments ?? []).forEach((row) => {
    const classRow = classRowById.get(row.class_id);
    if (!classRow) return;

    const existing = classesByMemberId.get(row.member_id) ?? [];
    existing.push({
      id: classRow.class_id,
      name: classRow.name,
      schedule: classRow.schedule ?? "Schedule TBD",
    });
    classesByMemberId.set(row.member_id, existing);
  });

  members.forEach((member) => {
    const orgSkills =
      orgSkillsByOrganizationId.get(member.organization_id) ?? [];
    const currentSkillById =
      currentSkillByMemberSkill.get(member.member_id) ?? new Map();
    const skillHistoryById =
      skillHistoryByMemberSkill.get(member.member_id) ?? new Map();
    const memberEvaluations = evaluationsByMemberId.get(member.member_id) ?? [];
    const enrolledClasses = classesByMemberId.get(member.member_id) ?? [];
    const buildSessionSkills = (options: {
      cutoffMillis?: number;
      sessionStartDate?: string;
      sessionEndDate?: string;
      noteRows: EvaluationRow[];
      fallbackToCurrent?: boolean;
    }) => {
      const skillNotesBySkillId = new Map<string, SwimmerProfileNote[]>();
      options.noteRows
        .filter((row) => Boolean(row.skill_id))
        .forEach((row) => {
          const key = row.skill_id as string;
          const existing = skillNotesBySkillId.get(key) ?? [];
          existing.push(buildNoteEntry(row, authorNameById));
          skillNotesBySkillId.set(key, existing);
        });

      return orgSkills.map((skill) => {
        const history = skillHistoryById.get(skill.skill_id) ?? [];
        const currentSkill = currentSkillById.get(skill.skill_id);
        const snapshotRow =
          findLatestSkillStateBefore(history, options.cutoffMillis) ??
          (options.fallbackToCurrent ? (currentSkill ?? null) : null);
        const progress = snapshotRow?.progress ?? 0;
        const obtainedDate = findSkillObtainedDate(history);
        const visibleObtainedDate =
          obtainedDate &&
            (!options.sessionEndDate || obtainedDate <= options.sessionEndDate)
            ? obtainedDate
            : null;

        return {
          id: skill.skill_id,
          name: skill.name,
          mastered: progress >= 4 || Boolean(visibleObtainedDate),
          progress,
          dateAcquired: formatDate(visibleObtainedDate) ?? undefined,
          obtainedInSession: Boolean(
            visibleObtainedDate &&
            options.sessionStartDate &&
            options.sessionEndDate &&
            isDateWithinSession(
              visibleObtainedDate,
              options.sessionStartDate,
              options.sessionEndDate,
            ),
          ),
          notes: skillNotesBySkillId.get(skill.skill_id) ?? [],
        };
      });
    };

    const classItems = enrolledClasses
      .map((classItem) => ({
        id: classItem.id,
        name: classItem.name,
        schedule: classItem.schedule,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const sessionNotes = memberEvaluations
      .filter(
        (row) => !row.skill_id && !isSkillFormattedFeedback(row.feedback),
      )
      .map((row) => buildNoteEntry(row, authorNameById));

    const skills = buildSessionSkills({
      noteRows: memberEvaluations,
      fallbackToCurrent: true,
    });

    const sessions: SessionPayload[] = [
      {
        id: "current-progress",
        name: "Current Progress",
        startDate: undefined,
        endDate: undefined,
        isCurrent: true,
        isSynthetic: true,
        classes: classItems,
        skills,
        sessionNotes,
        summary: computeSummary(skills, sessionNotes),
      },
    ];

    const defaultSessionId = "current-progress";

    profileByMemberId.set(member.member_id, {
      swimmer: {
        id: member.member_id,
        name: `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim(),
        age: calculateAge(member.date_of_birth),
        enrollmentDate: formatDate(member.created_at) ?? "",
        organization: organizationNameById.get(member.organization_id) ?? "",
      },
      sessions,
      defaultSessionId,
    });
  });

  return profileByMemberId;
}

export async function buildParentSwimmerProfile(
  accountPersonId: string,
  memberId: string,
): Promise<SwimmerProfilePayload | null> {
  const profiles = await buildParentSwimmerProfiles(accountPersonId, [
    memberId,
  ]);
  return profiles.get(memberId) ?? null;
}
