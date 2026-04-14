import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getCurrentPersonFromRequest } from "@/lib/serverAuth";

async function resolveOrgIdFromRequest(req: NextRequest, orgId: string | null) {
  if (orgId) return orgId;

  const person = await getCurrentPersonFromRequest(req);
  if (!person?.personId) return null;

  const supabase = getSupabaseAdminClient();
  const { data: personOrg, error } = await supabase
    .from("person_organization")
    .select("organization_id")
    .eq("person_id", person.personId)
    .maybeSingle();

  if (error) {
    console.error("Error resolving organization for logo:", error);
    return null;
  }

  return personOrg?.organization_id ?? null;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdminClient();

    const requestedOrgId = req.nextUrl.searchParams.get("orgId");
    const orgId = await resolveOrgIdFromRequest(req, requestedOrgId);

    if (!orgId) {
      return NextResponse.json({ publicUrl: null }, { status: 200 });
    }

    const filePath = `${orgId}/logo.png`;

    const { data: files, error: listError } = await supabase.storage
      .from("organization-logos")
      .list(orgId);

    if (listError) {
      console.error("Error listing files:", listError);
      return NextResponse.json(
        { error: "Failed to list files" },
        { status: 500 },
      );
    }

    const exists = files?.some((file) => file.name === "logo.png");

    if (!exists) {
      return NextResponse.json({ publicUrl: null });
    }

    const { data } = supabase.storage
      .from("organization-logos")
      .getPublicUrl(filePath);

    return NextResponse.json({
      publicUrl: data?.publicUrl ? `${data.publicUrl}?t=${Date.now()}` : null,
    });
  } catch (err) {
    console.error("Get logo error:", err);

    const message =
      err instanceof Error ? err.message : "Internal server error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
