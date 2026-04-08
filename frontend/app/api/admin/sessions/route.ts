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
