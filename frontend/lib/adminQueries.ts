/**
 * Shared query helpers for admin API routes.
 * Centralizes organization and role resolution logic.
 */

export interface ActivePersonOrg {
    person_organization_id: string;
    person_id: string;
}

export async function getPersonIdByEmail(supabase: any, email: string): Promise<string | null> {
    const { data: person } = await supabase
        .from('person')
        .select('person_id')
        .eq('email', email)
        .single();

    return person?.person_id ?? null;
}

export async function getOrgIdByEmail(supabase: any, email: string): Promise<string | null> {
    const personId = await getPersonIdByEmail(supabase, email);
    if (!personId) return null;

    const { data: personOrg } = await supabase
        .from('person_organization')
        .select('organization_id')
        .eq('person_id', personId)
        .eq('status', 'active')
        .single();

    return personOrg?.organization_id ?? null;
}

export async function getOrganizationById(supabase: any, organizationId: string) {
    const { data: organization } = await supabase
        .from('organization')
        .select('organization_id, name')
        .eq('organization_id', organizationId)
        .single();

    return organization ?? null;
}

export async function getRoleIdByName(supabase: any, roleName: string): Promise<number | null> {
    const { data: role } = await supabase
        .from('role')
        .select('role_id')
        .eq('name', roleName)
        .single();

    return role?.role_id ?? null;
}

export async function getActivePersonOrganizations(
    supabase: any,
    organizationId: string
): Promise<ActivePersonOrg[]> {
    const { data: personOrgs } = await supabase
        .from('person_organization')
        .select('person_organization_id, person_id')
        .eq('organization_id', organizationId)
        .eq('status', 'active');

    return (personOrgs as ActivePersonOrg[] | null) ?? [];
}

export function mapPersonIdsForPersonOrgRole(
    activePersonOrgs: ActivePersonOrg[],
    roleRows: Array<{ person_organization_id: string }>
): string[] {
    const rolePersonOrgIds = new Set(roleRows.map((row) => row.person_organization_id));
    const uniquePersonIds = new Set(
        activePersonOrgs
            .filter((po) => rolePersonOrgIds.has(po.person_organization_id))
            .map((po) => po.person_id)
    );

    return Array.from(uniquePersonIds);
}

export async function getPersonIdsForRoleInOrg(
    supabase: any,
    organizationId: string,
    roleId: number
): Promise<string[]> {
    const activePersonOrgs = await getActivePersonOrganizations(supabase, organizationId);
    const personOrgIds = activePersonOrgs.map((po) => po.person_organization_id);

    if (personOrgIds.length === 0) return [];

    const { data: roleRows } = await supabase
        .from('person_org_role')
        .select('person_organization_id')
        .in('person_organization_id', personOrgIds)
        .eq('role_id', roleId);

    return mapPersonIdsForPersonOrgRole(
        activePersonOrgs,
        (roleRows as Array<{ person_organization_id: string }> | null) ?? []
    );
}
