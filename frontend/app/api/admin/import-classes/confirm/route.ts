/**
 * Import Swim Classes — Confirm Route
 * POST /api/admin/import-classes/confirm
 *
 * Dedup strategy (safe to re-import the same file):
 *  - member:         lookup by (org, first_name, last_name) case-insensitive,
 *                    then verify DOB if both sides have one. DOB alone never
 *                    blocks a match — a name match is sufficient to avoid dupes.
 *  - enrollment:     skip if (member_id, class_id) already exists
 *  - person:         lookup by email; insert only if not found
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
  schedule_days: string[];
  schedule_time: string;
}

interface ConfirmBody {
  organization_id: string;
  classSchedules: ClassSchedule[];
  rows: ParsedSwimRow[];
}

function normaliseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
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
          schedule_days: cls.schedule_days,
          schedule_time: cls.schedule_time || null,
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

    /* ------------------------------------------------------------------ */
    /* 2. Per-row: swimmer + enrollment + guardian                         */
    /* ------------------------------------------------------------------ */
    let membersFound = 0;
    let membersCreated = 0;
    let guardiansCreated = 0;
    let guardiansLinked = 0;
    let enrollmentsCreated = 0;
    const enrollmentErrors: string[] = [];

    // email → person_id cache so a parent with multiple kids only hits DB once
    const emailCache = new Map<string, string>();
    // "personId|||memberId" → true, already linked
    const guardianLinkCache = new Map<string, boolean>();

    for (const row of rows) {
      const classId = classIdMap.get(row.class_name);
      if (!classId) continue;

      const dobFormatted = normaliseDate(row.dob);

      /* ---- 2a. Find or create swimmer --------------------------------- */
      let memberId: string | null = null;

      // Look up by org + name only (case-insensitive). We intentionally do NOT
      // filter by DOB here because the DOB stored from a previous import may
      // differ in format or be null, which would cause a false "not found" and
      // create a duplicate member. A name match within the org is sufficient.
      const { data: existingMembers, error: findError } = await supabase
        .from("member")
        .select("member_id, date_of_birth")
        .eq("organization_id", organization_id)
        .ilike("first_name", row.member_first)
        .ilike("last_name", row.member_last);

      if (findError) console.error("Member lookup error:", findError);

      if (existingMembers && existingMembers.length > 0) {
        // If multiple name matches, prefer the one whose DOB matches, otherwise
        // just take the first — still better than creating a duplicate.
        const dobMatch = existingMembers.find(
          (m) => m.date_of_birth === dobFormatted,
        );
        const best = dobMatch ?? existingMembers[0];
        memberId = best.member_id;
        membersFound++;

        // Backfill DOB if the existing record doesn't have one but the CSV does
        if (!best.date_of_birth && dobFormatted) {
          await supabase
            .from("member")
            .update({ date_of_birth: dobFormatted })
            .eq("member_id", memberId);
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

        if (memberError) {
          console.error(
            `Member insert error for ${row.member_first} ${row.member_last}:`,
            memberError,
          );
          continue;
        }
        memberId = newMember.member_id;
        membersCreated++;
      }

      /* ---- 2b. Enroll swimmer — skip if already enrolled -------------- */
      const { data: existingEnrollment } = await supabase
        .from("enrollment")
        .select("member_id")
        .eq("member_id", memberId)
        .eq("class_id", classId)
        .maybeSingle();

      if (!existingEnrollment) {
        const { error: enrollError } = await supabase
          .from("enrollment")
          .insert({ member_id: memberId, class_id: classId, slot: row.slot });

        if (enrollError) {
          console.error("Enrollment error:", enrollError);
          enrollmentErrors.push(
            `${row.member_first} ${row.member_last} → ${row.class_name}`,
          );
        } else {
          enrollmentsCreated++;
        }
      }

      /* ---- 2c. Resolve parent/guardian by email ----------------------- */
      let personId: string | null = null;
      let isNewPerson = false;

      if (emailCache.has(row.account_email)) {
        personId = emailCache.get(row.account_email)!;
      } else {
        const { data: existingPerson } = await supabase
          .from("person")
          .select("person_id")
          .eq("email", row.account_email)
          .maybeSingle();

        if (existingPerson) {
          personId = existingPerson.person_id;
        } else {
          const { data: newPerson, error: personError } = await supabase
            .from("person")
            .insert({
              email: row.account_email,
              first_name: row.account_first,
              last_name: row.account_last,
            })
            .select("person_id")
            .single();

          if (personError) {
            console.error(
              `Person insert error for ${row.account_email}:`,
              personError,
            );
          } else {
            personId = newPerson.person_id;
            isNewPerson = true;
          }
        }

        if (personId) emailCache.set(row.account_email, personId);
      }

      if (!personId) continue;

      /* ---- 2d. Skip guardian linking if already linked ---------------- */
      const guardianCacheKey = `${personId}|||${memberId}`;

      if (!guardianLinkCache.has(guardianCacheKey)) {
        const { data: existingLink } = await supabase
          .from("guardian_member")
          .select("guardian_person_id")
          .eq("guardian_person_id", personId)
          .eq("member_id", memberId)
          .maybeSingle();

        if (existingLink) {
          guardianLinkCache.set(guardianCacheKey, true);
        } else {
          /* ---- 2e. New link — org membership, role, guardian_member --- */
          const { data: poData, error: poError } = await supabase
            .from("person_organization")
            .upsert(
              { person_id: personId, organization_id, status: "active" },
              { onConflict: "person_id,organization_id" },
            )
            .select("person_organization_id")
            .single();

          if (poError || !poData) {
            console.error("person_organization upsert error:", poError);
            continue;
          }

          await supabase.from("person_org_role").upsert(
            {
              person_organization_id: poData.person_organization_id,
              role_id: ROLE_GUARDIAN,
            },
            { onConflict: "person_organization_id,role_id" },
          );

          const { error: gmError } = await supabase
            .from("guardian_member")
            .insert({ guardian_person_id: personId, member_id: memberId });

          if (!gmError) {
            guardianLinkCache.set(guardianCacheKey, true);
            if (isNewPerson) guardiansCreated++;
            else guardiansLinked++;
          }
        }
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
