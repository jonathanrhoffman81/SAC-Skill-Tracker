/**
 * Admin Swimmers API Route
 * Purpose: Fetch swimmers for an organization
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { resolveAdminRequestContext } from "@/lib/adminQueries";

// GET: Fetch all swimmers (members) for an organization
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdminClient();
    const adminContext = await resolveAdminRequestContext(
      request,
      supabase,
      request.nextUrl.searchParams.get("email"),
    );
    const orgId = adminContext.organizationId;

    const { data: members, error: membersError } = await supabase
      .from("member")
      .select("member_id, first_name, last_name, created_at")
      .eq("organization_id", orgId);

    if (membersError) {
      return NextResponse.json(
        { error: `Failed to load swimmers: ${membersError.message}` },
        { status: 500 },
      );
    }

    // Return all members; dedupe by member_id at UI layer if needed.
    const swimmers = (members || [])
      .map((member: any) => ({ ...member, person_id: member.member_id }))
      .sort((a: any, b: any) => {
        const aName = `${a.first_name || ""} ${a.last_name || ""}`
          .trim()
          .toLowerCase();
        const bName = `${b.first_name || ""} ${b.last_name || ""}`
          .trim()
          .toLowerCase();
        return aName.localeCompare(bName);
      });

    return NextResponse.json({ swimmers });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("Swimmers GET error:", error);
    if (message.startsWith("FORBIDDEN:"))
      return NextResponse.json(
        { error: message.replace("FORBIDDEN:", "") },
        { status: 403 },
      );
    if (message.startsWith("UNAUTHORIZED:"))
      return NextResponse.json(
        { error: message.replace("UNAUTHORIZED:", "") },
        { status: 401 },
      );
    if (message === "Missing admin email")
      return NextResponse.json({ error: message }, { status: 400 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// TODO: Implement swimmer creation flow.
export async function POST() {
  return NextResponse.json({ error: "Not implemented yet" }, { status: 501 });
}

// TODO: Implement swimmer update flow.
export async function PUT() {
  return NextResponse.json({ error: "Not implemented yet" }, { status: 501 });
}

// TODO: Implement swimmer delete flow.
export async function DELETE() {
  return NextResponse.json({ error: "Not implemented yet" }, { status: 501 });
}
