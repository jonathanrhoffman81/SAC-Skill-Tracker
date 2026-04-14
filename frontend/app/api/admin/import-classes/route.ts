import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";

// ----------------------
// helpers
// ----------------------
const getString = (val: any): string => (val ?? "").toString().trim();

const splitName = (full: string) => {
  const parts = full.split(",");
  return {
    last: parts[0]?.trim(),
    first: parts[1]?.trim(),
  };
};

const parseClass = (str: string) => {
  const parts = str.split(" - ");
  return {
    level: parts[0]?.trim(),
  };
};

const parseSlot = (slot: string) => parseInt(slot.replace("#", "")) || 1;

const parseLength = (length: string) => parseInt(length) || null;

// ----------------------
// API
// ----------------------
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const file = formData.get("file") as File;
    const orgId = formData.get("organization_id") as string;

    if (!file || !orgId) {
      return NextResponse.json(
        { error: "Missing file or organization_id" },
        { status: 400 },
      );
    }

    const slotConfigs = JSON.parse(
      formData.get("slotConfigs") as string,
    ) as Record<
      string,
      {
        slot: string;
        days: string[];
        time: string;
      }
    >;

    const supabase = getSupabaseAdminClient();

    const text = await file.text();
    const parsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
    });

    const rows = parsed.data as any[];

    // caches
    const classMap = new Map<string, string>();
    const memberMap = new Map<string, string>();

    // instructors
    const { data: instructors } = await supabase
      .from("person_org_role")
      .select(`person:person_id (person_id)`)
      .eq("role_id", 3);

    const instructorIds: string[] =
      instructors?.map((i: any) => i.person.person_id) || [];

    let importedClasses = 0;
    let importedEnrollments = 0;

    for (const row of rows) {
      const memberRaw = getString(row["Member"]);
      const classRaw = getString(row["Registered Class"]);

      const memberName = splitName(memberRaw);
      const { level } = parseClass(classRaw);

      const slot = parseSlot(getString(row["Slot"]));
      const length = parseLength(getString(row["Class Length"]));
      const dob = getString(row["Member DOB"]) || null;
      const gender = getString(row["Gender"]) || null;

      if (!memberName.first || !memberName.last || !level) continue;

      // -----------------------
      // CLASS
      // -----------------------
      type ClassRow = { class_id: string };

      const classKey = `${level}-${slot}`;
      let classId = classMap.get(classKey);

      const slotConfig = slotConfigs[`#${slot}`];

      if (!classId) {
        const { data, error } = await supabase
          .from("class_entity")
          .upsert(
            {
              organization_id: orgId,
              name: level,

              // ✅ structured schedule
              schedule_days: slotConfig?.days || [],
              schedule_time: slotConfig?.time || null,

              // optional human readable
              schedule: slotConfig
                ? `${slotConfig.days.join(", ")} @ ${slotConfig.time}`
                : `Slot ${slot}`,

              length_minutes: length,
            },
            {
              onConflict: "organization_id,name",
            },
          )
          .select("class_id")
          .single<ClassRow>();

        if (error || !data) {
          console.error("Class error:", error);
          continue;
        }

        classId = data.class_id;
        classMap.set(classKey, classId);
        importedClasses++;
      }

      const groupName = `Slot ${slot}`;
      const { data: groupRow, error: groupError } = await supabase
        .from("class_group")
        .upsert(
          {
            class_id: classId,
            name: groupName,
          },
          { onConflict: "class_id,name" },
        )
        .select("group_id")
        .single<{ group_id: string }>();

      if (groupError || !groupRow) {
        console.error("Class group error:", groupError);
        continue;
      }

      if (instructorIds.length > 0) {
        const instructorId =
          instructorIds[Math.floor(Math.random() * instructorIds.length)];

        await supabase.from("group_instructor").upsert({
          instructor_person_id: instructorId,
          group_id: groupRow.group_id,
        });
      }

      // -----------------------
      // MEMBER
      // -----------------------
      type MemberRow = { member_id: string };

      const memberKey = `${memberName.first}-${memberName.last}-${dob}`;
      let memberId = memberMap.get(memberKey);

      if (!memberId) {
        const { data: existing } = await supabase
          .from("member")
          .select("member_id")
          .eq("organization_id", orgId)
          .eq("first_name", memberName.first)
          .eq("last_name", memberName.last)
          .eq("date_of_birth", dob)
          .maybeSingle<MemberRow>();

        if (existing?.member_id) {
          memberId = existing.member_id;
        } else {
          const { data, error } = await supabase
            .from("member")
            .insert({
              organization_id: orgId,
              first_name: memberName.first,
              last_name: memberName.last,
              date_of_birth: dob,
              gender: gender,
              slot: slot,
              level: level,
            })
            .select("member_id")
            .single<MemberRow>();

          if (error || !data) {
            console.error("Member error:", error);
            continue;
          }

          memberId = data.member_id;
        }

        memberMap.set(memberKey, memberId);
      }

      // -----------------------
      // ENROLLMENT
      // -----------------------
      const { error: enrollError } = await supabase.from("enrollment").upsert({
        member_id: memberId,
        class_id: classId,
        slot,
      });

      if (!enrollError) importedEnrollments++;
    }

    return NextResponse.json({
      success: true,
      importedClasses,
      importedEnrollments,
    });
  } catch (err) {
    console.error("Import classes error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
