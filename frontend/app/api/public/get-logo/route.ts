import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdminClient();

    const orgId = req.nextUrl.searchParams.get("orgId");

    if (!orgId) {
      return NextResponse.json({ error: "Missing orgId" }, { status: 400 });
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
