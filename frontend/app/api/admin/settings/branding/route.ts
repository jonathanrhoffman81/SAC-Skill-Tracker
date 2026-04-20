import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { resolveAdminRequestContext } from "@/lib/adminQueries";

function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!match) return null;

  const raw = match[1];
  if (raw.length === 3) {
    return `#${raw
      .split("")
      .map((char) => `${char}${char}`)
      .join("")
      .toUpperCase()}`;
  }

  return `#${raw.toUpperCase()}`;
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = getSupabaseAdminClient();
    const adminContext = await resolveAdminRequestContext(request, supabase);

    const body = await request.json().catch(() => ({}));
    const headerColorRaw = body?.headerColor;

    if (headerColorRaw !== null && headerColorRaw !== undefined) {
      const normalized = normalizeHexColor(headerColorRaw);
      if (!normalized) {
        return NextResponse.json(
          { error: "headerColor must be a valid hex color (e.g. #1D4ED8)." },
          { status: 400 },
        );
      }

      const { error } = await supabase
        .from("organization")
        .update({ header_color: normalized })
        .eq("organization_id", adminContext.organizationId);

      if (error) {
        if (
          error.code === "42703" ||
          String(error.message || "").toLowerCase().includes("header_color")
        ) {
          return NextResponse.json(
            {
              error:
                "Header color is not enabled in this database yet. Run supabase/admin_dashboard_header_color.sql first.",
            },
            { status: 400 },
          );
        }
        throw new Error(error.message || "Failed to save branding settings");
      }

      return NextResponse.json({ success: true, headerColor: normalized });
    }

    const { error } = await supabase
      .from("organization")
      .update({ header_color: null })
      .eq("organization_id", adminContext.organizationId);

    if (error) {
      if (
        error.code === "42703" ||
        String(error.message || "").toLowerCase().includes("header_color")
      ) {
        return NextResponse.json(
          {
            error:
              "Header color is not enabled in this database yet. Run supabase/admin_dashboard_header_color.sql first.",
          },
          { status: 400 },
        );
      }
      throw new Error(error.message || "Failed to clear branding settings");
    }

    return NextResponse.json({ success: true, headerColor: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";

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

    if (message === "Missing admin email" || message === "Failed to find organization") {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
