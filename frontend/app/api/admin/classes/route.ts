/**
 * Admin Classes API Route
 * Purpose: Manage classes for an organization
 *
 * Class Object Structure:
 * {
 *   class_id: UUID,
 *   name: string,
 *   schedule: string | null,  // e.g., "Mon/Wed/Fri 4-5pm" or "Tuesdays 3:30-4:30pm"
 *   length_minutes: number | null,  // e.g., 60 for 1 hour
 *   created_at: timestamp
 * }
 * Purpose: Fetch classes for an organization
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getOrgIdByEmail } from "@/lib/adminQueries";

// GET: Fetch all classes for an organization
export async function GET(request: NextRequest) {
  try {
    const email = request.nextUrl.searchParams.get("email");

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();
    const orgId = await getOrgIdByEmail(supabase, email);

    if (!orgId) {
      return NextResponse.json(
        { error: "Failed to find organization" },
        { status: 500 },
      );
    }

    const { data: classes, error: classesError } = await supabase
      .from("class_entity")
      .select("class_id, name, schedule, length_minutes, created_at")
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
    const adminEmail = body.admin_email || body.email;
    const name = body.name;
    const schedule = body.schedule;
    const length_minutes = body.length_minutes;

    if (!adminEmail || !name) {
      return NextResponse.json(
        { error: "Admin email and name required" },
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
    const orgId = await getOrgIdByEmail(supabase, adminEmail);

    if (!orgId) {
      return NextResponse.json(
        { error: "Failed to find organization" },
        { status: 500 },
      );
    }

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
      .select("class_id, name, schedule, length_minutes, created_at")
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
    const adminEmail = body.admin_email || body.email;
    const class_id = body.class_id;
    const name = body.name;
    const schedule = body.schedule;
    const length_minutes = body.length_minutes;

    if (!adminEmail || !class_id || !name) {
      return NextResponse.json(
        { error: "Admin email, class_id, and name required" },
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
    const orgId = await getOrgIdByEmail(supabase, adminEmail);

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

    const updateData: any = {
      name: name.trim(),
    };

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
      .select("class_id, name, schedule, length_minutes, created_at")
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
    const adminEmail = request.nextUrl.searchParams.get("email");
    const class_id = request.nextUrl.searchParams.get("class_id");

    if (!adminEmail || !class_id) {
      return NextResponse.json(
        { error: "Admin email and class_id required" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdminClient();
    const orgId = await getOrgIdByEmail(supabase, adminEmail);

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
