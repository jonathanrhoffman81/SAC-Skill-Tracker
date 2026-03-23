/**
 * Import Roster API Route
 * Purpose: import swimmers from CSV and insert into member, person, guardian_member, person_org_role
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

// Map Billing Group to roles
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
    const rows = parsed.data as any[];

    // Counters
    let importedMembers = 0;
    let importedInstructors = 0;
    let importedAdmins = 0;

    for (const row of rows) {
      const firstName = row["Memb. First Name"]?.trim();
      const lastName = row["Memb. Last Name"]?.trim();
      const accFirstName = row["Acct. First Name"]?.trim();
      const accLastName = row["Acct. Last Name"]?.trim();
      const gender = row["Gender"] || null;
      const dob = row["Birthday"] || null;
      const email = row["Email"]?.toLowerCase().trim() || null;
      const billingGroup = row["Billing Group"]?.trim();

      if (!firstName || !lastName || !billingGroup) continue;

      const roleId = BILLING_ROLE_MAP[billingGroup];
      if (!roleId) continue; // skip unknown billing groups

      /*
      ----------------------------
      Skip creating member if it's an instructor or admin
      ----------------------------
      */
      let memberId: string | null = null;
      if (roleId === SUPABASE_ROLE.MEMBER) {
        const { data: newMember, error: memberError } = await supabase
          .from("member")
          .insert({
            organization_id: orgId,
            first_name: firstName,
            last_name: lastName,
            date_of_birth: dob,
            gender: gender,
          })
          .select("member_id")
          .single();

        if (memberError) {
          console.error("Member insert error:", memberError);
          continue;
        }

        memberId = newMember.member_id;
        importedMembers++;
      } else if (roleId === SUPABASE_ROLE.INSTRUCTOR) {
        importedInstructors++;
      } else if (roleId === SUPABASE_ROLE.ADMIN) {
        importedAdmins++;
      }

      /*
      ----------------------------
      Upsert person by email if exists
      ----------------------------
      */
      let personId: string | null = null;
      if (email) {
        const { data: personData, error: personError } = await supabase
          .from("person")
          .upsert(
            {
              email,
              first_name: accFirstName,
              last_name: accLastName,
              date_of_birth: dob,
            },
            { onConflict: "email" },
          )
          .select("person_id")
          .single();

        if (personError) {
          console.error("Person upsert error:", personError);
        } else if (personData) {
          personId = personData.person_id;
        }
      }

      /*
      ----------------------------
      Link person → organization
      ----------------------------
      */
      let personOrgId: string | null = null;
      if (personId) {
        const { data: poData, error: poError } = await supabase
          .from("person_organization")
          .upsert(
            {
              person_id: personId,
              organization_id: orgId,
              status: "active",
            },
            { onConflict: "person_id,organization_id" },
          )
          .select("person_organization_id")
          .single();

        if (poError) {
          console.error("Person organization error:", poError);
        } else {
          personOrgId = poData.person_organization_id;
        }
      }

      /*
      ----------------------------
      Assign role in person_org_role
      ----------------------------
      */

      if (personOrgId && roleId) {
        let assignedRole = roleId;

        // If this is a member row and we want the parent to be guardian
        if (roleId === SUPABASE_ROLE.MEMBER && personId) {
          assignedRole = SUPABASE_ROLE.GUARDIAN; // parent gets GUARDIAN
        }

        await supabase.from("person_org_role").upsert({
          person_organization_id: personOrgId,
          role_id: assignedRole,
        });
      }

      /*
      ----------------------------
      Link guardian_member if role is member
      ----------------------------
      */

      if (memberId && personId && roleId === SUPABASE_ROLE.MEMBER) {
        await supabase.from("guardian_member").upsert({
          guardian_person_id: personId,
          member_id: memberId,
        });
      }
    }

    return NextResponse.json({
      success: true,
      importedMembers,
      importedInstructors,
      importedAdmins,
    });
  } catch (error) {
    console.error("Import roster error:", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
