/**
 * Import Roster API Route
 * POST /api/admin/import-roster
 *
 * Accepts CSV, XLS, or XLSX.
 *
 * Batch strategy (avoids per-row DB calls that cause timeouts):
 *  1. Parse file → normalise all rows in memory
 *  2. Batch-fetch all matching members, persons, person_orgs, guardian links
 *  3. Compute inserts/updates in memory
 *  4. Execute bulk writes
 */

import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const ROLE_GUARDIAN = 4;

function normaliseDob(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy)
    return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  return null;
}

async function fileToGrid(file: File): Promise<string[][]> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "csv") {
    const text = await file.text();
    const parsed = Papa.parse<string[]>(text, {
      header: false,
      skipEmptyLines: true,
    });
    return (parsed.data as string[][]).map((row) =>
      row.map((c) => String(c ?? "").trim()),
    );
  }
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  return (raw as unknown as string[][]).map((row) =>
    row.map((c) => String(c ?? "").trim()),
  );
}

interface NormalisedRow {
  accFirstName: string;
  accLastName: string;
  email: string;
  isAccountActive: boolean;
  membFirstName: string;
  membLastName: string;
  dob: string | null;
  gender: string | null;
  isMemberActive: boolean;
  hasMember: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const orgId = formData.get("organization_id") as string | null;

    if (!file || !orgId) {
      return NextResponse.json(
        { error: "File and organization_id are required" },
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
        { error: "File appears to be empty." },
        { status: 400 },
      );
    }

    // Build column index from header row
    const headers = grid[0];
    const col: Record<string, number> = {};
    headers.forEach((h, i) => {
      if (h) col[h.trim()] = i;
    });

    const required = [
      "Acct. First Name",
      "Acct. Last Name",
      "Email",
      "Account Status",
    ];
    const missing = required.filter((c) => !(c in col));
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Missing required columns: ${missing.join(", ")}` },
        { status: 400 },
      );
    }

    const get = (row: string[], label: string) =>
      (row[col[label]] ?? "").trim();
    const isHintRow = (row: string[]) => {
      const email = get(row, "Email").toLowerCase();
      return !email || !email.includes("@");
    };

    // -------------------------------------------------------------------------
    // 1. Normalise all rows in memory — zero DB calls
    // -------------------------------------------------------------------------
    const rows: NormalisedRow[] = [];

    for (const row of grid.slice(1)) {
      if (!row.some((c) => c)) continue;
      if (isHintRow(row)) continue;

      const email = get(row, "Email").toLowerCase();
      const accFirstName = get(row, "Acct. First Name");
      const accLastName = get(row, "Acct. Last Name");
      const accountStatus = get(row, "Account Status").toLowerCase();
      const membFirstName =
        "Memb. First Name" in col ? get(row, "Memb. First Name") : "";
      const membLastName =
        "Memb. Last Name" in col ? get(row, "Memb. Last Name") : "";
      const memberStatus =
        "Member Status" in col ? get(row, "Member Status").toLowerCase() : "";
      const dobRaw = "Birthday" in col ? get(row, "Birthday") : "";
      const dob = normaliseDob(dobRaw);
      const gender = "Gender" in col ? get(row, "Gender") || null : null;

      if (!email || !email.includes("@") || !accFirstName || !accLastName)
        continue;

      const hasMember = !!(membFirstName && membLastName);

      if (hasMember && !memberStatus) {
        console.warn(
          `Skipping — member ${membFirstName} ${membLastName} has no Member Status`,
        );
        continue;
      }
      if (hasMember && !dob) {
        console.warn(
          `Skipping — member ${membFirstName} ${membLastName} has no DOB (got: "${dobRaw}")`,
        );
        continue;
      }

      rows.push({
        accFirstName,
        accLastName,
        email,
        isAccountActive: accountStatus === "active",
        membFirstName,
        membLastName,
        dob,
        gender,
        isMemberActive: memberStatus === "active",
        hasMember,
      });
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No valid data rows found." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdminClient();

    // -------------------------------------------------------------------------
    // 2. Batch-fetch existing members (by first+last name, then match DOB in memory)
    // -------------------------------------------------------------------------
    const memberRows = rows.filter((r) => r.hasMember);
    const uniqueFirsts = [...new Set(memberRows.map((r) => r.membFirstName))];
    const uniqueLasts = [...new Set(memberRows.map((r) => r.membLastName))];

    const { data: existingMembers } = await supabase
      .from("member")
      .select("member_id, first_name, last_name, date_of_birth, is_active")
      .eq("organization_id", orgId)
      .in("first_name", uniqueFirsts)
      .in("last_name", uniqueLasts);

    // key: "firstName|||lastName|||dob" → member_id
    const memberMap = new Map<
      string,
      { member_id: string; is_active: boolean }
    >();
    for (const m of existingMembers ?? []) {
      const key = `${m.first_name}|||${m.last_name}|||${m.date_of_birth ?? ""}`;
      memberMap.set(key, { member_id: m.member_id, is_active: m.is_active });
    }

    // -------------------------------------------------------------------------
    // 3. Batch-fetch existing persons by email
    // -------------------------------------------------------------------------
    const allEmails = [...new Set(rows.map((r) => r.email))];
    const { data: existingPersons } = await supabase
      .from("person")
      .select("person_id, email, first_name, last_name, is_active")
      .in("email", allEmails);

    const personMap = new Map<
      string,
      {
        person_id: string;
        first_name: string;
        last_name: string;
        is_active: boolean;
      }
    >();
    for (const p of existingPersons ?? []) {
      personMap.set(p.email, p);
    }

    // -------------------------------------------------------------------------
    // 4. Batch-fetch existing person_organization rows
    // -------------------------------------------------------------------------
    const existingPersonIds = [...personMap.values()].map((p) => p.person_id);
    const { data: existingPOs } =
      existingPersonIds.length > 0
        ? await supabase
            .from("person_organization")
            .select("person_organization_id, person_id, status")
            .eq("organization_id", orgId)
            .in("person_id", existingPersonIds)
        : { data: [] };

    const poMap = new Map<
      string,
      { person_organization_id: string; status: string }
    >();
    for (const po of existingPOs ?? []) {
      poMap.set(po.person_id, po);
    }

    // -------------------------------------------------------------------------
    // 5. Batch-fetch existing guardian_member links
    // -------------------------------------------------------------------------
    const { data: existingLinks } =
      existingPersonIds.length > 0
        ? await supabase
            .from("guardian_member")
            .select("guardian_person_id, member_id")
            .in("guardian_person_id", existingPersonIds)
        : { data: [] };

    const guardianLinkSet = new Set<string>();
    for (const l of existingLinks ?? []) {
      guardianLinkSet.add(`${l.guardian_person_id}|||${l.member_id}`);
    }

    // -------------------------------------------------------------------------
    // 6. Compute inserts/updates in memory
    // -------------------------------------------------------------------------
    let importedMembers = 0,
      updatedMembers = 0;
    let importedGuardians = 0,
      updatedGuardians = 0;

    const memberInserts: {
      firstName: string;
      lastName: string;
      dob: string;
      gender: string | null;
      isActive: boolean;
    }[] = [];
    const memberUpdates: { member_id: string; is_active: boolean }[] = [];
    const personInserts: {
      email: string;
      first_name: string;
      last_name: string;
      is_active: boolean;
    }[] = [];
    const personUpdates: {
      person_id: string;
      first_name: string;
      last_name: string;
      is_active: boolean;
    }[] = [];

    // Rows that need a guardian_member link — resolved after inserts
    type PendingLink = { email: string; memberKey: string };
    const pendingLinks: PendingLink[] = [];

    for (const row of rows) {
      const {
        accFirstName,
        accLastName,
        email,
        isAccountActive,
        membFirstName,
        membLastName,
        dob,
        gender,
        isMemberActive,
        hasMember,
      } = row;

      // ── Member ──
      if (hasMember) {
        const memberKey = `${membFirstName}|||${membLastName}|||${dob}`;
        const existing = memberMap.get(memberKey);

        if (existing) {
          if (existing.is_active !== isMemberActive) {
            memberUpdates.push({
              member_id: existing.member_id,
              is_active: isMemberActive,
            });
            existing.is_active = isMemberActive; // prevent duplicate update
          }
        } else {
          // Only queue insert once per unique key
          if (!memberMap.has(memberKey)) {
            memberInserts.push({
              firstName: membFirstName,
              lastName: membLastName,
              dob: dob!,
              gender,
              isActive: isMemberActive,
            });
            // Placeholder so we don't queue the same insert twice
            memberMap.set(memberKey, {
              member_id: "__pending__",
              is_active: isMemberActive,
            });
          }
        }
        pendingLinks.push({ email, memberKey });
      }

      // ── Person ──
      const existingPerson = personMap.get(email);
      if (existingPerson) {
        const nameChanged =
          existingPerson.first_name !== accFirstName ||
          existingPerson.last_name !== accLastName;
        const activeChanged = existingPerson.is_active !== isAccountActive;
        if (nameChanged || activeChanged) {
          personUpdates.push({
            person_id: existingPerson.person_id,
            first_name: accFirstName,
            last_name: accLastName,
            is_active: isAccountActive,
          });
          existingPerson.first_name = accFirstName;
          existingPerson.last_name = accLastName;
          existingPerson.is_active = isAccountActive;
        }
      } else if (!personMap.has(email)) {
        personInserts.push({
          email,
          first_name: accFirstName,
          last_name: accLastName,
          is_active: isAccountActive,
        });
        // Placeholder
        personMap.set(email, {
          person_id: "__pending__",
          first_name: accFirstName,
          last_name: accLastName,
          is_active: isAccountActive,
        });
      }
    }

    // -------------------------------------------------------------------------
    // 7. Execute member inserts
    // -------------------------------------------------------------------------
    const newMemberIdMap = new Map<string, string>(); // key → real member_id

    if (memberInserts.length > 0) {
      const { data: newMembers, error } = await supabase
        .from("member")
        .insert(
          memberInserts.map((m) => ({
            organization_id: orgId,
            first_name: m.firstName,
            last_name: m.lastName,
            date_of_birth: m.dob,
            gender: m.gender,
            is_active: m.isActive,
          })),
        )
        .select("member_id, first_name, last_name, date_of_birth");

      if (error) {
        console.error("Member batch insert error:", error);
      } else {
        for (const m of newMembers ?? []) {
          const key = `${m.first_name}|||${m.last_name}|||${m.date_of_birth}`;
          newMemberIdMap.set(key, m.member_id);
          memberMap.set(key, { member_id: m.member_id, is_active: true });
          importedMembers++;
        }
      }
    }

    // -------------------------------------------------------------------------
    // 8. Execute member updates
    // -------------------------------------------------------------------------
    for (const u of memberUpdates) {
      const { error } = await supabase
        .from("member")
        .update({ is_active: u.is_active })
        .eq("member_id", u.member_id);
      if (!error) updatedMembers++;
    }

    // -------------------------------------------------------------------------
    // 9. Execute person inserts
    // -------------------------------------------------------------------------
    if (personInserts.length > 0) {
      const { data: newPersons, error } = await supabase
        .from("person")
        .insert(personInserts)
        .select("person_id, email");

      if (error) {
        console.error("Person batch insert error:", error);
      } else {
        for (const p of newPersons ?? []) {
          const existing = personMap.get(p.email);
          if (existing) existing.person_id = p.person_id;
          importedGuardians++;
        }
      }
    }

    // -------------------------------------------------------------------------
    // 10. Execute person updates
    // -------------------------------------------------------------------------
    for (const u of personUpdates) {
      const { error } = await supabase
        .from("person")
        .update({
          first_name: u.first_name,
          last_name: u.last_name,
          is_active: u.is_active,
        })
        .eq("person_id", u.person_id);
      if (!error) updatedGuardians++;
    }

    // -------------------------------------------------------------------------
    // 11. Upsert person_organization + role for all persons
    // -------------------------------------------------------------------------
    const allPersonsToLink = [...new Set(rows.map((r) => r.email))];
    const poUpserts: {
      person_id: string;
      organization_id: string;
      status: string;
    }[] = [];

    for (const email of allPersonsToLink) {
      const person = personMap.get(email);
      if (!person || person.person_id === "__pending__") continue;

      const orgStatus = rows.find((r) => r.email === email)?.isAccountActive
        ? "active"
        : "inactive";
      const existingPO = poMap.get(person.person_id);

      if (!existingPO || existingPO.status !== orgStatus) {
        poUpserts.push({
          person_id: person.person_id,
          organization_id: orgId,
          status: orgStatus,
        });
      }
    }

    let poIdMap = new Map<string, string>(); // person_id → person_organization_id

    // Seed with existing
    for (const po of existingPOs ?? []) {
      poIdMap.set(po.person_id, po.person_organization_id);
    }

    if (poUpserts.length > 0) {
      const { data: poRows, error: poError } = await supabase
        .from("person_organization")
        .upsert(poUpserts, { onConflict: "person_id,organization_id" })
        .select("person_organization_id, person_id");

      if (poError) {
        console.error("person_organization upsert error:", poError);
      } else {
        for (const po of poRows ?? []) {
          poIdMap.set(po.person_id, po.person_organization_id);
        }
      }
    }

    // Assign GUARDIAN role to all person_org rows
    const roleUpserts = [...poIdMap.values()].map((poId) => ({
      person_organization_id: poId,
      role_id: ROLE_GUARDIAN,
    }));
    if (roleUpserts.length > 0) {
      const { error } = await supabase
        .from("person_org_role")
        .upsert(roleUpserts, { onConflict: "person_organization_id,role_id" });
      if (error) console.error("person_org_role upsert error:", error);
    }

    // -------------------------------------------------------------------------
    // 12. Insert guardian_member links
    // -------------------------------------------------------------------------
    const gmInserts: { guardian_person_id: string; member_id: string }[] = [];

    for (const { email, memberKey } of pendingLinks) {
      const person = personMap.get(email);
      if (!person || person.person_id === "__pending__") continue;

      const member = memberMap.get(memberKey);
      if (!member || member.member_id === "__pending__") continue;

      const linkKey = `${person.person_id}|||${member.member_id}`;
      if (guardianLinkSet.has(linkKey)) continue;

      gmInserts.push({
        guardian_person_id: person.person_id,
        member_id: member.member_id,
      });
      guardianLinkSet.add(linkKey);
    }

    if (gmInserts.length > 0) {
      const { error } = await supabase
        .from("guardian_member")
        .upsert(gmInserts, { onConflict: "guardian_person_id,member_id" });
      if (error) console.error("guardian_member upsert error:", error);
    }

    return NextResponse.json({
      success: true,
      importedMembers,
      updatedMembers,
      importedGuardians,
      updatedGuardians,
      importedInstructors: 0,
      updatedInstructors: 0,
      importedAdmins: 0,
      updatedAdmins: 0,
    });
  } catch (error) {
    console.error("Import roster error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
