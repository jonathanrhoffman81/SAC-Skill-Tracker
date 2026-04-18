drop view if exists public.member_skill_current;

create view public.member_skill_current as
select distinct on (ms.member_id, ms.skill_id)
  ms.member_id,
  ms.skill_id,
  ms.progress,
  ms.date_acquired,
  ms.updated_by_person_id,
  ms.updated_at,
  ms.member_skill_id,
  ms.evaluation_id
from public.member_skill ms
order by
  ms.member_id,
  ms.skill_id,
  ms.updated_at desc,
  ms.member_skill_id desc;

create or replace function public.get_parent_dashboard(p_email text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with target_person as (
    select
      p.person_id,
      p.email,
      trim(concat_ws(' ', p.first_name, p.last_name)) as display_name
    from person p
    where p.email ilike p_email
    limit 1
  ),
  person_org as (
    select o.name
    from target_person tp
    left join person_organization po on po.person_id = tp.person_id
    left join organization o on o.organization_id = po.organization_id
    order by po.joined_at nulls last
    limit 1
  ),
  linked_members as (
    select gm.member_id
    from target_person tp
    join guardian_member gm on gm.guardian_person_id = tp.person_id

    union

    select pm.member_id
    from target_person tp
    join person_member pm on pm.person_id = tp.person_id
  ),
  member_base as (
    select
      m.member_id,
      trim(concat_ws(' ', m.first_name, m.last_name)) as name,
      m.is_active
    from linked_members lm
    join member m on m.member_id = lm.member_id
  ),
  member_class_candidates as (
    select
      e.member_id,
      ce.class_id,
      ce.name,
      ce.start_date,
      ce.end_date,
      coalesce(
        nullif(ce.schedule, ''),
        nullif(
          trim(
            concat_ws(
              ' ',
              nullif(array_to_string(ce.schedule_days, '/'), ''),
              nullif(ce.schedule_time, '')
            )
          ),
          ''
        ),
        'Schedule TBD'
      ) as schedule_label
    from enrollment e
    join class_entity ce on ce.class_id = e.class_id
    join member_base mb on mb.member_id = e.member_id
  ),
  member_next_class as (
    select distinct on (mcc.member_id)
      mcc.member_id,
      mcc.name || ': ' || mcc.schedule_label as next_class
    from member_class_candidates mcc
    order by
      mcc.member_id,
      case
        when mcc.start_date is not null
          and mcc.end_date is not null
          and current_date between mcc.start_date and mcc.end_date
          then 0
        when mcc.start_date is not null
          and mcc.start_date > current_date
          then 1
        when mcc.end_date is not null
          and mcc.end_date < current_date
          then 2
        else 3
      end,
      case
        when mcc.start_date is not null
          and mcc.start_date > current_date
          then mcc.start_date
      end asc nulls last,
      mcc.end_date desc nulls last,
      mcc.start_date desc nulls last,
      mcc.name asc,
      mcc.class_id
  ),
  member_class_ids as (
    select
      e.member_id,
      array_agg(e.class_id::text order by e.class_id) as class_ids
    from enrollment e
    join member_base mb on mb.member_id = e.member_id
    group by e.member_id
  ),
  swimmers_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', mb.member_id,
          'name', mb.name,
          'nextClass', coalesce(mnc.next_class, 'No class enrollment'),
          'classIds', coalesce(to_jsonb(mci.class_ids), '[]'::jsonb),
          'isActive', mb.is_active
        )
        order by mb.is_active desc, mb.name asc
      ),
      '[]'::jsonb
    ) as swimmers
    from member_base mb
    left join member_next_class mnc on mnc.member_id = mb.member_id
    left join member_class_ids mci on mci.member_id = mb.member_id
  ),
  skill_notes_grouped as (
    select
      e.member_id,
      e.skill_id,
      jsonb_agg(
        jsonb_build_object(
          'id', e.evaluation_id,
          'author', coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), 'Instructor'),
          'content', coalesce(e.feedback, ''),
          'date', to_char(e.evaluation_date, 'Mon FMDD, YYYY')
        )
        order by e.evaluation_date desc
      ) as notes
    from evaluation e
    left join person p on p.person_id = e.instructor_person_id
    join member_base mb on mb.member_id = e.member_id
    where e.skill_id is not null
    group by e.member_id, e.skill_id
  ),
  skills_grouped as (
    select
      msc.member_id,
      jsonb_agg(
        jsonb_build_object(
          'id', msc.skill_id,
          'name', coalesce(s.name, 'Unknown skill'),
          'progress', msc.progress,
          'mastered', (
            msc.progress = 4
            or msc.date_acquired is not null
          ),
          'dateAcquired', case
            when msc.date_acquired is null then null
            else to_char(msc.date_acquired, 'Mon FMDD, YYYY')
          end,
          'notes', coalesce(sng.notes, '[]'::jsonb)
        )
        order by msc.progress desc, s.name asc
      ) as skills
    from member_skill_current msc
    left join skill s on s.skill_id = msc.skill_id
    left join skill_notes_grouped sng
      on sng.member_id = msc.member_id
      and sng.skill_id = msc.skill_id
    join member_base mb on mb.member_id = msc.member_id
    group by msc.member_id
  ),
  skills_by_swimmer_json as (
    select coalesce(
      jsonb_object_agg(
        mb.member_id,
        coalesce(sg.skills, '[]'::jsonb)
      ),
      '{}'::jsonb
    ) as skills_by_swimmer
    from member_base mb
    left join skills_grouped sg on sg.member_id = mb.member_id
  )
  select jsonb_build_object(
    'userName', coalesce(nullif(tp.display_name, ''), tp.email),
    'organizationName', coalesce(po.name, 'SAC Skill Tracker'),
    'swimmers', sj.swimmers,
    'skillsBySwimmer', sbj.skills_by_swimmer
  )
  from target_person tp
  left join person_org po on true
  cross join swimmers_json sj
  cross join skills_by_swimmer_json sbj;
$$;
