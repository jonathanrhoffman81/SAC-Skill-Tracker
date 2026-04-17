-- Admin dashboard performance indexes + aggregate structures

-- Hot filter/sort indexes
create index if not exists idx_evaluation_member_id
  on public.evaluation (member_id);

create index if not exists idx_evaluation_member_date
  on public.evaluation (member_id, evaluation_date desc);

create index if not exists idx_evaluation_evaluation_date
  on public.evaluation (evaluation_date desc);

create index if not exists idx_enrollment_member_id
  on public.enrollment (member_id);

create index if not exists idx_enrollment_group_id
  on public.enrollment (group_id);

create index if not exists idx_enrollment_class_member
  on public.enrollment (class_id, member_id);

create index if not exists idx_class_entity_organization_id
  on public.class_entity (organization_id);

create index if not exists idx_class_entity_org_name
  on public.class_entity (organization_id, name);

-- Materialized aggregates for read-heavy summary workloads
create materialized view if not exists public.member_evaluation_summary_mv as
select
  e.member_id,
  count(*)::int as evaluation_count,
  max(e.evaluation_date) as last_evaluation_date,
  array_remove(array_agg(distinct e.instructor_person_id), null) as instructor_person_ids
from public.evaluation e
group by e.member_id;

create unique index if not exists idx_member_evaluation_summary_mv_member
  on public.member_evaluation_summary_mv (member_id);

create materialized view if not exists public.member_skill_summary_mv as
select
  ms.member_id,
  count(*)::int as total_skill_rows,
  sum(case when coalesce(ms.progress, 0) = 100 or ms.date_acquired is not null then 1 else 0 end)::int as mastered_skills,
  avg(coalesce(ms.progress, 0))::numeric(10,2) as avg_progress_percent
from public.member_skill ms
group by ms.member_id;

create unique index if not exists idx_member_skill_summary_mv_member
  on public.member_skill_summary_mv (member_id);

-- Refresh helper (run nightly from pg_cron or Supabase scheduled job)
create or replace function public.refresh_member_dashboard_aggregates()
returns void
language plpgsql
security definer
as $$
begin
  refresh materialized view concurrently public.member_evaluation_summary_mv;
  refresh materialized view concurrently public.member_skill_summary_mv;
end;
$$;

-- Example scheduling (enable in environments with pg_cron):
-- select cron.schedule(
--   'refresh-member-dashboard-aggregates-nightly',
--   '0 2 * * *',
--   $$select public.refresh_member_dashboard_aggregates();$$
-- );
