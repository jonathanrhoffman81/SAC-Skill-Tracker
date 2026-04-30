/**
 * Admin Skills API Route
 * Purpose: CRUD operations for skills in an organization
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabaseAdmin';
import { resolveAdminRequestContext } from '@/lib/adminQueries';

// GET: Fetch all skills for an organization
export async function GET(request: NextRequest) {
    try {
        const supabase = getSupabaseAdminClient();
        const adminContext = await resolveAdminRequestContext(request, supabase, request.nextUrl.searchParams.get('email'));
        const orgId = adminContext.organizationId;

        const { data: skills, error: skillsError } = await supabase
            .from('skill')
            .select('skill_id, name, organization_id, created_at, display_order')
            .eq('organization_id', orgId)
            .order('display_order', { ascending: true, nullsFirst: false })
            .order('name');

        if (skillsError) {
            return NextResponse.json(
                { error: 'Failed to load skills: ' + skillsError.message },
                { status: 500 }
            );
        }

        return NextResponse.json({ skills: skills || [] });
    } catch (error) {
        console.error('Skills GET error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

// POST: Create a new skill
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { name } = body;

        if (!name) {
            return NextResponse.json(
                { error: 'Name is required' },
                { status: 400 }
            );
        }

        const supabase = getSupabaseAdminClient();
        const adminContext = await resolveAdminRequestContext(request, supabase, body.email);
        const orgId = adminContext.organizationId;

        // Place new skill at the end of the list
        const { data: maxRow } = await supabase
            .from('skill')
            .select('display_order')
            .eq('organization_id', orgId)
            .order('display_order', { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle();

        const nextOrder = (maxRow?.display_order ?? 0) + 1;

        const { data: newSkill, error: createError } = await supabase
            .from('skill')
            .insert({ name, organization_id: orgId, display_order: nextOrder })
            .select()
            .single();

        if (createError) {
            return NextResponse.json(
                { error: 'Failed to create skill: ' + createError.message },
                { status: 500 }
            );
        }

        return NextResponse.json({ skill: newSkill }, { status: 201 });
    } catch (error) {
        console.error('Skills POST error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

// PATCH: Reorder skills — accepts { orderedIds: string[] }
export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json() as { orderedIds?: string[] };
        if (!Array.isArray(body.orderedIds) || body.orderedIds.length === 0) {
            return NextResponse.json({ error: 'orderedIds array is required' }, { status: 400 });
        }

        const supabase = getSupabaseAdminClient();
        const adminContext = await resolveAdminRequestContext(request, supabase);
        const orgId = adminContext.organizationId;

        // Verify all skills belong to this org
        const { data: orgSkills } = await supabase
            .from('skill')
            .select('skill_id')
            .eq('organization_id', orgId)
            .in('skill_id', body.orderedIds);

        const validIds = new Set((orgSkills || []).map((s: any) => s.skill_id));
        const updates = body.orderedIds
            .filter((id) => validIds.has(id))
            .map((id, index) => supabase
                .from('skill')
                .update({ display_order: index + 1 })
                .eq('skill_id', id)
            );

        await Promise.all(updates);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Skills PATCH error:', error);
        const message = error instanceof Error ? error.message : 'Internal server error';
        if (message.startsWith('FORBIDDEN:')) return NextResponse.json({ error: message.replace('FORBIDDEN:', '') }, { status: 403 });
        if (message.startsWith('UNAUTHORIZED:')) return NextResponse.json({ error: message.replace('UNAUTHORIZED:', '') }, { status: 401 });
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

// PUT: Update an existing skill
export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { skill_id, name } = body;

        if (!skill_id || !name) {
            return NextResponse.json(
                { error: 'skill_id and name are required' },
                { status: 400 }
            );
        }

        const supabase = getSupabaseAdminClient();
        const adminContext = await resolveAdminRequestContext(request, supabase, body.email);
        const orgId = adminContext.organizationId;

        const { data: updatedSkill, error: updateError } = await supabase
            .from('skill')
            .update({ name })
            .eq('skill_id', skill_id)
            .eq('organization_id', orgId)
            .select()
            .single();

        if (updateError) {
            return NextResponse.json(
                { error: 'Failed to update skill: ' + updateError.message },
                { status: 500 }
            );
        }

        return NextResponse.json({ skill: updatedSkill });
    } catch (error) {
        console.error('Skills PUT error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

// DELETE: Delete a skill
export async function DELETE(request: NextRequest) {
    try {
        const skill_id = request.nextUrl.searchParams.get('skill_id');

        if (!skill_id) {
            return NextResponse.json(
                { error: 'skill_id is required' },
                { status: 400 }
            );
        }

        const supabase = getSupabaseAdminClient();
        const adminContext = await resolveAdminRequestContext(request, supabase, request.nextUrl.searchParams.get('email'));
        const orgId = adminContext.organizationId;

        const { error: deleteError } = await supabase
            .from('skill')
            .delete()
            .eq('skill_id', skill_id)
            .eq('organization_id', orgId);

        if (deleteError) {
            return NextResponse.json(
                { error: 'Failed to delete skill: ' + deleteError.message },
                { status: 500 }
            );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal server error';
        console.error('Skills DELETE error:', error);
        if (message.startsWith('FORBIDDEN:')) return NextResponse.json({ error: message.replace('FORBIDDEN:', '') }, { status: 403 });
        if (message.startsWith('UNAUTHORIZED:')) return NextResponse.json({ error: message.replace('UNAUTHORIZED:', '') }, { status: 401 });
        if (message === 'Missing admin email') return NextResponse.json({ error: message }, { status: 400 });
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
