/**
 * Import Swim Classes — Confirm Route
 * POST /api/admin/import-classes/confirm
 *
 * Guardian linking is skipped entirely if guardian_member already exists
 * for this person+member pair — no redundant role or org re-assignment.
 *
 * Class resolution skips existing classes (they keep their current schedule).
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
  classSchedules: ClassSchedule[]; // only new classes — existing ones are excluded by frontend
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
    /* 1. Resolve class_entity per class                                   */
    /*    - Existing classes: fetch their id (no update — they keep their  */
    /*      current schedule since the admin wasn't prompted for one)      */
    /*    - New classes: insert with the schedule the admin provided       */
    /* ------------------------------------------------------------------ */
    const classIdMap = new Map<string, string>(); // class name → class_id
    let classesCreated = 0;

    // Collect all class names across both new and existing
    const allClassNames = Array.from(new Set(rows.map((r) => r.class_name)));

    // Fetch any that already exist
    const { data: existingClasses } = await supabase
      .from("class_entity")
      .select("class_id, name")
      .eq("organization_id", organization_id)
      .in("name", allClassNames);

    for (const cls of existingClasses ?? []) {
      classIdMap.set(cls.name, cls.class_id);
    }

    // Insert new classes (those not already in the map)
    for (const cls of classSchedules ?? []) {
      if (classIdMap.has(cls.name)) continue; // already exists, skip

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
    /* 2. Per-row: swimmer + guardian + enrollment                         */
    /* ------------------------------------------------------------------ */
    let membersFound = 0;
    let membersCreated = 0;
    let guardiansCreated = 0;
    let guardiansLinked = 0;
    let enrollmentsCreated = 0;
    const enrollmentErrors: string[] = [];

    // Cache email → person_id so a parent with multiple kids only hits DB once
    const emailCache = new Map<string, string>();
    // Cache "personId|||memberId" → already linked boolean
    const guardianLinkCache = new Map<string, boolean>();

    for (const row of rows) {
      const classId = classIdMap.get(row.class_name);
      if (!classId) continue;

      const dobFormatted = normaliseDate(row.dob);

      /* ---- 2a. Find or create swimmer ---- */
      let memberId: string | null = null;

      let memberQuery = supabase
        .from("member")
        .select("member_id")
        .eq("organization_id", organization_id)
        .ilike("first_name", row.member_first)
        .ilike("last_name", row.member_last);

      if (dobFormatted)
        memberQuery = memberQuery.eq("date_of_birth", dobFormatted);

      const { data: existingMember, error: findError } =
        await memberQuery.maybeSingle();
      if (findError) console.error("Member lookup error:", findError);

      if (existingMember) {
        memberId = existingMember.member_id;
        membersFound++;
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

      /* ---- 2b. Enroll swimmer — skip if already enrolled ---- */
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

      /* ---- 2c. Resolve parent/guardian by email ---- */
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

      /* ---- 2d. Skip guardian linking if already linked ---- */
      const guardianCacheKey = `${personId}|||${memberId}`;

      if (guardianLinkCache.has(guardianCacheKey)) {
        // Already confirmed linked in this import run — skip entirely
        continue;
      }

      // Check DB for existing guardian_member record
      const { data: existingLink } = await supabase
        .from("guardian_member")
        .select("guardian_person_id")
        .eq("guardian_person_id", personId)
        .eq("member_id", memberId)
        .maybeSingle();

      if (existingLink) {
        // Already linked — nothing to do
        guardianLinkCache.set(guardianCacheKey, true);
        continue;
      }

      /* ---- 2e. New link — set up org membership, role, and guardian_member ---- */
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

    return NextResponse.json({
      success: true,
      classesCreated,
      membersCreated,
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
