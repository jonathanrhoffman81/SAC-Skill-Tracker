import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getCurrentPersonFromRequest } from "@/lib/serverAuth";

// Role IDs
const ORG_ADMIN_ROLE_ID = 2;
const SUPER_ADMIN_ROLE_ID = 1;

// Helper: get org + role validation
async function getAuthorizedOrg(supabase: any, personId: string) {
  const { data: personOrg, error } = await supabase
    .from("person_organization")
    .select("organization_id, person_organization_id")
    .eq("person_id", personId)
    .maybeSingle();

  if (error || !personOrg) return null;

  const { data: roles } = await supabase
    .from("person_org_role")
    .select("role_id")
    .eq("person_organization_id", personOrg.person_organization_id);

  const isAdmin = roles?.some(
    (r: any) =>
      r.role_id === ORG_ADMIN_ROLE_ID || r.role_id === SUPER_ADMIN_ROLE_ID,
  );

  if (!isAdmin) return null;

  return personOrg.organization_id;
}

// ================= POST (UPLOAD LOGO) =================
export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseAdminClient();

    const person = await getCurrentPersonFromRequest(req);
    if (!person) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const orgId = await getAuthorizedOrg(supabase, person.personId);
    if (!orgId) {
      return NextResponse.json(
        { error: "Unauthorized: Admin access required" },
        { status: 403 },
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Only image files are allowed" },
        { status: 400 },
      );
    }

    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File must be under 2MB" },
        { status: 400 },
      );
    }

    const filePath = `${orgId}/logo.png`;

    const { error: uploadError } = await supabase.storage
      .from("organization-logos")
      .upload(filePath, file, {
        upsert: true,
        contentType: file.type,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return NextResponse.json(
        { error: "Failed to upload logo" },
        { status: 500 },
      );
    }

    const { data } = supabase.storage
      .from("organization-logos")
      .getPublicUrl(filePath);

    return NextResponse.json({
      success: true,
      publicUrl: data?.publicUrl ? `${data.publicUrl}?t=${Date.now()}` : null,
    });
  } catch (error) {
    console.error("Upload logo error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ================= DELETE (REMOVE LOGO) =================
export async function DELETE(req: NextRequest) {
  try {
    const supabase = getSupabaseAdminClient();

    const person = await getCurrentPersonFromRequest(req);
    if (!person) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const orgId = await getAuthorizedOrg(supabase, person.personId);
    if (!orgId) {
      return NextResponse.json(
        { error: "Unauthorized: Admin access required" },
        { status: 403 },
      );
    }

    const filePath = `${orgId}/logo.png`;

    const { error: deleteError } = await supabase.storage
      .from("organization-logos")
      .remove([filePath]);

    if (deleteError) {
      return NextResponse.json(
        { error: "Failed to delete logo" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete logo error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
