/**
 * Admin Skills API Route
 * Purpose: CRUD operations for skills in an organization
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabaseAdmin';
import { getOrgIdByEmail } from '@/lib/adminQueries';

// GET: Fetch all skills for an organization
export async function GET(request: NextRequest) {
    try {
        const email = request.nextUrl.searchParams.get('email');

        if (!email) {
            return NextResponse.json(
                { error: 'Email is required' },
                { status: 400 }
            );
        }

        const supabase = getSupabaseAdminClient();
        const orgId = await getOrgIdByEmail(supabase, email);
        if (!orgId) {
            return NextResponse.json(
                { error: 'Failed to find organization' },
                { status: 500 }
            );
        }

        // Get all skills for this organization
        const { data: skills, error: skillsError } = await supabase
            .from('skill')
            .select('skill_id, name, organization_id, created_at')
            .eq('organization_id', orgId)
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
        const { email, name } = body;

        if (!email || !name) {
            return NextResponse.json(
                { error: 'Email and name are required' },
                { status: 400 }
            );
        }

        const supabase = getSupabaseAdminClient();
        const orgId = await getOrgIdByEmail(supabase, email);
        if (!orgId) {
            return NextResponse.json(
                { error: 'Failed to find organization' },
                { status: 500 }
            );
        }

        // Create the skill
        const { data: newSkill, error: createError } = await supabase
            .from('skill')
            .insert({
                name,
                organization_id: orgId,
            })
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

// PUT: Update an existing skill
export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { email, skill_id, name } = body;

        if (!email || !skill_id || !name) {
            return NextResponse.json(
                { error: 'Email, skill_id, and name are required' },
                { status: 400 }
            );
        }

        const supabase = getSupabaseAdminClient();
        const orgId = await getOrgIdByEmail(supabase, email);
        if (!orgId) {
            return NextResponse.json(
                { error: 'Failed to find organization' },
                { status: 500 }
            );
        }

        // Update the skill (only if it belongs to this organization)
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
        const email = request.nextUrl.searchParams.get('email');
        const skill_id = request.nextUrl.searchParams.get('skill_id');

        if (!email || !skill_id) {
            return NextResponse.json(
                { error: 'Email and skill_id are required' },
                { status: 400 }
            );
        }

        const supabase = getSupabaseAdminClient();
        const orgId = await getOrgIdByEmail(supabase, email);
        if (!orgId) {
            return NextResponse.json(
                { error: 'Failed to find organization' },
                { status: 500 }
            );
        }

        // Delete the skill (only if it belongs to this organization)
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
        console.error('Skills DELETE error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
