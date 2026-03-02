begin;

create extension if not exists pgcrypto;

-- =========================================================
-- 1) Core schema
-- =========================================================

create table if not exists person (
  person_id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text not null unique,
  person_type text not null default 'human' check (person_type in ('human', 'service')),
  first_name text,
  last_name text,
  date_of_birth date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists organization (
  organization_id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  created_by uuid not null references person(person_id) on delete restrict
);

create table if not exists person_organization (
  person_organization_id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(person_id) on delete cascade,
  organization_id uuid not null references organization(organization_id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'inactive', 'invited')),
  joined_at timestamptz not null default now(),
  unique (person_id, organization_id)
);

create table if not exists role (
  role_id int generated always as identity primary key,
  name text not null unique,
  scope text not null check (scope in ('global', 'organization'))
);

create table if not exists person_global_role (
  person_id uuid not null references person(person_id) on delete cascade,
  role_id int not null references role(role_id) on delete restrict,
  assigned_at timestamptz not null default now(),
  primary key (person_id, role_id)
);

create table if not exists person_org_role (
  person_organization_id uuid not null references person_organization(person_organization_id) on delete cascade,
  role_id int not null references role(role_id) on delete restrict,
  assigned_at timestamptz not null default now(),
  primary key (person_organization_id, role_id)
);

create table if not exists member (
  member_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(organization_id) on delete cascade,
  first_name text not null,
  last_name text not null,
  date_of_birth date,
  level text,
  created_at timestamptz not null default now()
);

-- Optional bridge so a logged-in person can be "their own swimmer account"
create table if not exists person_member (
  person_id uuid not null references person(person_id) on delete cascade,
  member_id uuid not null references member(member_id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (person_id, member_id),
  unique (member_id)
);

create table if not exists class_entity (
  class_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(organization_id) on delete cascade,
  name text not null,
  schedule text,
  length_minutes int check (length_minutes is null or length_minutes > 0),
  created_at timestamptz not null default now()
);

create table if not exists skill (
  skill_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(organization_id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists member_skill (
  member_id uuid not null references member(member_id) on delete cascade,
  skill_id uuid not null references skill(skill_id) on delete cascade,
  progress int not null default 0 check (progress between 0 and 100),
  date_acquired date,
  updated_by_person_id uuid references person(person_id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (member_id, skill_id)
);

create table if not exists enrollment (
  member_id uuid not null references member(member_id) on delete cascade,
  class_id uuid not null references class_entity(class_id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  primary key (member_id, class_id)
);

create table if not exists class_instructor (
  person_id uuid not null references person(person_id) on delete cascade,
  class_id uuid not null references class_entity(class_id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (person_id, class_id)
);

create table if not exists guardian_member (
  guardian_person_id uuid not null references person(person_id) on delete cascade,
  member_id uuid not null references member(member_id) on delete cascade,
  relationship text,
  linked_at timestamptz not null default now(),
  primary key (guardian_person_id, member_id)
);

create table if not exists evaluation (
  evaluation_id uuid primary key default gen_random_uuid(),
  instructor_person_id uuid not null references person(person_id) on delete restrict,
  member_id uuid not null references member(member_id) on delete cascade,
  class_id uuid not null references class_entity(class_id) on delete restrict,
  feedback text,
  evaluation_date date not null default current_date,
  created_at timestamptz not null default now()
);

-- Optional dedupe for same day same class evals
create unique index if not exists ux_evaluation_unique_per_day
on evaluation (instructor_person_id, member_id, class_id, evaluation_date);

-- =========================================================
-- 2) Indexes
-- =========================================================
create index if not exists idx_person_auth_user_id on person(auth_user_id);
create index if not exists idx_po_person on person_organization(person_id);
create index if not exists idx_po_org_status on person_organization(organization_id, status);
create index if not exists idx_member_org on member(organization_id);
create index if not exists idx_class_org on class_entity(organization_id);
create index if not exists idx_skill_org on skill(organization_id);
create index if not exists idx_enrollment_class on enrollment(class_id);
create index if not exists idx_class_instructor_class on class_instructor(class_id);
create index if not exists idx_member_skill_member on member_skill(member_id);
create index if not exists idx_guardian_member_member on guardian_member(member_id);
create index if not exists idx_eval_member on evaluation(member_id);
create index if not exists idx_eval_class on evaluation(class_id);

-- =========================================================
-- 3) Seed roles
-- =========================================================
insert into role (name, scope) values
  ('super_admin', 'global'),
  ('org_admin', 'organization'),
  ('instructor', 'organization'),
  ('guardian', 'organization'),
  ('member', 'organization')
on conflict (name) do nothing;

-- =========================================================
-- 4) Auto-create person row for each new auth user
-- =========================================================
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.person (
    auth_user_id,
    email,
    first_name,
    last_name,
    person_type,
    is_active
  )
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    'human',
    true
  )
  on conflict (auth_user_id) do update
  set email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- =========================================================
-- 5) Helper auth functions (for RLS/policies)
-- =========================================================
create or replace function app_current_person_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.person_id
  from person p
  where p.auth_user_id = auth.uid()
  limit 1
$$;

create or replace function app_has_global_role(role_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from person_global_role pgr
    join role r on r.role_id = pgr.role_id
    where pgr.person_id = app_current_person_id()
      and r.name = role_name
      and r.scope = 'global'
  )
$$;

create or replace function app_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_has_global_role('super_admin')
$$;

create or replace function app_is_member_of_org(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from person_organization po
    where po.person_id = app_current_person_id()
      and po.organization_id = target_org
      and po.status = 'active'
  )
$$;

create or replace function app_has_org_role(target_org uuid, role_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from person_organization po
    join person_org_role por on por.person_organization_id = po.person_organization_id
    join role r on r.role_id = por.role_id
    where po.person_id = app_current_person_id()
      and po.organization_id = target_org
      and po.status = 'active'
      and r.name = role_name
      and r.scope = 'organization'
  )
$$;

create or replace function app_org_id_for_member(target_member uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.organization_id
  from member m
  where m.member_id = target_member
$$;

create or replace function app_org_id_for_class(target_class uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.organization_id
  from class_entity c
  where c.class_id = target_class
$$;

create or replace function app_is_instructor_for_class(target_class uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from class_instructor ci
    where ci.class_id = target_class
      and ci.person_id = app_current_person_id()
  )
$$;

create or replace function app_is_instructor_for_member(target_member uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from enrollment e
    join class_instructor ci on ci.class_id = e.class_id
    where e.member_id = target_member
      and ci.person_id = app_current_person_id()
  )
$$;

create or replace function app_is_guardian_of_member(target_member uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from guardian_member gm
    where gm.member_id = target_member
      and gm.guardian_person_id = app_current_person_id()
  )
$$;

create or replace function app_is_member_self(target_member uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from person_member pm
    where pm.member_id = target_member
      and pm.person_id = app_current_person_id()
  )
$$;

-- =========================================================
-- 6) Role-scope correctness triggers (A)
-- =========================================================
create or replace function trg_person_global_role_scope_check()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from role r
    where r.role_id = new.role_id
      and r.scope = 'global'
  ) then
    raise exception 'person_global_role.role_id must reference role.scope = global';
  end if;
  return new;
end;
$$;

drop trigger if exists person_global_role_scope_check on person_global_role;
create trigger person_global_role_scope_check
before insert or update on person_global_role
for each row execute function trg_person_global_role_scope_check();

create or replace function trg_person_org_role_scope_check()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from role r
    where r.role_id = new.role_id
      and r.scope = 'organization'
  ) then
    raise exception 'person_org_role.role_id must reference role.scope = organization';
  end if;
  return new;
end;
$$;

drop trigger if exists person_org_role_scope_check on person_org_role;
create trigger person_org_role_scope_check
before insert or update on person_org_role
for each row execute function trg_person_org_role_scope_check();

-- =========================================================
-- 7) Cross-org consistency triggers (critical)
-- =========================================================
create or replace function trg_person_member_same_org()
returns trigger
language plpgsql
as $$
declare
  m_org uuid;
  ok boolean;
begin
  select organization_id into m_org from member where member_id = new.member_id;

  select exists (
    select 1
    from person_organization po
    where po.person_id = new.person_id
      and po.organization_id = m_org
      and po.status = 'active'
  ) into ok;

  if m_org is null or not ok then
    raise exception 'person_member org mismatch';
  end if;

  return new;
end;
$$;

drop trigger if exists person_member_same_org on person_member;
create trigger person_member_same_org
before insert or update on person_member
for each row execute function trg_person_member_same_org();

create or replace function trg_enrollment_same_org()
returns trigger
language plpgsql
as $$
declare
  m_org uuid;
  c_org uuid;
begin
  select organization_id into m_org from member where member_id = new.member_id;
  select organization_id into c_org from class_entity where class_id = new.class_id;

  if m_org is null or c_org is null or m_org <> c_org then
    raise exception 'enrollment org mismatch';
  end if;

  return new;
end;
$$;

drop trigger if exists enrollment_same_org on enrollment;
create trigger enrollment_same_org
before insert or update on enrollment
for each row execute function trg_enrollment_same_org();

create or replace function trg_class_instructor_same_org()
returns trigger
language plpgsql
as $$
declare
  c_org uuid;
  in_org boolean;
  has_role boolean;
begin
  select organization_id into c_org from class_entity where class_id = new.class_id;

  select exists (
    select 1 from person_organization po
    where po.person_id = new.person_id
      and po.organization_id = c_org
      and po.status = 'active'
  ) into in_org;

  select exists (
    select 1
    from person_organization po
    join person_org_role por on por.person_organization_id = po.person_organization_id
    join role r on r.role_id = por.role_id
    where po.person_id = new.person_id
      and po.organization_id = c_org
      and po.status = 'active'
      and r.name = 'instructor'
  ) into has_role;

  if c_org is null or not in_org or not has_role then
    raise exception 'class_instructor requires same org + instructor role';
  end if;

  return new;
end;
$$;

drop trigger if exists class_instructor_same_org on class_instructor;
create trigger class_instructor_same_org
before insert or update on class_instructor
for each row execute function trg_class_instructor_same_org();

create or replace function trg_guardian_member_same_org()
returns trigger
language plpgsql
as $$
declare
  m_org uuid;
  in_org boolean;
  has_role boolean;
begin
  select organization_id into m_org from member where member_id = new.member_id;

  select exists (
    select 1 from person_organization po
    where po.person_id = new.guardian_person_id
      and po.organization_id = m_org
      and po.status = 'active'
  ) into in_org;

  select exists (
    select 1
    from person_organization po
    join person_org_role por on por.person_organization_id = po.person_organization_id
    join role r on r.role_id = por.role_id
    where po.person_id = new.guardian_person_id
      and po.organization_id = m_org
      and po.status = 'active'
      and r.name = 'guardian'
  ) into has_role;

  if m_org is null or not in_org or not has_role then
    raise exception 'guardian_member requires same org + guardian role';
  end if;

  return new;
end;
$$;

drop trigger if exists guardian_member_same_org on guardian_member;
create trigger guardian_member_same_org
before insert or update on guardian_member
for each row execute function trg_guardian_member_same_org();

create or replace function trg_member_skill_same_org()
returns trigger
language plpgsql
as $$
declare
  m_org uuid;
  s_org uuid;
  updater_in_org boolean;
begin
  select organization_id into m_org from member where member_id = new.member_id;
  select organization_id into s_org from skill where skill_id = new.skill_id;

  if m_org is null or s_org is null or m_org <> s_org then
    raise exception 'member_skill org mismatch';
  end if;

  if new.updated_by_person_id is not null then
    select exists (
      select 1 from person_organization po
      where po.person_id = new.updated_by_person_id
        and po.organization_id = m_org
        and po.status = 'active'
    ) into updater_in_org;

    if not updater_in_org then
      raise exception 'member_skill updater must belong to same org';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists member_skill_same_org on member_skill;
create trigger member_skill_same_org
before insert or update on member_skill
for each row execute function trg_member_skill_same_org();

create or replace function trg_evaluation_same_org()
returns trigger
language plpgsql
as $$
declare
  m_org uuid;
  c_org uuid;
  inst_in_org boolean;
  inst_on_class boolean;
begin
  select organization_id into m_org from member where member_id = new.member_id;
  select organization_id into c_org from class_entity where class_id = new.class_id;

  if m_org is null or c_org is null or m_org <> c_org then
    raise exception 'evaluation member/class org mismatch';
  end if;

  select exists (
    select 1 from person_organization po
    where po.person_id = new.instructor_person_id
      and po.organization_id = m_org
      and po.status = 'active'
  ) into inst_in_org;

  select exists (
    select 1 from class_instructor ci
    where ci.class_id = new.class_id
      and ci.person_id = new.instructor_person_id
  ) into inst_on_class;

  if not inst_in_org or not inst_on_class then
    raise exception 'evaluation instructor must belong to org and be assigned to class';
  end if;

  return new;
end;
$$;

drop trigger if exists evaluation_same_org on evaluation;
create trigger evaluation_same_org
before insert or update on evaluation
for each row execute function trg_evaluation_same_org();

create or replace function trg_organization_created_by_super_admin()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from person_global_role pgr
    join role r on r.role_id = pgr.role_id
    where pgr.person_id = new.created_by
      and r.name = 'super_admin'
      and r.scope = 'global'
  ) then
    raise exception 'organization.created_by must have global super_admin role';
  end if;
  return new;
end;
$$;

drop trigger if exists organization_created_by_super_admin on organization;
create trigger organization_created_by_super_admin
before insert or update on organization
for each row execute function trg_organization_created_by_super_admin();

-- =========================================================
-- 8) Protect sensitive person columns (C)
-- =========================================================
create or replace function trg_person_protect_sensitive_cols()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('postgres', 'service_role') or app_is_super_admin() then
    return new;
  end if;

  if new.auth_user_id is distinct from old.auth_user_id
     or new.person_type is distinct from old.person_type
     or new.is_active is distinct from old.is_active
     or new.email is distinct from old.email then
    raise exception 'Not allowed to modify sensitive person fields';
  end if;

  return new;
end;
$$;

drop trigger if exists person_protect_sensitive_cols on person;
create trigger person_protect_sensitive_cols
before update on person
for each row execute function trg_person_protect_sensitive_cols();

-- =========================================================
-- 9) Auto-update member_skill.updated_at (D)
-- =========================================================
create or replace function trg_member_skill_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists member_skill_touch_updated_at on member_skill;
create trigger member_skill_touch_updated_at
before update on member_skill
for each row execute function trg_member_skill_touch_updated_at();

-- =========================================================
-- 10) RLS + role-aware policies (B)
-- =========================================================

alter table person enable row level security;
alter table organization enable row level security;
alter table person_organization enable row level security;
alter table role enable row level security;
alter table person_global_role enable row level security;
alter table person_org_role enable row level security;
alter table member enable row level security;
alter table person_member enable row level security;
alter table class_entity enable row level security;
alter table skill enable row level security;
alter table member_skill enable row level security;
alter table enrollment enable row level security;
alter table class_instructor enable row level security;
alter table guardian_member enable row level security;
alter table evaluation enable row level security;

-- PERSON
drop policy if exists person_select on person;
create policy person_select on person
for select to authenticated
using (
  app_is_super_admin()
  or person_id = app_current_person_id()
  or exists (
    select 1
    from person_organization po_self
    join person_organization po_target
      on po_target.organization_id = po_self.organization_id
    where po_self.person_id = app_current_person_id()
      and po_self.status = 'active'
      and po_target.person_id = person.person_id
      and app_has_org_role(po_self.organization_id, 'org_admin')
  )
);

drop policy if exists person_insert on person;
create policy person_insert on person
for insert to authenticated
with check (app_is_super_admin() or auth_user_id = auth.uid());

drop policy if exists person_update on person;
create policy person_update on person
for update to authenticated
using (app_is_super_admin() or person_id = app_current_person_id())
with check (app_is_super_admin() or person_id = app_current_person_id());

drop policy if exists person_delete on person;
create policy person_delete on person
for delete to authenticated
using (app_is_super_admin());

-- ORGANIZATION
drop policy if exists organization_select on organization;
create policy organization_select on organization
for select to authenticated
using (app_is_super_admin() or app_is_member_of_org(organization_id));

drop policy if exists organization_insert on organization;
create policy organization_insert on organization
for insert to authenticated
with check (app_is_super_admin() and created_by = app_current_person_id());

drop policy if exists organization_update on organization;
create policy organization_update on organization
for update to authenticated
using (app_is_super_admin())
with check (app_is_super_admin());

drop policy if exists organization_delete on organization;
create policy organization_delete on organization
for delete to authenticated
using (app_is_super_admin());

-- PERSON_ORGANIZATION
drop policy if exists po_select on person_organization;
create policy po_select on person_organization
for select to authenticated
using (
  app_is_super_admin()
  or person_id = app_current_person_id()
  or app_has_org_role(organization_id, 'org_admin')
);

drop policy if exists po_insert on person_organization;
create policy po_insert on person_organization
for insert to authenticated
with check (app_is_super_admin() or app_has_org_role(organization_id, 'org_admin'));

drop policy if exists po_update on person_organization;
create policy po_update on person_organization
for update to authenticated
using (app_is_super_admin() or app_has_org_role(organization_id, 'org_admin'))
with check (app_is_super_admin() or app_has_org_role(organization_id, 'org_admin'));

drop policy if exists po_delete on person_organization;
create policy po_delete on person_organization
for delete to authenticated
using (app_is_super_admin() or app_has_org_role(organization_id, 'org_admin'));

-- ROLE
drop policy if exists role_select on role;
create policy role_select on role
for select to authenticated
using (true);

drop policy if exists role_write on role;
create policy role_write on role
for all to authenticated
using (app_is_super_admin())
with check (app_is_super_admin());

-- PERSON_GLOBAL_ROLE
drop policy if exists pgr_select on person_global_role;
create policy pgr_select on person_global_role
for select to authenticated
using (app_is_super_admin() or person_id = app_current_person_id());

drop policy if exists pgr_write on person_global_role;
create policy pgr_write on person_global_role
for all to authenticated
using (app_is_super_admin())
with check (app_is_super_admin());

-- PERSON_ORG_ROLE
drop policy if exists por_select on person_org_role;
create policy por_select on person_org_role
for select to authenticated
using (
  app_is_super_admin()
  or exists (
    select 1
    from person_organization po
    where po.person_organization_id = person_org_role.person_organization_id
      and (
        po.person_id = app_current_person_id()
        or app_has_org_role(po.organization_id, 'org_admin')
      )
  )
);

drop policy if exists por_insert on person_org_role;
create policy por_insert on person_org_role
for insert to authenticated
with check (
  app_is_super_admin()
  or exists (
    select 1
    from person_organization po
    where po.person_organization_id = person_org_role.person_organization_id
      and app_has_org_role(po.organization_id, 'org_admin')
  )
);

drop policy if exists por_update on person_org_role;
create policy por_update on person_org_role
for update to authenticated
using (
  app_is_super_admin()
  or exists (
    select 1
    from person_organization po
    where po.person_organization_id = person_org_role.person_organization_id
      and app_has_org_role(po.organization_id, 'org_admin')
  )
)
with check (
  app_is_super_admin()
  or exists (
    select 1
    from person_organization po
    where po.person_organization_id = person_org_role.person_organization_id
      and app_has_org_role(po.organization_id, 'org_admin')
  )
);

drop policy if exists por_delete on person_org_role;
create policy por_delete on person_org_role
for delete to authenticated
using (
  app_is_super_admin()
  or exists (
    select 1
    from person_organization po
    where po.person_organization_id = person_org_role.person_organization_id
      and app_has_org_role(po.organization_id, 'org_admin')
  )
);

-- MEMBER
drop policy if exists member_select on member;
create policy member_select on member
for select to authenticated
using (
  app_is_super_admin()
  or app_has_org_role(organization_id, 'org_admin')
  or app_has_org_role(organization_id, 'instructor')
  or app_is_guardian_of_member(member_id)
  or app_is_member_self(member_id)
);

drop policy if exists member_insert on member;
create policy member_insert on member
for insert to authenticated
with check (
  app_is_super_admin()
  or app_has_org_role(organization_id, 'org_admin')
);

drop policy if exists member_update on member;
create policy member_update on member
for update to authenticated
using (
  app_is_super_admin()
  or app_has_org_role(organization_id, 'org_admin')
)
with check (
  app_is_super_admin()
  or app_has_org_role(organization_id, 'org_admin')
);

drop policy if exists member_delete on member;
create policy member_delete on member
for delete to authenticated
using (
  app_is_super_admin()
  or app_has_org_role(organization_id, 'org_admin')
);

-- PERSON_MEMBER
drop policy if exists person_member_select on person_member;
create policy person_member_select on person_member
for select to authenticated
using (
  app_is_super_admin()
  or person_id = app_current_person_id()
  or app_has_org_role(app_org_id_for_member(member_id), 'org_admin')
);

drop policy if exists person_member_write on person_member;
create policy person_member_write on person_member
for all to authenticated
using (
  app_is_super_admin()
  or app_has_org_role(app_org_id_for_member(member_id), 'org_admin')
)
with check (
  app_is_super_admin()
  or app_has_org_role(app_org_id_for_member(member_id), 'org_admin')
);

-- CLASS_ENTITY
drop policy if exists class_select on class_entity;
create policy class_select on class_entity
for select to authenticated
using (app_is_super_admin() or app_is_member_of_org(organization_id));

drop policy if exists class_insert on class_entity;
create policy class_insert on class_entity
for insert to authenticated
with check (app_is_super_admin() or app_has_org_role(organization_id, 'org_admin'));

drop policy if exists class_update on class_entity;
create policy class_update on class_entity
for update to authenticated
using (app_is_super_admin() or app_has_org_role(organization_id, 'org_admin'))
with check (app_is_super_admin() or app_has_org_role(organization_id, 'org_admin'));

drop policy if exists class_delete on class_entity;
create policy class_delete on class_entity
for delete to authenticated
using (app_is_super_admin() or app_has_org_role(organization_id, 'org_admin'));

-- SKILL
drop policy if exists skill_select on skill;
create policy skill_select on skill
for select to authenticated
using (app_is_super_admin() or app_is_member_of_org(organization_id));

drop policy if exists skill_insert on skill;
create policy skill_insert on skill
for insert to authenticated
with check (app_is_super_admin() or app_has_org_role(organization_id, 'org_admin'));

drop policy if exists skill_update on skill;
create policy skill_update on skill
for update to authenticated
using (app_is_super_admin() or app_has_org_role(organization_id, 'org_admin'))
with check (app_is_super_admin() or app_has_org_role(organization_id, 'org_admin'));

drop policy if exists skill_delete on skill;
create policy skill_delete on skill
for delete to authenticated
using (app_is_super_admin() or app_has_org_role(organization_id, 'org_admin'));

-- MEMBER_SKILL
drop policy if exists member_skill_select on member_skill;
create policy member_skill_select on member_skill
for select to authenticated
using (
  app_is_super_admin()
  or app_has_org_role(app_org_id_for_member(member_id), 'org_admin')
  or app_has_org_role(app_org_id_for_member(member_id), 'instructor')
  or app_is_guardian_of_member(member_id)
  or app_is_member_self(member_id)
);

drop policy if exists member_skill_insert on member_skill;
create policy member_skill_insert on member_skill
for insert to authenticated
with check (
  app_is_super_admin()
  or app_has_org_role(app_org_id_for_member(member_id), 'org_admin')
  or app_is_instructor_for_member(member_id)
);

drop policy if exists member_skill_update on member_skill;
create policy member_skill_update on member_skill
for update to authenticated
using (
  app_is_super_admin()
  or app_has_org_role(app_org_id_for_member(member_id), 'org_admin')
  or app_is_instructor_for_member(member_id)
)
with check (
  app_is_super_admin()
  or app_has_org_role(app_org_id_for_member(member_id), 'org_admin')
  or app_is_instructor_for_member(member_id)
);

drop policy if exists member_skill_delete on member_skill;
create policy member_skill_delete on member_skill
for delete to authenticated
using (
  app_is_super_admin()
  or app_has_org_role(app_org_id_for_member(member_id), 'org_admin')
);

-- ENROLLMENT
drop policy if exists enrollment_select on enrollment;
create policy enrollment_select on enrollment
for select to authenticated
using (
  app_is_super_admin()
  or app_has_org_role(app_org_id_for_class(class_id), 'org_admin')
  or app_is_instructor_for_class(class_id)
  or app_is_guardian_of_member(member_id)
  or app_is_member_self(member_id)
);

drop policy if exists enrollment_insert on enrollment;
create policy enrollment_insert on enrollment
for insert to authenticated
with check (
  app_is_super_admin()
  or app_has_org_role(app_org_id_for_class(class_id), 'org_admin')
  or app_is_instructor_for_class(class_id)
);

drop policy if exists enrollment_update on enrollment;
create policy enrollment_update on enrollment
for update to authenticated
using (
  app_is_super_admin()
  or app_has_org_role(app_org_id_for_class(class_id), 'org_admin')
  or app_is_instructor_for_class(class_id)
)
with check (
  app_is_super_admin()
  or app_has_org_role(app_org_id_for_class(class_id), 'org_admin')
  or app_is_instructor_for_class(class_id)
);

drop policy if exists enrollment_delete on enrollment;
create policy enrollment_delete on enrollment
for delete to authenticated
using (
  app_is_super_admin()
  or app_has_org_role(app_org_id_for_class(class_id), 'org_admin')
  or app_is_instructor_for_class(class_id)
);

-- CLASS_INSTRUCTOR
drop policy if exists class_instructor_select on class_instructor;
create policy class_instructor_select on class_instructor
for select to authenticated
using (
  app_is_super_admin()
  or app_has_org_role(app_org_id_for_class(class_id), 'org_admin')
  or app_is_instructor_for_class(class_id)
);

drop policy if exists class_instructor_write on class_instructor;
create policy class_instructor_write on class_instructor
for all to authenticated
using (
  app_is_super_admin()
  or app_has_org_role(app_org_id_for_class(class_id), 'org_admin')
)
with check (
  app_is_super_admin()
  or app_has_org_role(app_org_id_for_class(class_id), 'org_admin')
);

-- GUARDIAN_MEMBER
drop policy if exists guardian_member_select on guardian_member;
create policy guardian_member_select on guardian_member
for select to authenticated
using (
  app_is_super_admin()
  or app_has_org_role(app_org_id_for_member(member_id), 'org_admin')
  or guardian_person_id = app_current_person_id()
);

drop policy if exists guardian_member_write on guardian_member;
create policy guardian_member_write on guardian_member
for all to authenticated
using (
  app_is_super_admin()
  or app_has_org_role(app_org_id_for_member(member_id), 'org_admin')
)
with check (
  app_is_super_admin()
  or app_has_org_role(app_org_id_for_member(member_id), 'org_admin')
);

-- EVALUATION
drop policy if exists evaluation_select on evaluation;
create policy evaluation_select on evaluation
for select to authenticated
using (
  app_is_super_admin()
  or app_has_org_role(app_org_id_for_class(class_id), 'org_admin')
  or app_is_instructor_for_class(class_id)
  or app_is_guardian_of_member(member_id)
  or app_is_member_self(member_id)
);

drop policy if exists evaluation_insert on evaluation;
create policy evaluation_insert on evaluation
for insert to authenticated
with check (
  app_is_super_admin()
  or app_has_org_role(app_org_id_for_class(class_id), 'org_admin')
  or (app_is_instructor_for_class(class_id) and instructor_person_id = app_current_person_id())
);

drop policy if exists evaluation_update on evaluation;
create policy evaluation_update on evaluation
for update to authenticated
using (
  app_is_super_admin()
  or app_has_org_role(app_org_id_for_class(class_id), 'org_admin')
  or (app_is_instructor_for_class(class_id) and instructor_person_id = app_current_person_id())
)
with check (
  app_is_super_admin()
  or app_has_org_role(app_org_id_for_class(class_id), 'org_admin')
  or (app_is_instructor_for_class(class_id) and instructor_person_id = app_current_person_id())
);

drop policy if exists evaluation_delete on evaluation;
create policy evaluation_delete on evaluation
for delete to authenticated
using (
  app_is_super_admin()
  or app_has_org_role(app_org_id_for_class(class_id), 'org_admin')
);

-- Optional hardening
alter table person force row level security;
alter table organization force row level security;
alter table person_organization force row level security;
alter table role force row level security;
alter table person_global_role force row level security;
alter table person_org_role force row level security;
alter table member force row level security;
alter table person_member force row level security;
alter table class_entity force row level security;
alter table skill force row level security;
alter table member_skill force row level security;
alter table enrollment force row level security;
alter table class_instructor force row level security;
alter table guardian_member force row level security;
alter table evaluation force row level security;

commit;

-- =========================================================
-- Bootstrap first super admin (run once as SQL editor user):
-- 1) Ensure your auth user exists in auth.users
-- 2) Find your person row:
--    select person_id, auth_user_id, email from person where auth_user_id = 'YOUR_AUTH_USER_UUID';
-- 3) Grant super_admin:
--    insert into person_global_role (person_id, role_id)
--    select 'YOUR_PERSON_UUID', role_id from role where name = 'super_admin'
--    on conflict do nothing;
-- =========================================================
