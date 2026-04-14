/**
 * Import Swim Classes — Parse Route
 * POST /api/admin/import-classes
 *
 * Accepts organization_id alongside the file so it can check which class
 * names already exist in the DB. Classes that already exist are flagged
 * so the frontend skips the schedule prompt for them.
 */

import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export interface ParsedSwimRow {
  member_first: string;
  member_last: string;
  dob: string | null;
  gender: string | null;
  account_first: string;
  account_last: string;
  account_email: string;
  class_name: string;
  slot: number;
  length_minutes: number;
}

export interface UniqueClass {
  name: string;
  length_minutes: number;
  member_count: number;
  already_exists: boolean; // true → class is in the DB already, skip schedule prompt
}

function parseSlot(slotStr: string | undefined): number {
  const cleaned = (slotStr ?? "").replace("#", "").trim();
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 1 : num;
}

function parseLength(lengthStr: string | undefined): number {
  const match = (lengthStr ?? "").match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 45;
}

function splitName(raw: string): [string, string] {
  const commaIdx = raw.indexOf(", ");
  if (commaIdx === -1) return ["", ""];
  return [raw.slice(commaIdx + 2).trim(), raw.slice(0, commaIdx).trim()];
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const organization_id = formData.get("organization_id") as string | null;

    if (!file) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }
    if (!organization_id) {
      return NextResponse.json(
        { error: "organization_id is required" },
        { status: 400 },
      );
    }

    const text = await file.text();

    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
    });

    const rawRows = parsed.data;

    if (rawRows.length === 0) {
      return NextResponse.json(
        { error: "File appears to be empty" },
        { status: 400 },
      );
    }

    const firstKey = Object.keys(rawRows[0])[0];
    if (firstKey !== "New Registrations Report") {
      return NextResponse.json(
        {
          error:
            'Unrecognised file format. Expected a SportsEngine "New Registrations Report" CSV export.',
        },
        { status: 400 },
      );
    }

    // Row 0 holds the real column headers as values
    const headerRow = rawRows[0];
    const colKey: Record<string, string> = {};
    for (const key of Object.keys(headerRow)) {
      const label = headerRow[key]?.trim();
      if (label) colKey[label] = key;
    }

    const required = [
      "Account",
      "Member",
      "Member DOB",
      "Gender",
      "Email",
      "Registered Class",
      "Slot",
      "Class Length",
    ];
    const missing = required.filter((c) => !(c in colKey));
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Missing expected columns: ${missing.join(", ")}` },
        { status: 400 },
      );
    }

    const dataRows = rawRows.slice(1);
    const rows: ParsedSwimRow[] = [];
    const classMap = new Map<
      string,
      { length_minutes: number; count: number }
    >();

    for (const row of dataRows) {
      const memberRaw = row[colKey["Member"]]?.trim() ?? "";
      const accountRaw = row[colKey["Account"]]?.trim() ?? "";
      const email = row[colKey["Email"]]?.toLowerCase().trim();

      const [memberFirst, memberLast] = splitName(memberRaw);
      if (!memberFirst || !memberLast) continue;

      const [accountFirst, accountLast] = splitName(accountRaw);

      const className = row[colKey["Registered Class"]]?.trim();
      if (!className || !email) continue;

      const dob = row[colKey["Member DOB"]]?.trim() || null;
      const gender = row[colKey["Gender"]]?.trim() || null;
      const slot = parseSlot(row[colKey["Slot"]]);
      const length_minutes = parseLength(row[colKey["Class Length"]]);

      const prev = classMap.get(className);
      classMap.set(className, {
        length_minutes,
        count: (prev?.count ?? 0) + 1,
      });

      rows.push({
        member_first: memberFirst,
        member_last: memberLast,
        dob,
        gender,
        account_first: accountFirst,
        account_last: accountLast,
        account_email: email,
        class_name: className,
        slot,
        length_minutes,
      });
    }

    // Check which class names already exist in the DB for this org
    const classNames = Array.from(classMap.keys());
    const supabase = getSupabaseAdminClient();
    const { data: existingClasses } = await supabase
      .from("class_entity")
      .select("name")
      .eq("organization_id", organization_id)
      .in("name", classNames);

    const existingNameSet = new Set(
      existingClasses?.map((c: { name: string }) => c.name) ?? [],
    );

    const uniqueClasses: UniqueClass[] = Array.from(classMap.entries()).map(
      ([name, { length_minutes, count }]) => ({
        name,
        length_minutes,
        member_count: count,
        already_exists: existingNameSet.has(name),
      }),
    );

    return NextResponse.json({ uniqueClasses, rows, totalRows: rows.length });
  } catch (error) {
    console.error("Parse swim classes error:", error);
    return NextResponse.json(
      { error: "Failed to parse file" },
      { status: 500 },
    );
  }
}
