import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { resolveAdminRequestContext } from "@/lib/adminQueries";

type RouteContext = { params: { memberId: string } };

async function ensureMemberInOrg(
    supabase: any,
    memberId: string,
    organizationId: string,
) {
    const { data, error } = await supabase
        .from("member")
        .select("member_id, organization_id, first_name, last_name, is_active")
        .eq("member_id", memberId)
        .maybeSingle();

    if (error) throw new Error(`Failed to load swimmer: ${error.message}`);
    if (!data || data.organization_id !== organizationId) {
        throw new Error("NOT_FOUND:Swimmer not found in this organization");
    }
    return data;
}

async function ensureClassInOrg(
    supabase: any,
    classId: string,
    organizationId: string,
) {
    const { data, error } = await supabase
        .from("class_entity")
        .select("class_id, organization_id, name")
        .eq("class_id", classId)
        .maybeSingle();

    if (error) throw new Error(`Failed to load class: ${error.message}`);
    if (!data || data.organization_id !== organizationId) {
        throw new Error("NOT_FOUND:Class not found in this organization");
    }
    return data;
}

async function ensureGroupInClass(
    supabase: any,
    groupId: string,
    classId: string,
) {
    const { data, error } = await supabase
        .from("class_group")
        .select("group_id, class_id")
        .eq("group_id", groupId)
        .maybeSingle();

    if (error) throw new Error(`Failed to load class group: ${error.message}`);
    if (!data || data.class_id !== classId) {
        throw new Error("BAD_REQUEST:Group does not belong to that class");
    }
    return data;
}

function errorResponse(error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    if (message.startsWith("FORBIDDEN:")) {
        return NextResponse.json({ error: message.slice(10) }, { status: 403 });
    }
    if (message.startsWith("UNAUTHORIZED:")) {
        return NextResponse.json({ error: message.slice(13) }, { status: 401 });
    }
    if (message.startsWith("NOT_FOUND:")) {
        return NextResponse.json({ error: message.slice(10) }, { status: 404 });
    }
    if (message.startsWith("BAD_REQUEST:")) {
        return NextResponse.json({ error: message.slice(12) }, { status: 400 });
    }
    if (message === "Missing admin email") {
        return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(request: NextRequest, { params }: RouteContext) {
    try {
        const supabase = getSupabaseAdminClient();
        const { organizationId } = await resolveAdminRequestContext(request, supabase);

        const member = await ensureMemberInOrg(supabase, params.memberId, organizationId);

        const { data: enrollmentRows, error: enrollmentError } = await supabase
            .from("enrollment")
            .select("class_id, group_id, slot, enrolled_at")
            .eq("member_id", params.memberId);

        if (enrollmentError) {
            throw new Error(`Failed to load enrollments: ${enrollmentError.message}`);
        }

        const { data: classRows, error: classError } = await supabase
            .from("class_entity")
            .select("class_id, name, schedule, schedule_days, schedule_time, start_date, end_date")
            .eq("organization_id", organizationId)
            .order("name");

        if (classError) {
            throw new Error(`Failed to load classes: ${classError.message}`);
        }

        const classIdsInOrg = new Set((classRows || []).map((c: any) => c.class_id));

        const { data: groupRows, error: groupError } = await supabase
            .from("class_group")
            .select("group_id, class_id, name")
            .in(
                "class_id",
                Array.from(classIdsInOrg).length > 0 ? Array.from(classIdsInOrg) : ["__none__"],
            );

        if (groupError) {
            throw new Error(`Failed to load class groups: ${groupError.message}`);
        }

        const groupsByClassId = new Map<string, Array<{ group_id: string; name: string }>>();
        (groupRows || []).forEach((g: any) => {
            const list = groupsByClassId.get(g.class_id) || [];
            list.push({ group_id: g.group_id, name: g.name });
            groupsByClassId.set(g.class_id, list);
        });

        const classNameById = new Map<string, string>();
        (classRows || []).forEach((c: any) => classNameById.set(c.class_id, c.name));

        const groupNameById = new Map<string, string>();
        (groupRows || []).forEach((g: any) => groupNameById.set(g.group_id, g.name));

        // Count this swimmer's evaluations per class so the UI can disable
        // the Remove button when there's history to protect.
        // One submission writes 1 anchor + N skill-note rows sharing
        // (class_id, evaluation_date, instructor_person_id) — dedupe by tuple
        // so counts reflect submissions, not rows.
        const { data: evalRows, error: evalRowsError } = await supabase
            .from("evaluation")
            .select("class_id, evaluation_date, instructor_person_id")
            .eq("member_id", params.memberId);

        if (evalRowsError) {
            throw new Error(`Failed to load evaluations: ${evalRowsError.message}`);
        }

        const submissionKeysByClassId = new Map<string, Set<string>>();
        (evalRows || []).forEach((row: any) => {
            if (!row.class_id) return;
            const key = `${row.evaluation_date ?? ""}|${row.instructor_person_id ?? ""}`;
            const seen = submissionKeysByClassId.get(row.class_id) ?? new Set<string>();
            seen.add(key);
            submissionKeysByClassId.set(row.class_id, seen);
        });
        const evaluationCountByClassId = new Map<string, number>();
        submissionKeysByClassId.forEach((set, classId) => {
            evaluationCountByClassId.set(classId, set.size);
        });

        // Reject enrollments whose class isn't in this org (defensive — shouldn't
        // happen given normal data flow, but skip rather than expose).
        const enrollments = (enrollmentRows || [])
            .filter((row: any) => classIdsInOrg.has(row.class_id))
            .map((row: any) => ({
                class_id: row.class_id,
                class_name: classNameById.get(row.class_id) || "(unknown)",
                group_id: row.group_id ?? null,
                group_name: row.group_id ? groupNameById.get(row.group_id) ?? null : null,
                slot: row.slot,
                enrolled_at: row.enrolled_at,
                evaluation_count: evaluationCountByClassId.get(row.class_id) ?? 0,
            }));

        const availableClasses = (classRows || []).map((c: any) => ({
            class_id: c.class_id,
            name: c.name,
            schedule: c.schedule,
            schedule_days: c.schedule_days,
            schedule_time: c.schedule_time,
            start_date: c.start_date,
            end_date: c.end_date,
            groups: groupsByClassId.get(c.class_id) || [],
        }));

        return NextResponse.json({
            member: {
                member_id: member.member_id,
                first_name: member.first_name,
                last_name: member.last_name,
                is_active: member.is_active,
            },
            enrollments,
            availableClasses,
        });
    } catch (error) {
        console.error("Member enrollments GET error:", error);
        return errorResponse(error);
    }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
    try {
        const body = (await request.json()) as {
            class_id?: string;
            group_id?: string | null;
            slot?: number;
        };

        if (!body.class_id) {
            return NextResponse.json(
                { error: "class_id is required" },
                { status: 400 },
            );
        }

        const supabase = getSupabaseAdminClient();
        const { organizationId } = await resolveAdminRequestContext(request, supabase);

        await ensureMemberInOrg(supabase, params.memberId, organizationId);
        await ensureClassInOrg(supabase, body.class_id, organizationId);

        if (body.group_id) {
            await ensureGroupInClass(supabase, body.group_id, body.class_id);
        }

        const slot =
            typeof body.slot === "number" && body.slot > 0 ? body.slot : 1;

        const { error: upsertError } = await supabase
            .from("enrollment")
            .upsert(
                {
                    member_id: params.memberId,
                    class_id: body.class_id,
                    group_id: body.group_id ?? null,
                    slot,
                },
                { onConflict: "member_id,class_id" },
            );

        if (upsertError) {
            throw new Error(`Failed to save enrollment: ${upsertError.message}`);
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Member enrollments POST error:", error);
        return errorResponse(error);
    }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
    try {
        const body = (await request.json().catch(() => ({}))) as { class_id?: string };
        const classId =
            body.class_id || request.nextUrl.searchParams.get("class_id") || "";

        if (!classId) {
            return NextResponse.json(
                { error: "class_id is required" },
                { status: 400 },
            );
        }

        const supabase = getSupabaseAdminClient();
        const { organizationId } = await resolveAdminRequestContext(request, supabase);

        await ensureMemberInOrg(supabase, params.memberId, organizationId);
        await ensureClassInOrg(supabase, classId, organizationId);

        // Refuse to unenroll a swimmer from a class they already have any
        // evaluation in — that would orphan the eval record from its class
        // context and lose history that the admin / parents rely on.
        const { count: evalCount, error: evalCountError } = await supabase
            .from("evaluation")
            .select("evaluation_id", { count: "exact", head: true })
            .eq("member_id", params.memberId)
            .eq("class_id", classId);

        if (evalCountError) {
            throw new Error(`Failed to check evaluations: ${evalCountError.message}`);
        }

        if ((evalCount ?? 0) > 0) {
            return NextResponse.json(
                {
                    error:
                        "Can't remove this swimmer from the class — they already have evaluations recorded for it. Delete the evaluations first if you really need to unenroll them.",
                    evaluationCount: evalCount,
                },
                { status: 409 },
            );
        }

        const { error: deleteError } = await supabase
            .from("enrollment")
            .delete()
            .eq("member_id", params.memberId)
            .eq("class_id", classId);

        if (deleteError) {
            throw new Error(`Failed to remove enrollment: ${deleteError.message}`);
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Member enrollments DELETE error:", error);
        return errorResponse(error);
    }
}
