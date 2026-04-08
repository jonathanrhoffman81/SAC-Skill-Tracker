import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { resolveAdminRequestContext } from "@/lib/adminQueries";

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdminClient();

    const adminContext = await resolveAdminRequestContext(
      req,
      supabase,
      req.nextUrl.searchParams.get("email"),
    );
    const orgId = adminContext.organizationId;
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
    const message = err instanceof Error ? err.message : "Internal server error";
    if (message.startsWith("FORBIDDEN:")) {
      return NextResponse.json({ error: message.replace("FORBIDDEN:", "") }, { status: 403 });
    }
    if (message.startsWith("UNAUTHORIZED:")) {
      return NextResponse.json({ error: message.replace("UNAUTHORIZED:", "") }, { status: 401 });
    }
    if (message === "Missing admin email") {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
