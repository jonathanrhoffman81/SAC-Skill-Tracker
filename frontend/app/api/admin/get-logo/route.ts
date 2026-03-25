import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getOrgIdByEmail } from "@/lib/adminQueries";

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdminClient();

    const email = req.nextUrl.searchParams.get("email");
    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    // Get org ID
    const orgId = await getOrgIdByEmail(supabase, email);
    if (!orgId) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 },
      );
    }

    const filePath = `${orgId}/logo.png`;

    // Check if file exists in the bucket
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

    // File exists, get public URL
    const { data } = supabase.storage
      .from("organization-logos")
      .getPublicUrl(filePath);

    // Add cache-buster to prevent stale CDN caching
    const publicUrl = data?.publicUrl
      ? `${data.publicUrl}?t=${Date.now()}`
      : null;

    return NextResponse.json({ publicUrl });
  } catch (err) {
    console.error("Get logo error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
