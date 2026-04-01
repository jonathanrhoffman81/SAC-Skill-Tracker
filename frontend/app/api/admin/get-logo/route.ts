import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getCurrentPersonFromRequest } from "@/lib/serverAuth";

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdminClient();

    const person = await getCurrentPersonFromRequest(req);
    if (!person) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: personOrg, error } = await supabase
      .from("person_organization")
      .select("organization_id")
      .eq("person_id", person.personId)
      .maybeSingle();

    if (error || !personOrg) {
      return NextResponse.json({ publicUrl: null });
    }

    const orgId = personOrg.organization_id;
    const filePath = `${orgId}/logo.png`;

    // Check if file exists
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
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
