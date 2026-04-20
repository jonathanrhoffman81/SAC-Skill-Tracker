import {
  getActivePersonOrganizations,
  getOrganizationById,
  getRoleIdByName,
  mapPersonIdsForPersonOrgRole,
} from "@/lib/adminQueries";

export interface AdminStats {
  totalMembers: number;
  totalInstructors: number;
  activeClasses: number;
  skillLevels: number;
  swimmersWithNoEval: number;
  organizationName: string;
  organizationId: string;
  organizationLogoUrl?: string | null;
  headerAccentColor?: string | null;
}

export interface AdminDashboardBootstrapPayload {
  stats: AdminStats;
  tabEssentials: {
    skills: Array<{ skill_id: string; name: string }>;
    evaluationFilters: {
      classes: Array<{ value: string; label: string }>;
      instructors: Array<{ value: string; label: string }>;
      groups: Array<{ value: string; label: string; classId: string }>;
      memberIdsByGroupId: Record<string, string[]>;
    };
  };
}

function getOrganizationLogoUrl(organizationId: string | undefined) {
  if (!organizationId) return null;

  const baseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;

  return `${baseUrl}/storage/v1/object/public/organization-logos/${organizationId}/logo.png`;
}

async function timedQuery<T>(label: string, query: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    return await query();
  } finally {
    const durationMs = Date.now() - startedAt;
    console.info(`[admin-dashboard-bootstrap] ${label} took ${durationMs}ms`);
  }
}

export async function loadAdminDashboardBootstrap(
  supabase: any,
  organizationId: string,
): Promise<AdminDashboardBootstrapPayload> {
  const [organization, memberCountResultRaw, memberListResultRaw, classesCountResultRaw, skillsResultRaw] =
    await Promise.all([
      timedQuery("organization", () =>
        getOrganizationById(supabase, organizationId),
      ),
      timedQuery("member-count", () =>
        supabase
          .from("member")
          .select("member_id", { count: "exact", head: true })
          .eq("organization_id", organizationId),
      ),
      timedQuery("members", () =>
        supabase
          .from("member")
          .select("member_id")
          .eq("organization_id", organizationId),
      ),
      timedQuery("class-count", () =>
        supabase
          .from("class_entity")
          .select("class_id", { count: "exact", head: true })
          .eq("organization_id", organizationId),
      ),
      timedQuery("skills", () =>
        supabase
          .from("skill")
          .select("skill_id, name")
          .eq("organization_id", organizationId)
          .order("name", { ascending: true }),
      ),
    ]);

  const memberCountResult = memberCountResultRaw as any;
  const memberListResult = memberListResultRaw as any;
  const classesCountResult = classesCountResultRaw as any;
  const skillsResult = skillsResultRaw as any;

  if (!organization) {
    throw new Error("Failed to load organization");
  }

  if (memberCountResult.error) {
    throw new Error(`Failed to load members: ${memberCountResult.error.message}`);
  }

  if (memberListResult.error) {
    throw new Error(`Failed to load member list: ${memberListResult.error.message}`);
  }

  if (classesCountResult.error) {
    throw new Error(`Failed to load classes: ${classesCountResult.error.message}`);
  }

  if (skillsResult.error) {
    throw new Error(`Failed to load skills: ${skillsResult.error.message}`);
  }

  const organizationMemberIds =
    ((memberListResult.data as Array<{ member_id: string }> | null) ?? [])
      .map((row) => row.member_id)
      .filter(Boolean);

  const evaluatedMemberIds = new Set<string>();
  let swimmersWithNoEval = 0;

  if (organizationMemberIds.length > 0) {
    try {
      await timedQuery("evaluated-member-ids", async () => {
        const CHUNK_SIZE = 100;

        for (let index = 0; index < organizationMemberIds.length; index += CHUNK_SIZE) {
          const chunk = organizationMemberIds.slice(index, index + CHUNK_SIZE);
          const evaluationResult = await supabase
            .from("evaluation")
            .select("member_id")
            .in("member_id", chunk);

          if (evaluationResult.error) {
            throw new Error(`Failed to load evaluations: ${evaluationResult.error.message}`);
          }

          const rows =
            (evaluationResult.data as Array<{ member_id: string }> | null) ?? [];

          rows.forEach((row) => {
            if (row.member_id) {
              evaluatedMemberIds.add(row.member_id);
            }
          });
        }
      });

      swimmersWithNoEval = Math.max(
        0,
        organizationMemberIds.length - evaluatedMemberIds.size,
      );
    } catch (error) {
      console.warn("[admin-dashboard-bootstrap] Failed to compute swimmersWithNoEval:", error);
      swimmersWithNoEval = 0;
    }
  }

  const instructorRoleId = await timedQuery("instructor-role-id", () =>
    getRoleIdByName(supabase, "instructor"),
  );
  if (!instructorRoleId) {
    throw new Error("Failed to find instructor role");
  }

  const activePersonOrgs = await timedQuery("active-person-orgs", () =>
    getActivePersonOrganizations(supabase, organizationId),
  );
  const personOrgIds = activePersonOrgs.map((po) => po.person_organization_id);

  let totalInstructors = 0;
  let instructorNameOptions: Array<{ value: string; label: string }> = [];

  if (personOrgIds.length > 0) {
    const instructorRolesResult = await timedQuery<any>("instructor-role-mapping", () =>
      supabase
        .from("person_org_role")
        .select("person_organization_id")
        .in("person_organization_id", personOrgIds)
        .eq("role_id", instructorRoleId),
    );

    if (!instructorRolesResult.error) {
      const instructorPersonIds = mapPersonIdsForPersonOrgRole(
        activePersonOrgs,
        (instructorRolesResult.data as Array<{ person_organization_id: string }> | null) ?? [],
      );

      totalInstructors = instructorPersonIds.length;

      if (instructorPersonIds.length > 0) {
        const instructorsResult = await timedQuery<any>("instructor-names", () =>
          supabase
            .from("person")
            .select("person_id, first_name, last_name, email")
            .in("person_id", instructorPersonIds),
        );

        if (!instructorsResult.error) {
          instructorNameOptions = ((instructorsResult.data as Array<{
            person_id: string;
            first_name?: string | null;
            last_name?: string | null;
            email?: string | null;
          }> | null) ?? [])
            .map((row) => {
              const fullName = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
              const label = fullName || row.email || "Instructor";
              return {
                value: label,
                label,
              };
            })
            .sort((a, b) => a.label.localeCompare(b.label));
        }
      }
    }
  }

  const classesResult = await timedQuery<any>("classes-for-filters", () =>
    supabase
      .from("class_entity")
      .select("class_id, name")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true }),
  );

  if (classesResult.error) {
    throw new Error(`Failed to load class filters: ${classesResult.error.message}`);
  }

  const classes =
    (classesResult.data as Array<{ class_id: string; name?: string | null }> | null) ?? [];

  const classLabelById = new Map<string, string>(
    classes.map((row) => [row.class_id, row.name || "Unnamed class"]),
  );

  const classOptions = classes.map((row) => ({
    value: row.class_id,
    label: row.name || "Unnamed class",
  }));

  const classIds = classes.map((row) => row.class_id);

  let groups: Array<{
    group_id: string;
    class_id: string;
    name?: string | null;
  }> = [];

  if (classIds.length > 0) {
    const groupsResult = await timedQuery<any>("groups-for-filters", () =>
      supabase
        .from("class_group")
        .select("group_id, class_id, name")
        .in("class_id", classIds),
    );

    if (groupsResult.error) {
      throw new Error(`Failed to load group filters: ${groupsResult.error.message}`);
    }

    groups =
      (groupsResult.data as Array<{
        group_id: string;
        class_id: string;
        name?: string | null;
      }> | null) ?? [];
  }

  const groupOptions = groups
    .map((row) => {
      const classLabel = classLabelById.get(row.class_id) || "Unnamed class";
      const groupLabel = row.name || classLabel;

      return {
        value: row.group_id,
        label: groupLabel,
        classId: row.class_id,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  const groupIds = groups.map((row) => row.group_id);

  const memberIdsByGroupId: Record<string, string[]> = {};
  if (groupIds.length > 0) {
    const enrollmentsResult = await timedQuery<any>("group-member-mapping", () =>
      supabase
        .from("enrollment")
        .select("member_id, group_id")
        .in("group_id", groupIds),
    );

    if (!enrollmentsResult.error) {
      const enrollmentRows =
        (enrollmentsResult.data as Array<{
          member_id: string;
          group_id?: string | null;
        }> | null) ?? [];

      enrollmentRows.forEach((row) => {
        if (!row.group_id) return;

        const existing = memberIdsByGroupId[row.group_id] ?? [];
        if (!existing.includes(row.member_id)) {
          existing.push(row.member_id);
          memberIdsByGroupId[row.group_id] = existing;
        }
      });
    }
  }

  const skills =
    (skillsResult.data as Array<{ skill_id: string; name: string }> | null) ?? [];

  return {
    stats: {
      totalMembers: memberCountResult.count ?? 0,
      totalInstructors,
      activeClasses: classesCountResult.count ?? 0,
      skillLevels: skills.length,
      swimmersWithNoEval,
      organizationName: organization.name,
      organizationId: organization.organization_id,
      organizationLogoUrl: getOrganizationLogoUrl(organizationId),
      headerAccentColor: organization.header_color ?? null,
    },
    tabEssentials: {
      skills,
      evaluationFilters: {
        classes: classOptions,
        instructors: instructorNameOptions,
        groups: groupOptions,
        memberIdsByGroupId,
      },
    },
  };
}
