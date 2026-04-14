import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  getRoleIdByName,
  resolveAdminRequestContext,
} from "@/lib/adminQueries";

async function validateInstructorInOrg(
  supabase: any,
  instructorPersonId: string,
  organizationId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: instructorOrg, error: instructorOrgError } = await supabase
    .from("person_organization")
    .select("person_organization_id")
    .eq("person_id", instructorPersonId)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();

  if (instructorOrgError) {
    return {
      ok: false,
      error: `Failed to validate instructor org membership: ${instructorOrgError.message}`,
    };
  }

  if (!instructorOrg) {
    return {
      ok: false,
      error: "Instructor is not active in this organization.",
    };
  }

  const instructorRoleId = await getRoleIdByName(supabase, "instructor");
  if (!instructorRoleId) {
    return { ok: false, error: "Instructor role not found." };
  }

  const { data: instructorRoleRow, error: instructorRoleError } = await supabase
    .from("person_org_role")
    .select("role_id")
    .eq("person_organization_id", instructorOrg.person_organization_id)
    .eq("role_id", instructorRoleId)
    .maybeSingle();

  if (instructorRoleError) {
    return {
      ok: false,
      error: `Failed to validate instructor role: ${instructorRoleError.message}`,
    };
  }

  if (!instructorRoleRow) {
    return {
      ok: false,
      error: "Person does not have instructor role in this organization.",
    };
  }

  return { ok: true };
}

async function validateMemberInOrg(
  supabase: any,
  memberId: string,
  organizationId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: member, error: memberError } = await supabase
    .from("member")
    .select("member_id")
    .eq("member_id", memberId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (memberError) {
    return {
      ok: false,
      error: `Failed to validate member org membership: ${memberError.message}`,
    };
  }

  return member
    ? { ok: true }
    : { ok: false, error: "Member is not in this organization." };
}

export async function GET(request: NextRequest) {  return NextResponse.json(
    { error: "This endpoint is not implemented. Instructor assignments are now managed through group memberships." },
    { status: 501 },
  );
}

