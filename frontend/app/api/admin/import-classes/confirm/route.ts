/**
 * Import Swim Classes — Confirm Route
 * POST /api/admin/import-classes/confirm
 *
 * Dedup strategy (safe to re-import the same file):
 *  - member:          lookup by (org, first_name, last_name) case-insensitive
 *  - enrollment:      skip if (member_id, class_id) already exists
 *  - person:          lookup by email; insert only if not found
 *  - guardian_member: skip if (guardian_person_id, member_id) already exists
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { ParsedSwimRow } from "../route";

const ROLE_GUARDIAN = 4;

export interface ClassSchedule {
  name: string;
  length_minutes: number;
  start_date: string;
  end_date: string;
}

interface ConfirmBody {
  organization_id: string;
  classSchedules: ClassSchedule[];
  rows: ParsedSwimRow[];
}

function normaliseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // MM/DD/YYYY or M/D/YYYY
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy)
    return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ConfirmBody;
    const { organization_id, classSchedules, rows } = body;

    if (!organization_id || !rows?.length) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdminClient();

    /* ------------------------------------------------------------------ */
    /* 1. Resolve class_entity                                             */
    /* ------------------------------------------------------------------ */
    const classIdMap = new Map<string, string>();
    let classesCreated = 0;

    const allClassNames = Array.from(new Set(rows.map((r) => r.class_name)));

    const { data: existingClasses } = await supabase
      .from("class_entity")
      .select("class_id, name")
      .eq("organization_id", organization_id)
      .in("name", allClassNames);

    for (const cls of existingClasses ?? []) {
      classIdMap.set(cls.name, cls.class_id);
    }

    for (const cls of classSchedules ?? []) {
      if (classIdMap.has(cls.name)) continue;

      const { data: newClass, error: insertError } = await supabase
        .from("class_entity")
        .insert({
          organization_id,
          name: cls.name,
          length_minutes: cls.length_minutes,
          start_date: cls.start_date || null,
          end_date: cls.end_date || null,
        })
        .select("class_id")
        .single();

      if (insertError) {
        console.error(
          `class_entity insert error for "${cls.name}":`,
          insertError,
        );
        continue;
      }

      classIdMap.set(cls.name, newClass.class_id);
      classesCreated++;
    }

    // Guard: bail early if any class name still isn't resolved
    const unresolvedClasses = allClassNames.filter((n) => !classIdMap.has(n));
    if (unresolvedClasses.length > 0) {
      return NextResponse.json(
        {
          error:
            `The following classes were not found in the database and had no ` +
            `schedule provided. Please re-upload the file and configure them: ` +
            unresolvedClasses.join(", "),
        },
        { status: 400 },
      );
    }

    /* ------------------------------------------------------------------ */
    /* 2. Batch-fetch all existing members for this org by name           */
    /* ------------------------------------------------------------------ */
    const uniqueFirstNames = [...new Set(rows.map((r) => r.member_first))];
    const uniqueLastNames = [...new Set(rows.map((r) => r.member_last))];

    const { data: allOrgMembers } = await supabase
      .from("member")
      .select("member_id, first_name, last_name, date_of_birth")
      .eq("organization_id", organization_id)
      .in("first_name", uniqueFirstNames)
      .in("last_name", uniqueLastNames);

    const memberLookup = new Map<
      string,
      { member_id: string; date_of_birth: string | null }[]
    >();
    for (const m of allOrgMembers ?? []) {
      const key = `${m.first_name.toLowerCase()}|||${m.last_name.toLowerCase()}`;
      const bucket = memberLookup.get(key) ?? [];
      bucket.push({ member_id: m.member_id, date_of_birth: m.date_of_birth });
      memberLookup.set(key, bucket);
    }

    /* ------------------------------------------------------------------ */
    /* 3. Batch-fetch all existing enrollments for these classes           */
    /* ------------------------------------------------------------------ */
    const allClassIds = Array.from(classIdMap.values());
    const { data: existingEnrollments } = await supabase
      .from("enrollment")
      .select("member_id, class_id")
      .in("class_id", allClassIds);

    const enrollmentSet = new Set<string>();
    for (const e of existingEnrollments ?? []) {
      enrollmentSet.add(`${e.member_id}|||${e.class_id}`);
    }

    /* ------------------------------------------------------------------ */
    /* 4. Batch-fetch all existing persons by email                        */
    /* ------------------------------------------------------------------ */
    const allEmails = [...new Set(rows.map((r) => r.account_email))];
    const { data: existingPersons } = await supabase
      .from("person")
      .select("person_id, email")
      .in("email", allEmails);

    const emailToPersonId = new Map<string, string>();
    for (const p of existingPersons ?? []) {
      emailToPersonId.set(p.email, p.person_id);
    }

    /* ------------------------------------------------------------------ */
    /* 5. Batch-fetch all existing guardian_member links                   */
    /* ------------------------------------------------------------------ */
    const allPersonIds = Array.from(emailToPersonId.values());
    const guardianLinkSet = new Set<string>();

    if (allPersonIds.length > 0) {
      const { data: existingLinks } = await supabase
        .from("guardian_member")
        .select("guardian_person_id, member_id")
        .in("guardian_person_id", allPersonIds);

      for (const l of existingLinks ?? []) {
        guardianLinkSet.add(`${l.guardian_person_id}|||${l.member_id}`);
      }
    }

    /* ------------------------------------------------------------------ */
    /* 6. Per-row loop — zero DB reads inside                              */
    /* ------------------------------------------------------------------ */
    let membersFound = 0;
    let membersCreated = 0;
    const enrollmentInserts: {
      member_id: string;
      class_id: string;
      slot: number;
    }[] = [];
    const personInserts: {
      email: string;
      first_name: string;
      last_name: string;
    }[] = [];
    const pendingPersonEmails = new Set<string>();
    const enrollmentErrors: string[] = [];

    type GuardianWork = { email: string; memberId: string };
    const guardianWorkList: GuardianWork[] = [];

    for (const row of rows) {
      const classId = classIdMap.get(row.class_name);
      if (!classId) continue;

      const dobFormatted = normaliseDate(row.dob);

      /* ---- 6a. Find or create swimmer --------------------------------- */
      let memberId: string | undefined;
      const nameKey = `${row.member_first.toLowerCase()}|||${row.member_last.toLowerCase()}`;
      const matches = memberLookup.get(nameKey);

      if (matches && matches.length > 0) {
        const dobMatch = matches.find((m) => m.date_of_birth === dobFormatted);
        const best = dobMatch ?? matches[0];
        memberId = best.member_id;
        membersFound++;

        if (!best.date_of_birth && dobFormatted) {
          // Fire-and-forget DOB backfill
          supabase
            .from("member")
            .update({ date_of_birth: dobFormatted })
            .eq("member_id", memberId)
            .then(() => {});
        }
      } else {
        const { data: newMember, error: memberError } = await supabase
          .from("member")
          .insert({
            organization_id,
            first_name: row.member_first,
            last_name: row.member_last,
            date_of_birth: dobFormatted,
            gender: row.gender,
          })
          .select("member_id")
          .single();

        if (memberError || !newMember) {
          console.error(
            `Member insert error for ${row.member_first} ${row.member_last}:`,
            memberError,
          );
          continue;
        }

        memberId = newMember.member_id;
        membersCreated++;

        const bucket = memberLookup.get(nameKey) ?? [];
        bucket.push({
          member_id: newMember.member_id,
          date_of_birth: dobFormatted,
        });
        memberLookup.set(nameKey, bucket);
      }

      if (!memberId) continue;

      /* ---- 6b. Queue enrollment --------------------------------------- */
      const enrollKey = `${memberId}|||${classId}`;
      if (!enrollmentSet.has(enrollKey)) {
        enrollmentInserts.push({
          member_id: memberId,
          class_id: classId,
          slot: row.slot,
        });
        enrollmentSet.add(enrollKey);
      }

      /* ---- 6c. Queue person insert if needed -------------------------- */
      if (
        !emailToPersonId.has(row.account_email) &&
        !pendingPersonEmails.has(row.account_email)
      ) {
        personInserts.push({
          email: row.account_email,
          first_name: row.account_first,
          last_name: row.account_last,
        });
        pendingPersonEmails.add(row.account_email);
      }

      /* ---- 6d. Queue guardian link ------------------------------------ */
      guardianWorkList.push({ email: row.account_email, memberId });
    }

    /* ------------------------------------------------------------------ */
    /* 7. Batch-insert new persons                                         */
    /* ------------------------------------------------------------------ */
    if (personInserts.length > 0) {
      const { data: newPersons, error: personBatchError } = await supabase
        .from("person")
        .insert(personInserts)
        .select("person_id, email");

      if (personBatchError) {
        console.error("Batch person insert error:", personBatchError);
      } else {
        for (const p of newPersons ?? []) {
          emailToPersonId.set(p.email, p.person_id);
        }
      }
    }

    /* ------------------------------------------------------------------ */
    /* 8. Batch-insert enrollments                                         */
    /* ------------------------------------------------------------------ */
    let enrollmentsCreated = 0;
    if (enrollmentInserts.length > 0) {
      const { error: enrollBatchError } = await supabase
        .from("enrollment")
        .insert(enrollmentInserts);

      if (enrollBatchError) {
        console.error("Batch enrollment insert error:", enrollBatchError);
        for (const e of enrollmentInserts) {
          enrollmentErrors.push(
            `member_id ${e.member_id} → class_id ${e.class_id}`,
          );
        }
      } else {
        enrollmentsCreated = enrollmentInserts.length;
      }
    }

    /* ------------------------------------------------------------------ */
    /* 9. Resolve guardian links                                           */
    /* ------------------------------------------------------------------ */

    // Re-fetch links now that new persons exist
    const allPersonIdsNow = [...emailToPersonId.values()];
    if (allPersonIdsNow.length > 0) {
      const { data: freshLinks } = await supabase
        .from("guardian_member")
        .select("guardian_person_id, member_id")
        .in("guardian_person_id", allPersonIdsNow);

      for (const l of freshLinks ?? []) {
        guardianLinkSet.add(`${l.guardian_person_id}|||${l.member_id}`);
      }
    }

    const poUpserts: {
      person_id: string;
      organization_id: string;
      status: string;
    }[] = [];
    const gmInserts: { guardian_person_id: string; member_id: string }[] = [];
    const newGuardianPersonIds = new Set<string>();
    const linkedGuardianPersonIds = new Set<string>();

    for (const { email, memberId } of guardianWorkList) {
      const personId = emailToPersonId.get(email);
      if (!personId) continue;

      const linkKey = `${personId}|||${memberId}`;
      if (guardianLinkSet.has(linkKey)) continue;

      poUpserts.push({
        person_id: personId,
        organization_id,
        status: "active",
      });
      gmInserts.push({ guardian_person_id: personId, member_id: memberId });
      guardianLinkSet.add(linkKey);

      const wasExisting = existingPersons?.some((p) => p.email === email);
      if (wasExisting) linkedGuardianPersonIds.add(personId);
      else newGuardianPersonIds.add(personId);
    }

    let guardiansCreated = 0;
    let guardiansLinked = 0;

    if (poUpserts.length > 0) {
      const dedupedPO = Array.from(
        new Map(poUpserts.map((p) => [p.person_id, p])).values(),
      );

      const { data: poRows, error: poError } = await supabase
        .from("person_organization")
        .upsert(dedupedPO, { onConflict: "person_id,organization_id" })
        .select("person_organization_id, person_id");

      if (poError) {
        console.error("person_organization batch upsert error:", poError);
      } else {
        const roleUpserts = (poRows ?? []).map((po) => ({
          person_organization_id: po.person_organization_id,
          role_id: ROLE_GUARDIAN,
        }));
        if (roleUpserts.length > 0) {
          await supabase.from("person_org_role").upsert(roleUpserts, {
            onConflict: "person_organization_id,role_id",
          });
        }
      }
    }

    if (gmInserts.length > 0) {
      const { error: gmError } = await supabase
        .from("guardian_member")
        .insert(gmInserts);

      if (!gmError) {
        guardiansCreated = newGuardianPersonIds.size;
        guardiansLinked = linkedGuardianPersonIds.size;
      } else {
        console.error("guardian_member batch insert error:", gmError);
      }
    }

    return NextResponse.json({
      success: true,
      classesCreated,
      membersCreated,
      membersFound,
      guardiansCreated,
      guardiansLinked,
      enrollmentsCreated,
      enrollmentErrors: enrollmentErrors.slice(0, 10),
    });
  } catch (error) {
    console.error("Confirm swim classes error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
