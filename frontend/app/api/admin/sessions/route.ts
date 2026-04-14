import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { resolveAdminRequestContext } from "@/lib/adminQueries";

export async function GET(request: NextRequest) {
    try {
        const supabase = getSupabaseAdminClient();
        await resolveAdminRequestContext(
            request,
            supabase,
            request.nextUrl.searchParams.get("email"),
        );

        return NextResponse.json(
            { error: "Sessions are no longer supported." },
            { status: 410 },
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : "Internal server error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const supabase = getSupabaseAdminClient();
        await resolveAdminRequestContext(request, supabase);
        return NextResponse.json(
            { error: "Sessions are no longer supported." },
            { status: 410 },
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : "Internal server error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const supabase = getSupabaseAdminClient();
        await resolveAdminRequestContext(request, supabase);
        return NextResponse.json(
            { error: "Sessions are no longer supported." },
            { status: 410 },
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : "Internal server error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const supabase = getSupabaseAdminClient();
        await resolveAdminRequestContext(request, supabase);
        return NextResponse.json(
            { error: "Sessions are no longer supported." },
            { status: 410 },
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : "Internal server error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
