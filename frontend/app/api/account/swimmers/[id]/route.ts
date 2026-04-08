import { NextRequest, NextResponse } from "next/server";
import {
  AuthContextError,
  getCurrentPersonFromRequest,
} from "@/lib/serverAuth";
import { buildParentSwimmerProfile } from "@/lib/accountSwimmerProfiles";

interface RouteParams {
  params: { id: string };
}

const ACCOUNT_ROUTE_ROLE_SET = new Set([
  "guardian",
  "parent",
  "account",
  "member",
  "human",
  "swimmer",
  "admin",
  "super-admin",
  "superadmin",
]);

async function resolveAccountPersonForRequest(request: NextRequest) {
  let sessionPerson = null;

  try {
    sessionPerson = await getCurrentPersonFromRequest(request);
  } catch (error) {
    if (error instanceof AuthContextError) {
      return {
        error: `UNAUTHORIZED:${error.message}` as const,
      };
    }
    throw error;
  }

  if (!sessionPerson) {
    return {
      error: "UNAUTHORIZED:No active session" as const,
    };
  }

  const hasAllowedRole = sessionPerson.roleNames.some((role) =>
    ACCOUNT_ROUTE_ROLE_SET.has(role.toLowerCase()),
  );

  if (!hasAllowedRole) {
    return {
      error: "FORBIDDEN:You do not have access to this account route." as const,
    };
  }

  return {
    person: {
      person_id: sessionPerson.personId,
    },
  };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const memberId = params.id;
    const accountResolution = await resolveAccountPersonForRequest(request);

    if ("error" in accountResolution) {
      const errorMessage = accountResolution.error ?? "Missing account email";
      return NextResponse.json(
        {
          error: errorMessage
            .replace("FORBIDDEN:", "")
            .replace("UNAUTHORIZED:", ""),
        },
        {
          status: errorMessage.startsWith("FORBIDDEN:")
            ? 403
            : errorMessage.startsWith("UNAUTHORIZED:")
              ? 401
              : 400,
        },
      );
    }

    const payload = await buildParentSwimmerProfile(
      accountResolution.person.person_id,
      memberId,
    );

    if (!payload) {
      return NextResponse.json(
        { error: "You do not have access to this swimmer." },
        { status: 403 },
      );
    }

    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";

    if (message.startsWith("FORBIDDEN:")) {
      return NextResponse.json(
        { error: message.replace("FORBIDDEN:", "") },
        { status: 403 },
      );
    }
    if (message.startsWith("NOT_FOUND:")) {
      return NextResponse.json(
        { error: message.replace("NOT_FOUND:", "") },
        { status: 404 },
      );
    }
    if (message.startsWith("Failed to")) {
      return NextResponse.json({ error: message }, { status: 500 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
