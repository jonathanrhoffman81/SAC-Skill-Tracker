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
      coalesce(m.level, 'Unassigned level') as level
    from linked_members lm
    join member m on m.member_id = lm.member_id
  ),
  member_next_session as (
    select distinct on (e.member_id)
      e.member_id,
      ce.name || ': ' || coalesce(ce.schedule, 'Schedule TBD') as next_session
    from enrollment e
    join class_entity ce on ce.class_id = e.class_id
    join member_base mb on mb.member_id = e.member_id
    order by e.member_id, ce.name, ce.class_id
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
          'level', mb.level,
          'nextSession', coalesce(mns.next_session, 'No upcoming session'),
          'classIds', coalesce(to_jsonb(mci.class_ids), '[]'::jsonb)
        )
        order by mb.name asc
      ),
      '[]'::jsonb
    ) as swimmers
    from member_base mb
    left join member_next_session mns on mns.member_id = mb.member_id
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
      ms.member_id,
      jsonb_agg(
        jsonb_build_object(
          'id', ms.skill_id,
          'name', coalesce(s.name, 'Unknown skill'),
          'progress', coalesce(ms.progress, case when ms.date_acquired is not null then 100 else 0 end),
          'mastered', (
            coalesce(ms.progress, case when ms.date_acquired is not null then 100 else 0 end) = 100
            or ms.date_acquired is not null
          ),
          'dateAcquired', case
            when ms.date_acquired is null then null
            else to_char(ms.date_acquired, 'Mon FMDD, YYYY')
          end,
          'notes', coalesce(sng.notes, '[]'::jsonb)
        )
        order by coalesce(ms.progress, case when ms.date_acquired is not null then 100 else 0 end) desc, s.name asc
      ) as skills
    from member_skill ms
    left join skill s on s.skill_id = ms.skill_id
    left join skill_notes_grouped sng on sng.member_id = ms.member_id and sng.skill_id = ms.skill_id
    join member_base mb on mb.member_id = ms.member_id
    group by ms.member_id
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
