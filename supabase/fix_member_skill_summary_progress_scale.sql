-- Rebuild member skill summary aggregate to support stored progress values of either:
-- 0/1/2/3/4 or 0/25/50/75/100

drop materialized view if exists public.member_skill_summary_mv;

create materialized view public.member_skill_summary_mv as
select
  ms.member_id,
  count(*)::int as total_skill_rows,
  sum(
    case
      when coalesce(ms.progress, 0) in (4, 100) or ms.date_acquired is not null then 1
      else 0
    end
  )::int as mastered_skills,
  avg(
    case
      when ms.progress in (0, 1, 2, 3, 4) then coalesce(ms.progress, 0) * 25
      else coalesce(ms.progress, 0)
    end
  )::numeric(10,2) as avg_progress_percent
from public.member_skill ms
group by ms.member_id;

create unique index if not exists idx_member_skill_summary_mv_member
  on public.member_skill_summary_mv (member_id);
