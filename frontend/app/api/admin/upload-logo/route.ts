import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  getOrgIdByEmail,
  getActivePersonOrganizations,
} from "@/lib/adminQueries";

// Role IDs from seed data
const ORG_ADMIN_ROLE_ID = 2; // org_admin
const SUPER_ADMIN_ROLE_ID = 1; // super_admin

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseAdminClient();

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const email = formData.get("email") as string | null;

    if (!file || !email) {
      return NextResponse.json(
        { error: "File and email are required" },
        { status: 400 },
      );
    }

    const orgId = await getOrgIdByEmail(supabase, email);
    if (!orgId) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 },
      );
    }

    const { data: person, error: personError } = await supabase
      .from("person")
      .select("person_id")
      .eq("email", email)
      .single();

    if (personError || !person) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const personOrgs = await getActivePersonOrganizations(supabase, orgId);

    const userPersonOrg = personOrgs.find(
      (po: any) => po.person_id === person.person_id,
    );

    if (!userPersonOrg) {
      return NextResponse.json(
        { error: "User not found in organization" },
        { status: 403 },
      );
    }

    const { data: roles, error: rolesError } = await supabase
      .from("person_org_role")
      .select("role_id")
      .eq("person_organization_id", userPersonOrg.person_organization_id);

    if (rolesError || !roles) {
      return NextResponse.json(
        { error: "Failed to verify roles" },
        { status: 500 },
      );
    }

    const isAdmin = roles.some(
      (r: any) =>
        r.role_id === ORG_ADMIN_ROLE_ID || r.role_id === SUPER_ADMIN_ROLE_ID,
    );

    if (!isAdmin) {
      return NextResponse.json(
        { error: "Unauthorized: Admin access required" },
        { status: 403 },
      );
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

    const { data: publicUrlData } = supabase.storage
      .from("organization-logos")
      .getPublicUrl(filePath);

    return NextResponse.json({
      success: true,
      path: filePath,
      // Append timestamp to bust browser cache
      publicUrl: publicUrlData?.publicUrl
        ? `${publicUrlData.publicUrl}?t=${Date.now()}`
        : null,
    });
  } catch (error) {
    console.error("Upload logo error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = getSupabaseAdminClient();

    const { searchParams } = req.nextUrl;
    const email = searchParams.get("email");
    if (!email)
      return NextResponse.json({ error: "Email required" }, { status: 400 });

    const orgId = await getOrgIdByEmail(supabase, email);
    if (!orgId)
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 },
      );

    const { data: person, error: personError } = await supabase
      .from("person")
      .select("person_id")
      .eq("email", email)
      .single();

    if (personError || !person)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    const personOrgs = await getActivePersonOrganizations(supabase, orgId);
    const userPersonOrg = personOrgs.find(
      (po: any) => po.person_id === person.person_id,
    );
    if (!userPersonOrg)
      return NextResponse.json(
        { error: "User not found in organization" },
        { status: 403 },
      );

    const { data: roles, error: rolesError } = await supabase
      .from("person_org_role")
      .select("role_id")
      .eq("person_organization_id", userPersonOrg.person_organization_id);

    if (rolesError || !roles)
      return NextResponse.json(
        { error: "Failed to verify roles" },
        { status: 500 },
      );

    const isAdmin = roles.some(
      (r) =>
        r.role_id === ORG_ADMIN_ROLE_ID || r.role_id === SUPER_ADMIN_ROLE_ID,
    );
    if (!isAdmin)
      return NextResponse.json(
        { error: "Unauthorized: Admin access required" },
        { status: 403 },
      );

    const filePath = `${orgId}/logo.png`;
    const { error: deleteError } = await supabase.storage
      .from("organization-logos")
      .remove([filePath]);

    if (deleteError)
      return NextResponse.json(
        { error: "Failed to delete logo" },
        { status: 500 },
      );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete logo error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
