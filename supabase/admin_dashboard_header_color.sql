alter table if exists public.organization
add column if not exists header_color text;

alter table if exists public.organization
  drop constraint if exists organization_header_color_format;

alter table if exists public.organization
  add constraint organization_header_color_format
  check (header_color is null or header_color ~* '^#[0-9a-f]{6}$');
