import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { resolveAdminRequestContext } from "@/lib/adminQueries";

const ROLE_IDS = {
    admin: 2,
    instructor: 3,
    parent: 4,
} as const;

type RoleKey = "admin" | "instructor" | "parent" | "swimmer";
const QUERY_CHUNK_SIZE = 200;

export async function GET(request: NextRequest) {
    try {
        const supabase = getSupabaseAdminClient();
        const adminContext = await resolveAdminRequestContext(
            request,
            supabase,
            request.nextUrl.searchParams.get("email"),
        );
        const organizationId = adminContext.organizationId;

        const { data: personOrgRows, error: personOrgError } = await supabase
            .from("person_organization")
            .select("person_id, person_organization_id")
            .eq("organization_id", organizationId)
            .eq("status", "active");

        if (personOrgError) {
            return NextResponse.json(
                { error: `Failed to load organization people: ${personOrgError.message}` },
                { status: 500 },
            );
        }

        const personIdsFromOrg = Array.from(new Set((personOrgRows || []).map((row: any) => row.person_id)));
        const personOrgIdByPersonId = new Map<string, string>();
        (personOrgRows || []).forEach((row: any) => {
            if (!personOrgIdByPersonId.has(row.person_id)) {
                personOrgIdByPersonId.set(row.person_id, row.person_organization_id);
            }
        });

        const { data: membersInOrg, error: membersInOrgError } = await supabase
            .from("member")
            .select("member_id, first_name, last_name, is_active")
            .eq("organization_id", organizationId);

        if (membersInOrgError) {
            return NextResponse.json(
                { error: `Failed to load swimmers: ${membersInOrgError.message}` },
                { status: 500 },
            );
        }

        const memberIdsInOrg = Array.from(new Set((membersInOrg || []).map((row: any) => row.member_id)));

        const personMemberRows: any[] = [];
        if (memberIdsInOrg.length > 0) {
            for (let i = 0; i < memberIdsInOrg.length; i += QUERY_CHUNK_SIZE) {
                const chunk = memberIdsInOrg.slice(i, i + QUERY_CHUNK_SIZE);
                const { data, error } = await supabase
                    .from("person_member")
                    .select("person_id, member_id")
                    .in("member_id", chunk);

                if (error) {
                    return NextResponse.json(
                        { error: `Failed to load swimmer links: ${error.message}` },
                        { status: 500 },
                    );
                }

                personMemberRows.push(...(data || []));
            }
        }

        const swimmerPersonIds = new Set<string>();
        const memberIdsByPersonId = new Map<string, Set<string>>();
        const personIdsFromMembers = new Set<string>();
        personMemberRows.forEach((row: any) => {
            if (!row.person_id || !row.member_id) return;
            swimmerPersonIds.add(row.person_id);
            personIdsFromMembers.add(row.person_id);
            const existing = memberIdsByPersonId.get(row.person_id) || new Set<string>();
            existing.add(row.member_id);
            memberIdsByPersonId.set(row.person_id, existing);
        });

        const personIds = Array.from(new Set([...personIdsFromOrg, ...Array.from(personIdsFromMembers)]));

        const peopleRows: any[] = [];
        if (personIds.length > 0) {
            for (let i = 0; i < personIds.length; i += QUERY_CHUNK_SIZE) {
                const chunk = personIds.slice(i, i + QUERY_CHUNK_SIZE);
                const { data, error } = await supabase
                    .from("person")
                    .select("person_id, first_name, last_name, email, is_active")
                    .in("person_id", chunk);

                if (error) {
                    return NextResponse.json(
                        { error: `Failed to load people: ${error.message}` },
                        { status: 500 },
                    );
                }

                peopleRows.push(...(data || []));
            }
        }

        const memberById = new Map<string, any>();
        (membersInOrg || []).forEach((member: any) => memberById.set(member.member_id, member));

        const guardianMemberRows: any[] = [];
        if (personIdsFromOrg.length > 0) {
            for (let i = 0; i < personIdsFromOrg.length; i += QUERY_CHUNK_SIZE) {
                const chunk = personIdsFromOrg.slice(i, i + QUERY_CHUNK_SIZE);
                const { data, error } = await supabase
                    .from("guardian_member")
                    .select("guardian_person_id, member_id")
                    .in("guardian_person_id", chunk);

                if (error) {
                    return NextResponse.json(
                        { error: `Failed to load guardian links: ${error.message}` },
                        { status: 500 },
                    );
                }

                guardianMemberRows.push(...(data || []));
            }
        }

        const guardianMemberIdsByPersonId = new Map<string, Set<string>>();
        guardianMemberRows.forEach((row: any) => {
            if (!row.guardian_person_id || !row.member_id) return;
            const existing = guardianMemberIdsByPersonId.get(row.guardian_person_id) || new Set<string>();
            existing.add(row.member_id);
            guardianMemberIdsByPersonId.set(row.guardian_person_id, existing);
        });

        const personOrgIds = Array.from(new Set((personOrgRows || []).map((row: any) => row.person_organization_id)));
        const roleRows: any[] = [];
        if (personOrgIds.length > 0) {
            for (let i = 0; i < personOrgIds.length; i += QUERY_CHUNK_SIZE) {
                const chunk = personOrgIds.slice(i, i + QUERY_CHUNK_SIZE);
                const { data, error } = await supabase
                    .from("person_org_role")
                    .select("person_organization_id, role_id")
                    .in("person_organization_id", chunk)
                    .in("role_id", [ROLE_IDS.admin, ROLE_IDS.instructor, ROLE_IDS.parent]);

                if (error) {
                    return NextResponse.json(
                        { error: `Failed to load roles: ${error.message}` },
                        { status: 500 },
                    );
                }

                roleRows.push(...(data || []));
            }
        }

        const rolesByPersonOrgId = new Map<string, Set<number>>();
        roleRows.forEach((row: any) => {
            const existing = rolesByPersonOrgId.get(row.person_organization_id) || new Set<number>();
            existing.add(row.role_id);
            rolesByPersonOrgId.set(row.person_organization_id, existing);
        });

        const accountsFromPeople = peopleRows
            .map((person: any) => {
                const personOrgId = personOrgIdByPersonId.get(person.person_id);
                const roleSet = personOrgId ? rolesByPersonOrgId.get(personOrgId) : undefined;
                const linkedMemberIds = Array.from(memberIdsByPersonId.get(person.person_id) || []);
                const linkedMember = linkedMemberIds.length > 0 ? memberById.get(linkedMemberIds[0]) : null;
                const isAdmin = Boolean(roleSet?.has(ROLE_IDS.admin));

                return {
                    person_id: person.person_id,
                    member_id: linkedMember?.member_id || null,
                    first_name: person.first_name || linkedMember?.first_name || "",
                    last_name: person.last_name || linkedMember?.last_name || "",
                    email: person.email || "",
                    is_active:
                        typeof person.is_active === "boolean"
                            ? person.is_active
                            : typeof linkedMember?.is_active === "boolean"
                                ? linkedMember.is_active
                                : true,
                    is_member_only: false,
                    linkedSwimmers: Array.from(guardianMemberIdsByPersonId.get(person.person_id) || [])
                        .map((memberId) => {
                            const member = memberById.get(memberId);
                            if (!member) return null;

                            return {
                                member_id: member.member_id,
                                name: `${member.first_name || ""} ${member.last_name || ""}`.trim() || "Unnamed swimmer",
                            };
                        })
                        .filter(Boolean),
                    roles: {
                        admin: isAdmin,
                        instructor: isAdmin || Boolean(roleSet?.has(ROLE_IDS.instructor)),
                        parent: Boolean(roleSet?.has(ROLE_IDS.parent)),
                        swimmer: swimmerPersonIds.has(person.person_id),
                    },
                };
            });

        const linkedMemberIdsFromPeople = new Set<string>();
        accountsFromPeople.forEach((account: any) => {
            if (account.member_id) {
                linkedMemberIdsFromPeople.add(account.member_id);
            }
        });

        const accountsFromMembers = (membersInOrg || [])
            .filter((member: any) => !linkedMemberIdsFromPeople.has(member.member_id))
            .map((member: any) => ({
                person_id: null,
                member_id: member.member_id,
                first_name: member.first_name || "",
                last_name: member.last_name || "",
                email: "",
                is_active: typeof member.is_active === "boolean" ? member.is_active : true,
                is_member_only: true,
                linkedSwimmers: [],
                roles: {
                    admin: false,
                    instructor: false,
                    parent: false,
                    swimmer: true,
                },
            }));

        const accounts = [...accountsFromPeople, ...accountsFromMembers]
            .sort((a: any, b: any) => {
                const aName = `${a.first_name || ""} ${a.last_name || ""}`.trim().toLowerCase();
                const bName = `${b.first_name || ""} ${b.last_name || ""}`.trim().toLowerCase();
                return aName.localeCompare(bName);
            });

        return NextResponse.json({ accounts });
    } catch (error) {
        console.error("Accounts GET error:", error);
        const message = error instanceof Error ? error.message : "Internal server error";
        if (message.startsWith("FORBIDDEN:")) {
            return NextResponse.json({ error: message.replace("FORBIDDEN:", "") }, { status: 403 });
        }
        if (message.startsWith("UNAUTHORIZED:")) {
            return NextResponse.json({ error: message.replace("UNAUTHORIZED:", "") }, { status: 401 });
        }
        if (message === "Missing admin email") {
            return NextResponse.json({ error: message }, { status: 400 });
        }
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const body = (await request.json()) as {
            person_id?: string;
            role?: RoleKey;
            enabled?: boolean;
        };

        if (!body.person_id || !body.role || typeof body.enabled !== "boolean") {
            return NextResponse.json(
                { error: "person_id, role, and enabled are required" },
                { status: 400 },
            );
        }

        const supabase = getSupabaseAdminClient();
        const adminContext = await resolveAdminRequestContext(request, supabase);
        const organizationId = adminContext.organizationId;

        const { data: personOrgRow, error: personOrgError } = await supabase
            .from("person_organization")
            .select("person_organization_id")
            .eq("person_id", body.person_id)
            .eq("organization_id", organizationId)
            .eq("status", "active")
            .maybeSingle();

        if (personOrgError) {
            return NextResponse.json(
                { error: `Failed to validate person in organization: ${personOrgError.message}` },
                { status: 500 },
            );
        }

        if (!personOrgRow) {
            return NextResponse.json(
                { error: "Person not found in this organization" },
                { status: 404 },
            );
        }

        if (body.role === "swimmer") {
            const { data: personMemberRows, error: personMemberError } = await supabase
                .from("person_member")
                .select("member_id")
                .eq("person_id", body.person_id);

            if (personMemberError) {
                return NextResponse.json(
                    { error: `Failed to check swimmer links: ${personMemberError.message}` },
                    { status: 500 },
                );
            }

            const linkedMemberIds = Array.from(
                new Set((personMemberRows || []).map((row: any) => row.member_id).filter(Boolean)),
            );

            let linkedMemberIdsInOrg: string[] = [];
            if (linkedMemberIds.length > 0) {
                const { data: linkedMembersInOrg, error: linkedMembersInOrgError } = await supabase
                    .from("member")
                    .select("member_id")
                    .in("member_id", linkedMemberIds)
                    .eq("organization_id", organizationId);

                if (linkedMembersInOrgError) {
                    return NextResponse.json(
                        { error: `Failed to validate swimmer links in org: ${linkedMembersInOrgError.message}` },
                        { status: 500 },
                    );
                }

                linkedMemberIdsInOrg = (linkedMembersInOrg || []).map((row: any) => row.member_id);
            }

            if (body.enabled) {
                if (linkedMemberIdsInOrg.length > 0) {
                    return NextResponse.json({ success: true });
                }

                const { data: personRow, error: personRowError } = await supabase
                    .from("person")
                    .select("first_name, last_name")
                    .eq("person_id", body.person_id)
                    .single();

                if (personRowError) {
                    return NextResponse.json(
                        { error: `Failed to load person details: ${personRowError.message}` },
                        { status: 500 },
                    );
                }

                const { data: newMember, error: createMemberError } = await supabase
                    .from("member")
                    .insert({
                        organization_id: organizationId,
                        first_name: personRow.first_name || "",
                        last_name: personRow.last_name || "",
                    })
                    .select("member_id")
                    .single();

                if (createMemberError || !newMember) {
                    return NextResponse.json(
                        { error: `Failed to create swimmer profile: ${createMemberError?.message || "Unknown error"}` },
                        { status: 500 },
                    );
                }

                const { error: linkError } = await supabase.from("person_member").insert({
                    person_id: body.person_id,
                    member_id: newMember.member_id,
                });

                if (linkError) {
                    return NextResponse.json(
                        { error: `Failed to link swimmer profile: ${linkError.message}` },
                        { status: 500 },
                    );
                }

                return NextResponse.json({ success: true });
            }

            if (linkedMemberIdsInOrg.length > 0) {
                const { error: unlinkError } = await supabase
                    .from("person_member")
                    .delete()
                    .eq("person_id", body.person_id)
                    .in("member_id", linkedMemberIdsInOrg);

                if (unlinkError) {
                    return NextResponse.json(
                        { error: `Failed to remove swimmer role: ${unlinkError.message}` },
                        { status: 500 },
                    );
                }
            }

            return NextResponse.json({ success: true });
        }

        const roleId = ROLE_IDS[body.role as keyof typeof ROLE_IDS];
        if (!roleId) {
            return NextResponse.json({ error: "Unsupported role" }, { status: 400 });
        }

        if (body.role === "instructor" && !body.enabled) {
            const { data: adminRoleRow, error: adminRoleError } = await supabase
                .from("person_org_role")
                .select("role_id")
                .eq("person_organization_id", personOrgRow.person_organization_id)
                .eq("role_id", ROLE_IDS.admin)
                .maybeSingle();

            if (adminRoleError) {
                return NextResponse.json(
                    { error: `Failed to validate admin role: ${adminRoleError.message}` },
                    { status: 500 },
                );
            }

            if (adminRoleRow) {
                return NextResponse.json(
                    { error: "Instructors cannot be removed while admin role is active." },
                    { status: 400 },
                );
            }
        }

        if (body.enabled) {
            const rolesToUpsert =
                body.role === "admin"
                    ? [ROLE_IDS.admin, ROLE_IDS.instructor]
                    : [roleId];

            const { error: upsertError } = await supabase.from("person_org_role").upsert(
                rolesToUpsert.map((currentRoleId) => ({
                    person_organization_id: personOrgRow.person_organization_id,
                    role_id: currentRoleId,
                })),
                { onConflict: "person_organization_id,role_id" },
            );

            if (upsertError) {
                return NextResponse.json(
                    { error: `Failed to assign role: ${upsertError.message}` },
                    { status: 500 },
                );
            }
        } else {
            const { error: deleteError } = await supabase
                .from("person_org_role")
                .delete()
                .eq("person_organization_id", personOrgRow.person_organization_id)
                .eq("role_id", roleId);

            if (deleteError) {
                return NextResponse.json(
                    { error: `Failed to remove role: ${deleteError.message}` },
                    { status: 500 },
                );
            }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Accounts PATCH error:", error);
        const message = error instanceof Error ? error.message : "Internal server error";
        if (message.startsWith("FORBIDDEN:")) {
            return NextResponse.json({ error: message.replace("FORBIDDEN:", "") }, { status: 403 });
        }
        if (message.startsWith("UNAUTHORIZED:")) {
            return NextResponse.json({ error: message.replace("UNAUTHORIZED:", "") }, { status: 401 });
        }
        if (message === "Missing admin email") {
            return NextResponse.json({ error: message }, { status: 400 });
        }
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
