import { NextRequest, NextResponse } from 'next/server';
import { AuthContextError, getCurrentPersonFromRequest } from '@/lib/serverAuth';
import { normalizeRole } from '@/lib/authRoles';
import { getSupabaseAdminClient } from '@/lib/supabaseAdmin';

const INSTRUCTOR_ROUTE_ROLE_SET = new Set(['instructor', 'admin', 'org-admin', 'super-admin', 'superadmin']);

async function resolveInstructorEmail(
  request: NextRequest,
): Promise<{ email: string; source: 'session' | 'email' }> {
  let sessionPerson = null;
  try {
    sessionPerson = await getCurrentPersonFromRequest(request);
  } catch (error) {
    if (!(error instanceof AuthContextError)) {
      throw error;
    }

    const fallbackEmail = request.nextUrl.searchParams.get('email');
    if (!fallbackEmail) {
      throw new Error(`UNAUTHORIZED:${error.message}`);
    }
  }

  if (sessionPerson?.email) {
    const hasAllowedRole = sessionPerson.roleNames.some((role) =>
      INSTRUCTOR_ROUTE_ROLE_SET.has(normalizeRole(role)),
    );

    if (!hasAllowedRole) {
      throw new Error('FORBIDDEN:You do not have access to this instructor route.');
    }

    return { email: sessionPerson.email, source: 'session' };
  }

  const email = request.nextUrl.searchParams.get('email');
  if (!email) {
    throw new Error('Missing required query param: email');
  }

  return { email, source: 'email' };
}

export async function GET(request: NextRequest) {
  try {
    const { email } = await resolveInstructorEmail(request);
    const supabase = getSupabaseAdminClient();

    const { data: person, error: personError } = await supabase
      .from('person')
      .select('person_id')
      .ilike('email', email)
      .maybeSingle();

    if (personError) {
      return NextResponse.json(
        { error: `Failed to load person: ${personError.message}` },
        { status: 500 },
      );
    }

    if (!person?.person_id) {
      return NextResponse.json({ publicUrl: null });
    }

    const { data: personOrg, error: personOrgError } = await supabase
      .from('person_organization')
      .select('organization_id')
      .eq('person_id', person.person_id)
      .eq('status', 'active')
      .order('joined_at', { ascending: false })
      .maybeSingle();

    if (personOrgError) {
      return NextResponse.json(
        { error: `Failed to load organization membership: ${personOrgError.message}` },
        { status: 500 },
      );
    }

    const orgId = personOrg?.organization_id;
    if (!orgId) {
      return NextResponse.json({ publicUrl: null });
    }

    const { data: files, error: listError } = await supabase.storage
      .from('organization-logos')
      .list(orgId);

    if (listError) {
      return NextResponse.json({ error: 'Failed to list files' }, { status: 500 });
    }

    const exists = files?.some((file) => file.name === 'logo.png');
    if (!exists) {
      return NextResponse.json({ publicUrl: null });
    }

    const { data } = supabase.storage
      .from('organization-logos')
      .getPublicUrl(`${orgId}/logo.png`);

    return NextResponse.json({
      publicUrl: data?.publicUrl ? `${data.publicUrl}?t=${Date.now()}` : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (message.startsWith('FORBIDDEN:')) {
      return NextResponse.json({ error: message.replace('FORBIDDEN:', '') }, { status: 403 });
    }
    if (message.startsWith('UNAUTHORIZED:')) {
      return NextResponse.json({ error: message.replace('UNAUTHORIZED:', '') }, { status: 401 });
    }
    if (message === 'Missing required query param: email') {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
