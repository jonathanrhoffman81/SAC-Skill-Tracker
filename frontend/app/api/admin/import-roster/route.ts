/**
 * Import Roster API Route
 * Purpose: import swimmers from CSV and upsert into member, person, guardian_member, person_org_role
 *
 * Dedup strategy (safe to import the same file multiple times or re-import updated files):
 *  - member:              manual lookup on (organization_id, first_name, last_name, date_of_birth)
 *                         → insert if new, update is_active if already exists
 *                         → multiple guardians can share the same member (e.g. two parents)
 *  - person:              upsert on email unique constraint
 *  - person_organization: upsert on (person_id, organization_id) unique constraint
 *  - person_org_role:     upsert on (person_organization_id, role_id) unique constraint
 *  - guardian_member:     upsert on (guardian_person_id, member_id) unique constraint
 *
 * Status handling:
 *  - member.is_active           ← CSV "Member Status" == "Active"
 *  - person.is_active           ← CSV "Account Status" == "Active"
 *  - person_organization.status ← "active" | "inactive" from CSV "Account Status"
 */

import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

const SUPABASE_ROLE = {
  ADMIN: 2,
  INSTRUCTOR: 3,
  GUARDIAN: 4,
  MEMBER: 5,
};

const BILLING_ROLE_MAP: Record<string, number> = {
  "Group 1": SUPABASE_ROLE.MEMBER,
  "Group 2": SUPABASE_ROLE.MEMBER,
  "High School - Non Competitive": SUPABASE_ROLE.MEMBER,
  "High School": SUPABASE_ROLE.MEMBER,
  Coaches: SUPABASE_ROLE.INSTRUCTOR,
  "Board Members": SUPABASE_ROLE.ADMIN,
  Annual: SUPABASE_ROLE.MEMBER,
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const orgId = formData.get("organization_id") as string;

    if (!file || !orgId) {
      return NextResponse.json(
        { error: "File and organization_id are required" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdminClient();
    const text = await file.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    const rawRows = parsed.data as any[];

    // ---------------------------------------------------------------------------
    // Normalize rows — skip any padding/empty rows
    // ---------------------------------------------------------------------------
    const rows = rawRows
      .map((row) => ({
        firstName: row["Memb. First Name"]?.trim() ?? "",
        lastName: row["Memb. Last Name"]?.trim() ?? "",
        accFirstName: row["Acct. First Name"]?.trim() ?? "",
        accLastName: row["Acct. Last Name"]?.trim() ?? "",
        gender: row["Gender"]?.trim() || null,
        dob: row["Birthday"]?.trim() || null,
        email: row["Email"]?.toLowerCase().trim() || null,
        billingGroup: row["Billing Group"]?.trim() ?? "",
        memberStatus: (row["Member Status"] ?? "").trim().toLowerCase(), // "active" | "inactive" | ""
        accountStatus: (row["Account Status"] ?? "").trim().toLowerCase(), // "active" | "inactive" | ""
      }))
      .filter((r) => r.firstName && r.lastName && r.billingGroup);

    // ---------------------------------------------------------------------------
    // Counters
    //   imported* = brand new records created
    //   updated*  = existing records where something actually changed
    // ---------------------------------------------------------------------------
    let importedMembers = 0;
    let importedInstructors = 0;
    let importedAdmins = 0;
    let importedGuardians = 0;
    let updatedMembers = 0;
    let updatedInstructors = 0;
    let updatedAdmins = 0;
    let updatedGuardians = 0;

    for (const row of rows) {
      const {
        firstName,
        lastName,
        accFirstName,
        accLastName,
        gender,
        dob,
        email,
        billingGroup,
        memberStatus,
        accountStatus,
      } = row;

      const roleId = BILLING_ROLE_MAP[billingGroup];
      if (!roleId) continue;

      const isMemberActive = memberStatus === "active";
      const isAccountActive = accountStatus === "active";

      // -------------------------------------------------------------------------
      // 1. Member — dedup on (org, first_name, last_name, dob)
      // -------------------------------------------------------------------------
      let memberId: string | null = null;

      if (roleId === SUPABASE_ROLE.MEMBER) {
        let memberQuery = supabase
          .from("member")
          .select("member_id, is_active")
          .eq("organization_id", orgId)
          .eq("first_name", firstName)
          .eq("last_name", lastName);

        if (dob) {
          memberQuery = memberQuery.eq("date_of_birth", dob);
        } else {
          memberQuery = memberQuery.is("date_of_birth", null);
        }

        const { data: existingMembers, error: lookupError } =
          await memberQuery.limit(1);

        if (lookupError) {
          console.error("Member lookup error:", lookupError);
          continue;
        }

        if (existingMembers && existingMembers.length > 0) {
          const existing = existingMembers[0];
          memberId = existing.member_id;

          if (existing.is_active !== isMemberActive) {
            const { error: updateError } = await supabase
              .from("member")
              .update({ is_active: isMemberActive })
              .eq("member_id", memberId);

            if (!updateError) updatedMembers++;
            else console.error("Member update error:", updateError);
          }
        } else {
          const { data: newMember, error: memberError } = await supabase
            .from("member")
            .insert({
              organization_id: orgId,
              first_name: firstName,
              last_name: lastName,
              date_of_birth: dob || null,
              gender,
              is_active: isMemberActive,
            })
            .select("member_id")
            .single();

          if (memberError) {
            console.error("Member insert error:", memberError);
            continue;
          }

          memberId = newMember.member_id;
          importedMembers++;
        }
      }

      // -------------------------------------------------------------------------
      // 2. Person — lookup by email, then insert or update if anything changed
      // -------------------------------------------------------------------------
      let personId: string | null = null;
      let isNewPerson = false;
      let isUpdatedPerson = false;

      if (email) {
        const { data: existingPerson } = await supabase
          .from("person")
          .select("person_id, first_name, last_name, is_active")
          .eq("email", email)
          .maybeSingle();

        if (existingPerson) {
          personId = existingPerson.person_id;

          const nameChanged =
            existingPerson.first_name !== accFirstName ||
            existingPerson.last_name !== accLastName;
          const activeChanged = existingPerson.is_active !== isAccountActive;

          if (nameChanged || activeChanged) {
            const { error: personUpdateError } = await supabase
              .from("person")
              .update({
                first_name: accFirstName,
                last_name: accLastName,
                is_active: isAccountActive,
              })
              .eq("person_id", personId);

            if (!personUpdateError) isUpdatedPerson = true;
            else console.error("Person update error:", personUpdateError);
          }
        } else {
          const { data: newPerson, error: personInsertError } = await supabase
            .from("person")
            .insert({
              email,
              first_name: accFirstName,
              last_name: accLastName,
              date_of_birth: dob || null,
              is_active: isAccountActive,
            })
            .select("person_id")
            .single();

          if (personInsertError) {
            console.error("Person insert error:", personInsertError);
          } else if (newPerson) {
            personId = newPerson.person_id;
            isNewPerson = true;
          }
        }
      }

      // -------------------------------------------------------------------------
      // 3. Person ↔ Organization — lookup then insert/update
      // -------------------------------------------------------------------------
      let personOrgId: string | null = null;
      let isNewPersonOrg = false;
      let isUpdatedPersonOrg = false;

      if (personId) {
        const orgStatus = isAccountActive ? "active" : "inactive";

        const { data: existingPO } = await supabase
          .from("person_organization")
          .select("person_organization_id, status")
          .eq("person_id", personId)
          .eq("organization_id", orgId)
          .maybeSingle();

        if (existingPO) {
          personOrgId = existingPO.person_organization_id;

          if (existingPO.status !== orgStatus) {
            const { error: poUpdateError } = await supabase
              .from("person_organization")
              .update({ status: orgStatus })
              .eq("person_organization_id", personOrgId);

            if (!poUpdateError) isUpdatedPersonOrg = true;
            else
              console.error("Person organization update error:", poUpdateError);
          }
        } else {
          const { data: poData, error: poError } = await supabase
            .from("person_organization")
            .insert({
              person_id: personId,
              organization_id: orgId,
              status: orgStatus,
            })
            .select("person_organization_id")
            .single();

          if (poError) {
            console.error("Person organization insert error:", poError);
          } else {
            personOrgId = poData.person_organization_id;
            isNewPersonOrg = true;
          }
        }

        // -----------------------------------------------------------------------
        // Tally role-specific counters.
        // A person counts as "updated" if their person record or org status
        // changed, even if their org link already existed.
        // -----------------------------------------------------------------------
        const isNew = isNewPerson || isNewPersonOrg;
        const isUpdated = !isNew && (isUpdatedPerson || isUpdatedPersonOrg);

        if (roleId === SUPABASE_ROLE.INSTRUCTOR) {
          if (isNew) importedInstructors++;
          else if (isUpdated) updatedInstructors++;
        } else if (roleId === SUPABASE_ROLE.ADMIN) {
          if (isNew) importedAdmins++;
          else if (isUpdated) updatedAdmins++;
        } else if (roleId === SUPABASE_ROLE.MEMBER) {
          // The account holder on a member row is the guardian
          if (isNew) importedGuardians++;
          else if (isUpdated) updatedGuardians++;
        }
      }

      // -------------------------------------------------------------------------
      // 4. Person org role — upsert on (person_organization_id, role_id)
      //    Guardians (parents of members) get GUARDIAN role.
      //    Instructors/Admins get their mapped role.
      // -------------------------------------------------------------------------
      if (personOrgId && roleId) {
        const assignedRole =
          roleId === SUPABASE_ROLE.MEMBER
            ? SUPABASE_ROLE.GUARDIAN // parent of a member gets GUARDIAN
            : roleId;

        const { error: roleError } = await supabase
          .from("person_org_role")
          .upsert(
            {
              person_organization_id: personOrgId,
              role_id: assignedRole,
            },
            { onConflict: "person_organization_id,role_id" },
          );

        if (roleError) {
          console.error("Person org role upsert error:", roleError);
        }
      }

      // -------------------------------------------------------------------------
      // 5. Guardian ↔ Member link — upsert on (guardian_person_id, member_id)
      // -------------------------------------------------------------------------
      if (memberId && personId && roleId === SUPABASE_ROLE.MEMBER) {
        const { error: gmError } = await supabase
          .from("guardian_member")
          .upsert(
            {
              guardian_person_id: personId,
              member_id: memberId,
            },
            { onConflict: "guardian_person_id,member_id" },
          );

        if (gmError) {
          console.error("Guardian member upsert error:", gmError);
        }
      }
    }

    return NextResponse.json({
      success: true,
      importedMembers,
      updatedMembers,
      importedInstructors,
      updatedInstructors,
      importedAdmins,
      updatedAdmins,
      importedGuardians,
      updatedGuardians,
    });
  } catch (error) {
    console.error("Import roster error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
