/**
 * Import Swim Classes — Parse Route
 * POST /api/admin/import-classes
 *
 * Accepts organization_id alongside the file so it can check which class
 * names already exist in the DB. Classes that already exist are flagged
 * so the frontend skips the schedule prompt for them.
 *
 * Supports CSV, XLS, and XLSX uploads.
 * Both formats are normalised to a 2-D grid first:
 *   grid[0] = sentinel row  — col 0 must equal "New Registrations Report"
 *   grid[1] = column header row — "Account", "Member", "Member DOB", …
 *   grid[2] = (Excel template only) optional hint/description row — skipped if not a data row
 *   grid[n] = data rows
 */

import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import * as XLSX from "xlsx";
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
  already_exists: boolean;
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

/**
 * Parse any supported file into a 2-D grid of strings.
 *   grid[0] = sentinel row  (col 0 = "New Registrations Report")
 *   grid[1] = real column headers ("Account", "Member", …)
 *   grid[2+] = data rows
 */
async function fileToGrid(file: File): Promise<string[][]> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "csv") {
    const text = await file.text();
    const parsed = Papa.parse<string[]>(text, {
      header: false, // raw 2-D array — no key collision problems
      skipEmptyLines: true,
    });
    return (parsed.data as string[][]).map((row) =>
      row.map((cell) => String(cell ?? "").trim()),
    );
  }

  // XLS / XLSX
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  return (raw as unknown as string[][]).map((row) =>
    row.map((cell) => String(cell ?? "").trim()),
  );
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

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["csv", "xls", "xlsx"].includes(ext)) {
      return NextResponse.json(
        { error: "Only CSV, XLS, or XLSX files are accepted." },
        { status: 400 },
      );
    }

    const grid = await fileToGrid(file);

    if (grid.length < 2) {
      return NextResponse.json(
        { error: "File appears to be empty or has no data rows." },
        { status: 400 },
      );
    }

    /* ── Sentinel check ── */
    // Strip BOM from first cell in case the CSV was saved with UTF-8 BOM
    const sentinelCell = grid[0][0].replace(/^\uFEFF/, "");
    if (sentinelCell !== "New Registrations Report") {
      return NextResponse.json(
        {
          error:
            'Unrecognised file format. The first cell must be "New Registrations Report". ' +
            "Download the template from the import screen to get started.",
        },
        { status: 400 },
      );
    }

    /* ── Column header row (grid[1]) ── */
    const headers = grid[1];
    // Build label → column-index map (case-insensitive trim for safety)
    const colIndex: Record<string, number> = {};
    headers.forEach((h, i) => {
      if (h) colIndex[h.trim()] = i;
    });

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
    const missing = required.filter((c) => !(c in colIndex));
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Missing expected columns: ${missing.join(", ")}` },
        { status: 400 },
      );
    }

    /* ── Data rows (grid[2+]) ── */
    // Skip any row where the Email cell doesn't look like an email — this
    // catches description/hint rows that the Excel template includes.
    const rows: ParsedSwimRow[] = [];
    const classMap = new Map<
      string,
      { length_minutes: number; count: number }
    >();

    for (const row of grid.slice(2)) {
      const get = (label: string) => (row[colIndex[label]] ?? "").trim();

      const email = get("Email").toLowerCase();
      if (!email.includes("@")) continue; // skip hint rows or blank rows

      const memberRaw = get("Member");
      const accountRaw = get("Account");

      const [memberFirst, memberLast] = splitName(memberRaw);
      if (!memberFirst || !memberLast) continue;

      const [accountFirst, accountLast] = splitName(accountRaw);

      const className = get("Registered Class");
      if (!className) continue;

      const dob = get("Member DOB") || null;
      const gender = get("Gender") || null;
      const slot = parseSlot(get("Slot"));
      const length_minutes = parseLength(get("Class Length"));

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

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No valid data rows found in the file." },
        { status: 400 },
      );
    }

    /* ── DB: check which classes already exist ── */
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
