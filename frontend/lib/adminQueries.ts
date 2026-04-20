/**
 * Shared query helpers for admin API routes.
 * Centralizes organization and role resolution logic.
 */

import type { NextRequest } from 'next/server';
import { normalizeRole } from '@/lib/authRoles';
import { AuthContextError, getCurrentPersonFromRequest } from '@/lib/serverAuth';

export interface ActivePersonOrg {
    person_organization_id: string;
    person_id: string;
}

const ADMIN_ROUTE_ROLE_SET = new Set([
    'admin',
    'org-admin',
    'org_admin',
    'super-admin',
    'superadmin',
]);

export interface AdminRequestContext {
    email: string;
    personId: string | null;
    organizationId: string;
    source: 'session' | 'email';
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

export async function resolveAdminRequestContext(
    request: NextRequest,
    supabase: any,
    fallbackEmail?: string | null
): Promise<AdminRequestContext> {
    let sessionPerson = null;
    try {
        sessionPerson = await getCurrentPersonFromRequest(request);
    } catch (error) {
        if (!(error instanceof AuthContextError)) {
            throw error;
        }

        if (!fallbackEmail) {
            throw new Error(`UNAUTHORIZED:${error.message}`);
        }
    }

    if (sessionPerson?.email) {
        const hasAdminRole = sessionPerson.roleNames.some((role) =>
            ADMIN_ROUTE_ROLE_SET.has(normalizeRole(role))
        );

        if (!hasAdminRole) {
            throw new Error('FORBIDDEN:You do not have access to this admin route.');
        }

        const activeMembership = sessionPerson.memberships.find((membership) =>
            membership.status === 'active' &&
            membership.roles.some((role) => ADMIN_ROUTE_ROLE_SET.has(normalizeRole(role)))
        );

        if (!activeMembership?.organizationId) {
            throw new Error('FORBIDDEN:No active admin organization membership was found.');
        }

        return {
            email: sessionPerson.email,
            personId: sessionPerson.personId,
            organizationId: activeMembership.organizationId,
            source: 'session',
        };
    }

    const email = String(fallbackEmail || '').trim();
    if (!email) {
        throw new Error('Missing admin email');
    }

    const organizationId = await getOrgIdByEmail(supabase, email);
    if (!organizationId) {
        throw new Error('Failed to find organization');
    }

    const personId = await getPersonIdByEmail(supabase, email);

    return {
        email,
        personId,
        organizationId,
        source: 'email',
    };
}

export async function getOrganizationById(supabase: any, organizationId: string) {
    const primaryResult = await supabase
        .from('organization')
        .select('organization_id, name, header_color')
        .eq('organization_id', organizationId)
        .single();

    const missingHeaderColorColumn =
        Boolean(primaryResult.error) &&
        (String(primaryResult.error?.message || '').toLowerCase().includes('header_color') ||
            primaryResult.error?.code === '42703');

    if (missingHeaderColorColumn) {
        const fallbackResult = await supabase
            .from('organization')
            .select('organization_id, name')
            .eq('organization_id', organizationId)
            .single();

        if (!fallbackResult.data) return null;

        return {
            ...fallbackResult.data,
            header_color: null,
        };
    }

    return primaryResult.data ?? null;
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
