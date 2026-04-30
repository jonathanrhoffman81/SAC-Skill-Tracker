import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { resolveAdminRequestContext } from "@/lib/adminQueries";

export async function GET(request: NextRequest) {
    try {
        const supabase = getSupabaseAdminClient();
        const { organizationId } = await resolveAdminRequestContext(request, supabase);

        const { data, error } = await supabase
            .from("member")
            .select("member_id, first_name, last_name, is_active")
            .eq("organization_id", organizationId)
            .order("first_name");

        if (error) {
            return NextResponse.json(
                { error: `Failed to load swimmers: ${error.message}` },
                { status: 500 },
            );
        }

        return NextResponse.json({ members: data || [] });
    } catch (error) {
        console.error("Admin members GET error:", error);
        const message = error instanceof Error ? error.message : "Internal server error";
        if (message.startsWith("FORBIDDEN:")) {
            return NextResponse.json({ error: message.slice(10) }, { status: 403 });
        }
        if (message.startsWith("UNAUTHORIZED:")) {
            return NextResponse.json({ error: message.slice(13) }, { status: 401 });
        }
        if (message === "Missing admin email") {
            return NextResponse.json({ error: message }, { status: 400 });
        }
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
