/**
 * Admin Classes API Route
 * Purpose: Manage classes for an organization
 *
 * Class Object Structure:
 * {
 *   class_id: UUID,
 *   name: string,
 *   schedule: string | null,  // e.g., "Mon/Wed/Fri 4-5pm" or "Tuesdays 3:30-4:30pm"
 *   start_date: date | null,
 *   end_date: date | null,
 *   length_minutes: number | null,  // e.g., 60 for 1 hour
 *   created_at: timestamp
 * }
 * Purpose: Fetch classes for an organization
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { resolveAdminRequestContext } from "@/lib/adminQueries";

// GET: Fetch all classes for an organization
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdminClient();
    const adminContext = await resolveAdminRequestContext(request, supabase, request.nextUrl.searchParams.get("email"));
    const orgId = adminContext.organizationId;

    const { data: classes, error: classesError } = await supabase
      .from("class_entity")
      .select("class_id, name, schedule, start_date, end_date, length_minutes, created_at")
      .eq("organization_id", orgId)
      .order("name", { ascending: true });

    if (classesError) {
      return NextResponse.json(
        { error: "Failed to load classes: " + classesError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ classes: classes || [] });
  } catch (error) {
    console.error("Classes GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST: Create a new class
// Example request body:
// {
//   "admin_email": "admin@example.com",
//   "name": "Beginner Swimming",
//   "schedule": "Mon/Wed/Fri 4-5pm",  // Example schedule format
//   "length_minutes": 60
// }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = body.name;
    const schedule = body.schedule;
    const length_minutes = body.length_minutes;

    if (!name) {
      return NextResponse.json(
        { error: "Name required" },
        { status: 400 },
      );
    }

    // Validate length_minutes if provided
    if (length_minutes !== null && length_minutes !== undefined) {
      const lengthNum = parseInt(length_minutes);
      if (isNaN(lengthNum) || lengthNum <= 0) {
        return NextResponse.json(
          { error: "length_minutes must be a positive number" },
          { status: 400 },
        );
      }
    }

    const supabase = getSupabaseAdminClient();
    const adminContext = await resolveAdminRequestContext(request, supabase, body.admin_email || body.email);
    const orgId = adminContext.organizationId;

    const insertData: any = {
      organization_id: orgId,
      name: name.trim(),
    };

    if (schedule && schedule.trim()) {
      insertData.schedule = schedule.trim();
    }

    if (length_minutes !== null && length_minutes !== undefined) {
      insertData.length_minutes = parseInt(length_minutes);
    }

    const { data: newClass, error: insertError } = await supabase
      .from("class_entity")
      .insert(insertData)
      .select("class_id, name, schedule, start_date, end_date, length_minutes, created_at")
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: "Failed to create class: " + insertError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ class: newClass });
  } catch (error) {
    console.error("Classes POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// PUT: Update an existing class
// Example request body:
// {
//   "admin_email": "admin@example.com",
//   "class_id": "uuid-here",
//   "name": "Advanced Swimming",
//   "schedule": "Tuesdays 3:30-4:30pm",  // Example schedule format
//   "length_minutes": 60
// }
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const class_id = body.class_id;
    const name = body.name;
    const schedule = body.schedule;
    const start_date = body.start_date;
    const end_date = body.end_date;
    const length_minutes = body.length_minutes;

    if (!class_id || !name) {
      return NextResponse.json(
        { error: "class_id and name required" },
        { status: 400 },
      );
    }

    // Validate length_minutes if provided
    if (
      length_minutes !== null &&
      length_minutes !== undefined &&
      length_minutes !== ""
    ) {
      const lengthNum = parseInt(length_minutes);
      if (isNaN(lengthNum) || lengthNum <= 0) {
        return NextResponse.json(
          { error: "length_minutes must be a positive number" },
          { status: 400 },
        );
      }
    }

    const supabase = getSupabaseAdminClient();
    const adminContext = await resolveAdminRequestContext(request, supabase, body.admin_email || body.email);
    const orgId = adminContext.organizationId;

    // Verify class belongs to this org
    const { data: existingClass } = await supabase
      .from("class_entity")
      .select("class_id")
      .eq("class_id", class_id)
      .eq("organization_id", orgId)
      .single();

    if (!existingClass) {
      return NextResponse.json(
        { error: "Class not found in this organization" },
        { status: 404 },
      );
    }

    const updateData: any = {
      name: name.trim(),
    };

    if (start_date === null || start_date === undefined || start_date === "") {
      updateData.start_date = null;
    } else {
      updateData.start_date = start_date;
    }

    if (end_date === null || end_date === undefined || end_date === "") {
      updateData.end_date = null;
    } else {
      updateData.end_date = end_date;
    }

    // Handle schedule - allow clearing by setting to null
    if (schedule === null || schedule === undefined || schedule === "") {
      updateData.schedule = null;
    } else {
      updateData.schedule = schedule.trim();
    }

    // Handle length_minutes - allow clearing by setting to null
    if (
      length_minutes === null ||
      length_minutes === undefined ||
      length_minutes === ""
    ) {
      updateData.length_minutes = null;
    } else {
      updateData.length_minutes = parseInt(length_minutes);
    }

    const { data: updatedClass, error: updateError } = await supabase
      .from("class_entity")
      .update(updateData)
      .eq("class_id", class_id)
      .select("class_id, name, schedule, start_date, end_date, length_minutes, created_at")
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to update class: " + updateError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ class: updatedClass });
  } catch (error) {
    console.error("Classes PUT error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE: Delete a class
export async function DELETE(request: NextRequest) {
  try {
    const class_id = request.nextUrl.searchParams.get("class_id");

    if (!class_id) {
      return NextResponse.json(
        { error: "class_id required" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdminClient();
    const adminContext = await resolveAdminRequestContext(request, supabase, request.nextUrl.searchParams.get("email"));
    const orgId = adminContext.organizationId;

    if (!orgId) {
      return NextResponse.json(
        { error: "Failed to find organization" },
        { status: 500 },
      );
    }

    // Verify class belongs to this org
    const { data: existingClass } = await supabase
      .from("class_entity")
      .select("class_id")
      .eq("class_id", class_id)
      .eq("organization_id", orgId)
      .single();

    if (!existingClass) {
      return NextResponse.json(
        { error: "Class not found in this organization" },
        { status: 404 },
      );
    }

    // Get all groups for this class so we can clean up child records
    const { data: groups } = await supabase
      .from("class_group")
      .select("group_id")
      .eq("class_id", class_id);

    const groupIds = (groups ?? []).map((g: { group_id: string }) => g.group_id);

    if (groupIds.length > 0) {
      const { error: enrollmentDeleteError } = await supabase
        .from("enrollment")
        .delete()
        .in("group_id", groupIds);

      if (enrollmentDeleteError) {
        return NextResponse.json(
          { error: "Failed to delete class enrollments: " + enrollmentDeleteError.message },
          { status: 500 },
        );
      }

      const { error: instructorDeleteError } = await supabase
        .from("group_instructor")
        .delete()
        .in("group_id", groupIds);

      if (instructorDeleteError) {
        return NextResponse.json(
          { error: "Failed to delete class instructor assignments: " + instructorDeleteError.message },
          { status: 500 },
        );
      }

      const { error: groupDeleteError } = await supabase
        .from("class_group")
        .delete()
        .in("group_id", groupIds);

      if (groupDeleteError) {
        return NextResponse.json(
          { error: "Failed to delete class groups: " + groupDeleteError.message },
          { status: 500 },
        );
      }
    }

    // Cascade delete evaluations tied to this class (FK blocks class delete otherwise).
    // member_skill rows reference evaluation_id, so unlink those first.
    const { data: classEvaluations, error: classEvaluationsError } = await supabase
      .from("evaluation")
      .select("evaluation_id")
      .eq("class_id", class_id);

    if (classEvaluationsError) {
      return NextResponse.json(
        { error: "Failed to load class evaluations: " + classEvaluationsError.message },
        { status: 500 },
      );
    }

    const evaluationIds = (classEvaluations ?? []).map(
      (e: { evaluation_id: string }) => e.evaluation_id,
    );

    if (evaluationIds.length > 0) {
      const { error: memberSkillUnlinkError } = await supabase
        .from("member_skill")
        .update({ evaluation_id: null })
        .in("evaluation_id", evaluationIds);

      if (memberSkillUnlinkError) {
        return NextResponse.json(
          { error: "Failed to unlink skill history: " + memberSkillUnlinkError.message },
          { status: 500 },
        );
      }

      const { error: evaluationDeleteError } = await supabase
        .from("evaluation")
        .delete()
        .in("evaluation_id", evaluationIds);

      if (evaluationDeleteError) {
        return NextResponse.json(
          { error: "Failed to delete class evaluations: " + evaluationDeleteError.message },
          { status: 500 },
        );
      }
    }

    const { error: deleteError } = await supabase
      .from("class_entity")
      .delete()
      .eq("class_id", class_id);

    if (deleteError) {
      return NextResponse.json(
        { error: "Failed to delete class: " + deleteError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Classes DELETE error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
