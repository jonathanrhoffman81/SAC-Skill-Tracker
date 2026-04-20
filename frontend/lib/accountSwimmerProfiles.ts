import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export interface SwimmerProfileNote {
  id: string;
  date: string;
  content: string;
  author: string;
}

export interface SkillProgressHistoryItem {
  id: string;
  date: string;
  progress: number;
  dateAcquired?: string;
}

export interface ClassHistorySkillItem {
  id: string;
  name: string;
  mastered: boolean;
  progress: number;
  dateAcquired?: string;
  obtainedInClass?: boolean;
  notes: SwimmerProfileNote[];
  progressHistory: SkillProgressHistoryItem[];
}

export interface ClassHistoryPayload {
  id: string;
  classId: string | null;
  name: string;
  schedule: string;
  startDate?: string;
  endDate?: string;
  // Raw ISO yyyy-mm-dd strings, for sort/filter/grouping in the UI.
  startDateIso?: string;
  endDateIso?: string;
  isCurrent: boolean;
  isGeneral: boolean;
  skills: ClassHistorySkillItem[];
  classNotes: SwimmerProfileNote[];
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
    isActive: boolean;
  };
  classHistories: ClassHistoryPayload[];
  defaultClassHistoryId: string;
}

interface MemberSkillCurrentRow {
  member_skill_id: string;
  member_id: string;
  skill_id: string;
  progress: number | null;
  date_acquired: string | null;
  updated_at: string | null;
  evaluation_id: string | null;
}

interface MemberSkillHistoryRow {
  member_skill_id: string;
  member_id: string;
  skill_id: string;
  progress: number | null;
  date_acquired: string | null;
  updated_at: string | null;
  evaluation_id: string | null;
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

interface ClassRow {
  class_id: string;
  name: string | null;
  schedule: string | null;
  schedule_days: string[] | null;
  schedule_time: string | null;
  start_date: string | null;
  end_date: string | null;
}

interface EnrollmentRow {
  member_id: string;
  class_id: string;
  group_id: string | null;
}

interface MemberRow {
  member_id: string;
  organization_id: string;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  created_at: string;
  is_active: boolean;
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

function formatClassSchedule(row: ClassRow): string {
  if (row.schedule?.trim()) {
    return row.schedule.trim();
  }

  const dayText = Array.isArray(row.schedule_days)
    ? row.schedule_days.filter(Boolean).join("/")
    : "";
  const timeText = row.schedule_time?.trim() ?? "";
  return [dayText, timeText].filter(Boolean).join(" ") || "Schedule TBD";
}

function computeSummary(
  skills: ClassHistorySkillItem[],
  classNotes: SwimmerProfileNote[],
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
    classNotes.length +
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

function findSkillObtainedRow(historyRows: MemberSkillHistoryRow[]) {
  for (const row of historyRows) {
    if ((row.progress ?? 0) >= 4 || row.date_acquired) {
      return row;
    }
  }

  return null;
}

function getSkillObtainedDate(row: MemberSkillHistoryRow | null) {
  if (!row) return null;
  return row.date_acquired ?? toIsoDate(row.updated_at);
}

function isHistoryRowBeforeCutoff(
  row: MemberSkillHistoryRow,
  cutoffMillis?: number,
) {
  if (typeof cutoffMillis !== "number") return true;

  const updatedAtMillis = row.updated_at
    ? new Date(row.updated_at).getTime()
    : Number.NaN;

  return !Number.isNaN(updatedAtMillis) && updatedAtMillis <= cutoffMillis;
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

async function buildAuthorizedSwimmerProfiles(
  memberIds: string[],
): Promise<Map<string, SwimmerProfilePayload>> {
  const uniqueMemberIds = Array.from(new Set(memberIds.filter(Boolean)));
  const profileByMemberId = new Map<string, SwimmerProfilePayload>();
  if (uniqueMemberIds.length === 0) {
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
        "member_id, organization_id, first_name, last_name, date_of_birth, created_at, is_active",
      )
      .in("member_id", uniqueMemberIds),
    supabaseAdmin
      .from("member_skill_current")
      .select(
        "member_skill_id, member_id, skill_id, progress, date_acquired, updated_at, evaluation_id",
      )
      .in("member_id", uniqueMemberIds),
    supabaseAdmin
      .from("member_skill")
      .select(
        "member_skill_id, member_id, skill_id, progress, date_acquired, updated_at, evaluation_id",
      )
      .in("member_id", uniqueMemberIds)
      .order("updated_at", { ascending: true })
      .order("member_skill_id", { ascending: true }),
    supabaseAdmin
      .from("evaluation")
      .select(
        "evaluation_id, member_id, feedback, evaluation_date, instructor_person_id, skill_id, class_id",
      )
      .in("member_id", uniqueMemberIds)
      .order("evaluation_date", { ascending: false }),
    supabaseAdmin
      .from("enrollment")
      .select("member_id, class_id, group_id")
      .in("member_id", uniqueMemberIds),
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

  const enrollmentRows = (enrollments ?? []) as EnrollmentRow[];
  const evaluationClassIds = (evaluationRows ?? [])
    .map((row) => row.class_id)
    .filter((id: string | null | undefined): id is string => Boolean(id));
  const classIds = Array.from(
    new Set([
      ...enrollmentRows.map((row) => row.class_id).filter(Boolean),
      ...evaluationClassIds,
    ]),
  );
  const { data: classRows, error: classRowsError } = classIds.length
    ? await supabaseAdmin
        .from("class_entity")
        .select(
          "class_id, name, schedule, schedule_days, schedule_time, start_date, end_date",
        )
        .in("class_id", classIds)
    : {
        data: [] as ClassRow[],
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
  const evaluationById = new Map<string, EvaluationRow>();
  ((evaluationRows ?? []) as EvaluationRow[]).forEach((row) => {
    const existing = evaluationsByMemberId.get(row.member_id) ?? [];
    existing.push(row);
    evaluationsByMemberId.set(row.member_id, existing);
    evaluationById.set(row.evaluation_id, row);
  });

  const classRowById = new Map(
    ((classRows ?? []) as ClassRow[]).map((row) => [row.class_id, row]),
  );

  const classesByMemberId = new Map<string, ClassRow[]>();
  enrollmentRows.forEach((row) => {
    const classRow = classRowById.get(row.class_id);
    if (!classRow) return;

    const existing = classesByMemberId.get(row.member_id) ?? [];
    if (!existing.some((item) => item.class_id === classRow.class_id)) {
      existing.push(classRow);
    }
    classesByMemberId.set(row.member_id, existing);
  });

  ((evaluationRows ?? []) as EvaluationRow[]).forEach((row) => {
    if (!row.class_id) return;
    const classRow = classRowById.get(row.class_id);
    if (!classRow) return;

    const existing = classesByMemberId.get(row.member_id) ?? [];
    if (!existing.some((item) => item.class_id === classRow.class_id)) {
      existing.push(classRow);
    }
    classesByMemberId.set(row.member_id, existing);
  });

  const todayIso = new Date().toISOString().slice(0, 10);

  members.forEach((member) => {
    const orgSkills =
      orgSkillsByOrganizationId.get(member.organization_id) ?? [];
    const currentSkillById =
      currentSkillByMemberSkill.get(member.member_id) ??
      new Map<string, MemberSkillCurrentRow>();
    const skillHistoryById =
      skillHistoryByMemberSkill.get(member.member_id) ??
      new Map<string, MemberSkillHistoryRow[]>();
    const memberEvaluations = evaluationsByMemberId.get(member.member_id) ?? [];
    const memberClasses = classesByMemberId.get(member.member_id) ?? [];

    // Bucket classes by lifecycle so parents can scan the dropdown top-to-bottom:
    // 0 current → 1 upcoming → 2 past → 3 undated.
    const classBucket = (row: ClassRow): number => {
      if (!row.start_date && !row.end_date) return 3;
      if (
        row.start_date &&
        row.end_date &&
        row.start_date <= todayIso &&
        row.end_date >= todayIso
      ) {
        return 0;
      }
      if (row.start_date && row.start_date > todayIso) return 1;
      if (row.end_date && row.end_date < todayIso) return 2;
      // Partial date info (e.g. only start_date in the past with no end_date): treat as past.
      return 2;
    };

    const sortedClasses = [...memberClasses].sort((a, b) => {
      const aBucket = classBucket(a);
      const bBucket = classBucket(b);
      if (aBucket !== bBucket) return aBucket - bBucket;

      // Inside a bucket:
      //   upcoming → soonest start first (asc)
      //   past/current → most recent end first (desc)
      //   undated → by name
      if (aBucket === 1) {
        const aStart = a.start_date ?? "";
        const bStart = b.start_date ?? "";
        if (aStart !== bStart) return aStart.localeCompare(bStart);
      } else if (aBucket === 0 || aBucket === 2) {
        const aEnd = a.end_date ?? "";
        const bEnd = b.end_date ?? "";
        if (aEnd !== bEnd) return bEnd.localeCompare(aEnd);
        const aStart = a.start_date ?? "";
        const bStart = b.start_date ?? "";
        if (aStart !== bStart) return bStart.localeCompare(aStart);
      }

      return (a.name ?? "").localeCompare(b.name ?? "");
    });
    const buildClassSkills = (options: {
      classId: string | null;
      cutoffMillis?: number;
      classEndDate?: string | null;
      noteRows: EvaluationRow[];
      fallbackToCurrent?: boolean;
      isGeneral?: boolean;
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
        const obtainedRow = findSkillObtainedRow(history);
        const obtainedDate = getSkillObtainedDate(obtainedRow);
        const visibleObtainedDate =
          obtainedDate &&
          (!options.classEndDate || obtainedDate <= options.classEndDate)
            ? obtainedDate
            : null;
        const obtainedEvaluation = obtainedRow?.evaluation_id
          ? evaluationById.get(obtainedRow.evaluation_id)
          : null;
        const obtainedClassId = obtainedEvaluation?.class_id ?? null;
        const obtainedInClass = options.isGeneral
          ? Boolean(visibleObtainedDate && !obtainedClassId)
          : Boolean(
              visibleObtainedDate &&
                options.classId &&
                obtainedClassId === options.classId,
            );
        const progressHistory = history
          .filter((row) => isHistoryRowBeforeCutoff(row, options.cutoffMillis))
          .filter((row) => {
            if (!options.isGeneral) return true;
            if (!row.evaluation_id) return true;
            const sourceEvaluation = evaluationById.get(row.evaluation_id);
            return !sourceEvaluation?.class_id;
          })
          .map((row) => {
            const sourceEvaluation = row.evaluation_id
              ? evaluationById.get(row.evaluation_id)
              : null;

            return {
              id: row.member_skill_id,
              date:
                formatDate(sourceEvaluation?.evaluation_date ?? row.updated_at) ??
                "Date unknown",
              progress: row.progress ?? 0,
              dateAcquired: formatDate(row.date_acquired),
            };
          });

        return {
          id: skill.skill_id,
          name: skill.name,
          mastered: progress >= 4 || Boolean(visibleObtainedDate),
          progress,
          dateAcquired: formatDate(visibleObtainedDate) ?? undefined,
          obtainedInClass,
          notes: skillNotesBySkillId.get(skill.skill_id) ?? [],
          progressHistory,
        };
      });
    };

    const classHistories: ClassHistoryPayload[] = sortedClasses.map(
      (classRow) => {
        const noteRows = memberEvaluations.filter(
          (row) => row.class_id === classRow.class_id,
        );

        const classNotes = noteRows
          .filter(
            (row) => !row.skill_id && !isSkillFormattedFeedback(row.feedback),
          )
          .map((row) => buildNoteEntry(row, authorNameById));

        const hasEndDate = Boolean(classRow.end_date);
        const skills = buildClassSkills({
          classId: classRow.class_id,
          cutoffMillis: classRow.end_date
            ? toUtcEndOfDayMillis(classRow.end_date)
            : undefined,
          classEndDate: classRow.end_date,
          noteRows,
          fallbackToCurrent: !hasEndDate,
        });

        return {
          id: classRow.class_id,
          classId: classRow.class_id,
          name: classRow.name ?? "Unnamed class",
          schedule: formatClassSchedule(classRow),
          startDate: formatDate(classRow.start_date),
          endDate: formatDate(classRow.end_date),
          startDateIso: classRow.start_date ?? undefined,
          endDateIso: classRow.end_date ?? undefined,
          isCurrent: Boolean(
            classRow.start_date &&
              classRow.end_date &&
              classRow.start_date <= todayIso &&
              classRow.end_date >= todayIso,
          ),
          isGeneral: false,
          skills,
          classNotes,
          summary: computeSummary(skills, classNotes),
        };
      },
    );

    const generalNoteRows = memberEvaluations.filter((row) => !row.class_id);
    const hasGeneralSkillHistory = Array.from(skillHistoryById.values()).some(
      (historyRows) =>
        historyRows.some((row) => {
          if (!row.evaluation_id) return true;
          const sourceEvaluation = evaluationById.get(row.evaluation_id);
          return !sourceEvaluation?.class_id;
        }),
    );

    if (
      generalNoteRows.length > 0 ||
      hasGeneralSkillHistory ||
      classHistories.length === 0
    ) {
      const generalClassNotes = generalNoteRows
        .filter(
          (row) => !row.skill_id && !isSkillFormattedFeedback(row.feedback),
        )
        .map((row) => buildNoteEntry(row, authorNameById));
      const generalSkills = buildClassSkills({
        classId: null,
        noteRows: generalNoteRows,
        fallbackToCurrent: true,
        isGeneral: true,
      });

      classHistories.push({
        id: "general-history",
        classId: null,
        name: "General / Team History",
        schedule: "No class linked",
        isCurrent: classHistories.length === 0,
        isGeneral: true,
        skills: generalSkills,
        classNotes: generalClassNotes,
        summary: computeSummary(generalSkills, generalClassNotes),
      });
    }

    const defaultClassHistoryId =
      classHistories.find((item) => item.isCurrent)?.id ??
      classHistories[0]?.id ??
      "general-history";

    profileByMemberId.set(member.member_id, {
      swimmer: {
        id: member.member_id,
        name: `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim(),
        age: calculateAge(member.date_of_birth),
        enrollmentDate: formatDate(member.created_at) ?? "",
        organization: organizationNameById.get(member.organization_id) ?? "",
        isActive: member.is_active !== false,
      },
      classHistories,
      defaultClassHistoryId,
    });
  });

  return profileByMemberId;
}

export async function buildParentSwimmerProfiles(
  accountPersonId: string,
  memberIds: string[],
): Promise<Map<string, SwimmerProfilePayload>> {
  const uniqueMemberIds = Array.from(new Set(memberIds.filter(Boolean)));
  if (uniqueMemberIds.length === 0) {
    return new Map<string, SwimmerProfilePayload>();
  }

  const accessibleMemberIds = await loadAccessibleMemberIds(
    accountPersonId,
    uniqueMemberIds,
  );

  const allowedMemberIds = uniqueMemberIds.filter((memberId) =>
    accessibleMemberIds.has(memberId),
  );

  if (allowedMemberIds.length === 0) {
    return new Map<string, SwimmerProfilePayload>();
  }

  return buildAuthorizedSwimmerProfiles(allowedMemberIds);
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

export async function buildAuthorizedSwimmerProfile(
  memberId: string,
): Promise<SwimmerProfilePayload | null> {
  const profiles = await buildAuthorizedSwimmerProfiles([memberId]);
  return profiles.get(memberId) ?? null;
}
