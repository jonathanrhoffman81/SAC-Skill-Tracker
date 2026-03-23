/**
 * Admin Parents API Route
 * Purpose: Fetch parents/guardians for an organization
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabaseAdmin';
import {
    getOrgIdByEmail,
    getPersonIdsForRoleInOrg,
    getRoleIdByName,
} from '@/lib/adminQueries';

// GET: Fetch all parents (guardians) for an organization
export async function GET(request: NextRequest) {
    try {
        const email = request.nextUrl.searchParams.get('email');

        if (!email) {
            return NextResponse.json({ error: 'Email is required' }, { status: 400 });
        }

        const supabase = getSupabaseAdminClient();
        const orgId = await getOrgIdByEmail(supabase, email);
        const guardianRoleId = await getRoleIdByName(supabase, 'guardian');

        if (!orgId || !guardianRoleId) {
            return NextResponse.json({ error: 'Failed to find organization or guardian role' }, { status: 500 });
        }

        const guardianPersonIds = await getPersonIdsForRoleInOrg(supabase, orgId, guardianRoleId);

        if (guardianPersonIds.length === 0) {
            return NextResponse.json({ parents: [] });
        }

        const { data: parents, error: parentsError } = await supabase
            .from('person')
            .select('person_id, first_name, last_name, email, created_at')
            .in('person_id', guardianPersonIds)
            .order('first_name', { ascending: true })
            .order('last_name', { ascending: true });

        if (parentsError) {
            return NextResponse.json(
                { error: 'Failed to load parents: ' + parentsError.message },
                { status: 500 }
            );
        }

        // Fetch children (members) linked to each guardian
        const parentPersonIds = (parents || []).map((p: any) => p.person_id);
        const childrenByParentId = new Map<string, Array<{ member_id: string; first_name: string | null; last_name: string | null }>>();

        if (parentPersonIds.length > 0) {
            const chunkSize = 200;
            const guardianLinks: Array<{ guardian_person_id: string; member_id: string }> = [];

            // Fetch all guardian_member links for these parents in chunks
            for (let i = 0; i < parentPersonIds.length; i += chunkSize) {
                const chunk = parentPersonIds.slice(i, i + chunkSize);
                const { data: links, error: linksError } = await supabase
                    .from('guardian_member')
                    .select('guardian_person_id, member_id')
                    .in('guardian_person_id', chunk);

                if (!linksError && links) {
                    guardianLinks.push(...links);
                }
            }

            const memberIds = Array.from(new Set(guardianLinks.map(l => l.member_id)));

            if (memberIds.length > 0) {
                const memberMap = new Map<string, { member_id: string; first_name: string | null; last_name: string | null }>();

                // Fetch member details in chunks
                for (let i = 0; i < memberIds.length; i += chunkSize) {
                    const chunk = memberIds.slice(i, i + chunkSize);
                    const { data: members, error: membersError } = await supabase
                        .from('member')
                        .select('member_id, first_name, last_name')
                        .in('member_id', chunk);

                    if (!membersError && members) {
                        members.forEach((m: any) => {
                            memberMap.set(m.member_id, m);
                        });
                    }
                }

                // Build children map for each parent
                guardianLinks.forEach(link => {
                    const member = memberMap.get(link.member_id);
                    if (member) {
                        if (!childrenByParentId.has(link.guardian_person_id)) {
                            childrenByParentId.set(link.guardian_person_id, []);
                        }
                        childrenByParentId.get(link.guardian_person_id)!.push(member);
                    }
                });
            }
        }

        // Attach children to parents with deduplication
        const parentsWithChildren = (parents || []).map((parent: any) => {
            const childrenList = childrenByParentId.get(parent.person_id) || [];

            // Deduplicate children by name
            const dedupedChildren = Array.from(
                new Map(
                    childrenList.map((child: any) => {
                        const nameKey = `${child.first_name || ''} ${child.last_name || ''}`.toLowerCase();
                        return [nameKey, child];
                    })
                ).values()
            ).sort((a: any, b: any) => {
                const aName = `${a.first_name || ''} ${a.last_name || ''}`.toLowerCase();
                const bName = `${b.first_name || ''} ${b.last_name || ''}`.toLowerCase();
                return aName.localeCompare(bName);
            });

            return {
                ...parent,
                children: dedupedChildren,
            };
        });

        return NextResponse.json({ parents: parentsWithChildren });
    } catch (error) {
        console.error('Parents GET error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// TODO: Implement parent creation flow.
export async function POST() {
    return NextResponse.json({ error: 'Not implemented yet' }, { status: 501 });
}

// TODO: Implement parent update flow.
export async function PUT() {
    return NextResponse.json({ error: 'Not implemented yet' }, { status: 501 });
}

// TODO: Implement parent delete flow.
export async function DELETE() {
    return NextResponse.json({ error: 'Not implemented yet' }, { status: 501 });
}
