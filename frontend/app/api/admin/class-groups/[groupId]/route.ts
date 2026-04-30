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

        // Find which slots this group's members occupy
        const { data: thisGroupSlots } = await supabase
            .from("enrollment")
            .select("slot")
            .eq("group_id", params.groupId)
            .not("slot", "is", null);

        const slotValues = Array.from(new Set((thisGroupSlots || []).map((r: any) => r.slot).filter(Boolean)));

        // Find other groups in this class that share any of the same slots
        let conflictingGroupIds: string[] = [];
        if (slotValues.length > 0) {
            const { data: sameSlotEnrollments } = await supabase
                .from("enrollment")
                .select("group_id")
                .eq("class_id", groupRow.class_id)
                .in("slot", slotValues)
                .not("group_id", "is", null)
                .neq("group_id", params.groupId);

            conflictingGroupIds = Array.from(new Set((sameSlotEnrollments || []).map((r: any) => r.group_id).filter(Boolean)));
        }

        // Only check for duplicate name within groups that share the same slot
        if (conflictingGroupIds.length > 0) {
            const { data: dup, error: dupError } = await supabase
                .from("class_group")
                .select("group_id")
                .in("group_id", conflictingGroupIds)
                .ilike("name", newName)
                .maybeSingle();

            if (dupError) {
                return NextResponse.json(
                    { error: `Failed to validate group name: ${dupError.message}` },
                    { status: 500 },
                );
            }
            if (dup) {
                return NextResponse.json(
                    { error: "Another group in this class and slot already uses that name" },
                    { status: 409 },
                );
            }
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
