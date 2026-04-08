import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { resolveAdminRequestContext } from "@/lib/adminQueries";

export async function GET(request: NextRequest) {
    try {
        const supabase = getSupabaseAdminClient();
        const adminContext = await resolveAdminRequestContext(
            request,
            supabase,
            request.nextUrl.searchParams.get("email"),
        );
        const organizationId = adminContext.organizationId;

        const { data: sessions, error } = await supabase
            .from("organization_session")
            .select("session_id, name, start_date, end_date")
            .eq("organization_id", organizationId)
            .order("start_date", { ascending: true });

        if (error) {
            return NextResponse.json(
                { error: `Failed to load sessions: ${error.message}` },
                { status: 500 },
            );
        }

        return NextResponse.json({ sessions: sessions || [] });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Internal server error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const startDate = body.start_date ?? null;
        const endDate = body.end_date ?? null;

        if (!name) {
            return NextResponse.json({ error: "Name is required" }, { status: 400 });
        }

        if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
            return NextResponse.json(
                { error: "Start date must be before end date" },
                { status: 400 },
            );
        }

        const supabase = getSupabaseAdminClient();
        const adminContext = await resolveAdminRequestContext(
            request,
            supabase,
            body.email || body.admin_email,
        );
        const organizationId = adminContext.organizationId;

        const { data: session, error } = await supabase
            .from("organization_session")
            .insert({
                organization_id: organizationId,
                name,
                start_date: startDate || null,
                end_date: endDate || null,
            })
            .select("session_id, name, start_date, end_date")
            .single();

        if (error) {
            return NextResponse.json(
                { error: `Failed to create session: ${error.message}` },
                { status: 500 },
            );
        }

        return NextResponse.json({ session }, { status: 201 });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Internal server error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const sessionId = body.session_id as string | undefined;
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const startDate = body.start_date ?? null;
        const endDate = body.end_date ?? null;

        if (!sessionId || !name) {
            return NextResponse.json(
                { error: "session_id and name are required" },
                { status: 400 },
            );
        }

        if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
            return NextResponse.json(
                { error: "Start date must be before end date" },
                { status: 400 },
            );
        }

        const supabase = getSupabaseAdminClient();
        const adminContext = await resolveAdminRequestContext(
            request,
            supabase,
            body.email || body.admin_email,
        );
        const organizationId = adminContext.organizationId;

        const { data: session, error } = await supabase
            .from("organization_session")
            .update({
                name,
                start_date: startDate || null,
                end_date: endDate || null,
            })
            .eq("session_id", sessionId)
            .eq("organization_id", organizationId)
            .select("session_id, name, start_date, end_date")
            .single();

        if (error) {
            return NextResponse.json(
                { error: `Failed to update session: ${error.message}` },
                { status: 500 },
            );
        }

        return NextResponse.json({ session });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Internal server error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const sessionId = request.nextUrl.searchParams.get("session_id");
        if (!sessionId) {
            return NextResponse.json(
                { error: "session_id is required" },
                { status: 400 },
            );
        }

        const supabase = getSupabaseAdminClient();
        const adminContext = await resolveAdminRequestContext(
            request,
            supabase,
            request.nextUrl.searchParams.get("email"),
        );
        const organizationId = adminContext.organizationId;

        const { error } = await supabase
            .from("organization_session")
            .delete()
            .eq("session_id", sessionId)
            .eq("organization_id", organizationId);

        if (error) {
            return NextResponse.json(
                { error: `Failed to delete session: ${error.message}` },
                { status: 500 },
            );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Internal server error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
