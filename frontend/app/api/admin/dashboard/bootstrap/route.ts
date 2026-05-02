import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { resolveAdminRequestContext } from "@/lib/adminQueries";
import { loadAdminDashboardBootstrap } from "@/lib/adminDashboardBootstrap";
import { getCachedOrRevalidate } from "@/lib/serverRouteCache";

const CACHE_MAX_AGE_MS = 15 * 1000;
const CACHE_STALE_REVALIDATE_MS = 2 * 60 * 1000;

function withCacheHeaders(response: NextResponse, cacheStatus: string) {
  response.headers.set("Cache-Control", "private, max-age=15, stale-while-revalidate=120");
  response.headers.set("X-Cache-Status", cacheStatus);
  return response;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdminClient();
    const adminContext = await resolveAdminRequestContext(
      request,
      supabase,
      request.nextUrl.searchParams.get("email"),
    );

    const cacheKey = `admin-dashboard-bootstrap:v2:${adminContext.organizationId}`;

    const { value, cacheStatus } = await getCachedOrRevalidate({
      key: cacheKey,
      maxAgeMs: CACHE_MAX_AGE_MS,
      staleWhileRevalidateMs: CACHE_STALE_REVALIDATE_MS,
      loader: async () =>
        loadAdminDashboardBootstrap(supabase, adminContext.organizationId),
    });

    const { data: personRow } = await supabase
      .from("person")
      .select("first_name, last_name")
      .eq("person_id", adminContext.personId)
      .maybeSingle();
    function formatEmailToName(email?: string | null): string | null {
      if (!email) return null;
      const local = String(email).split("@")[0];
      const words = local.replace(/[._\-]+/g, " ").split(" ").filter(Boolean);
      if (words.length === 0) return null;
      return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
    }

    const userName =
      `${personRow?.first_name ?? ""} ${personRow?.last_name ?? ""}`.trim() ||
      formatEmailToName(adminContext.email) ||
      adminContext.email ||
      null;

    return withCacheHeaders(NextResponse.json({ ...value, userName }), cacheStatus);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    console.error("Admin dashboard bootstrap error:", error);

    if (message.startsWith("FORBIDDEN:")) {
      return NextResponse.json(
        { error: message.replace("FORBIDDEN:", "") },
        { status: 403 },
      );
    }

    if (message.startsWith("UNAUTHORIZED:")) {
      return NextResponse.json(
        { error: message.replace("UNAUTHORIZED:", "") },
        { status: 401 },
      );
    }

    if (
      message === "Missing admin email" ||
      message === "Failed to find organization"
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
