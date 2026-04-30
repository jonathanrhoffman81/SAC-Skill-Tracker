import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { resolveAdminRequestContext } from "@/lib/adminQueries";

type RouteContext = { params: { groupId: string } };

function errorResponse(error: unknown) {
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

export async function PATCH(request: NextRequest, { params }: RouteContext) {
    try {
        const body = (await request.json()) as { name?: string };
        const newName = (body.name || "").trim();

        if (!newName) {
            return NextResponse.json(
                { error: "name is required" },
                { status: 400 },
            );
        }

        if (newName.length > 200) {
            return NextResponse.json(
                { error: "Group name is too long" },
                { status: 400 },
            );
        }

        const supabase = getSupabaseAdminClient();
        const { organizationId } = await resolveAdminRequestContext(request, supabase);

        const { data: groupRow, error: groupError } = await supabase
            .from("class_group")
            .select("group_id, class_id, class_entity!inner(organization_id)")
            .eq("group_id", params.groupId)
            .eq("class_entity.organization_id", organizationId)
            .maybeSingle();

        if (groupError) {
            return NextResponse.json(
                { error: `Failed to load group: ${groupError.message}` },
                { status: 500 },
            );
        }
        if (!groupRow) {
            return NextResponse.json(
                { error: "Group not found in this organization" },
                { status: 404 },
            );
        }

        const { data: dup, error: dupError } = await supabase
            .from("class_group")
            .select("group_id")
            .eq("class_id", groupRow.class_id)
            .ilike("name", newName)
            .neq("group_id", params.groupId)
            .maybeSingle();

        if (dupError) {
            return NextResponse.json(
                { error: `Failed to validate group name: ${dupError.message}` },
                { status: 500 },
            );
        }
        if (dup) {
            return NextResponse.json(
                { error: "Another group in this class already uses that name" },
                { status: 409 },
            );
        }

        const { error: updateError } = await supabase
            .from("class_group")
            .update({ name: newName })
            .eq("group_id", params.groupId);

        if (updateError) {
            return NextResponse.json(
                { error: `Failed to rename group: ${updateError.message}` },
                { status: 500 },
            );
        }

        return NextResponse.json({ success: true, name: newName });
    } catch (error) {
        console.error("Class group PATCH error:", error);
        return errorResponse(error);
    }
}
