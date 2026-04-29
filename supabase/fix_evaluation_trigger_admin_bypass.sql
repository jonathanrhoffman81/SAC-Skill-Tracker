DO $$
DECLARE
  v_func_name   text;
  v_func_schema text;
  v_sql         text;
BEGIN
  SELECT n.nspname, p.proname
    INTO v_func_schema, v_func_name
    FROM pg_trigger  t
    JOIN pg_proc     p ON p.oid = t.tgfoid
    JOIN pg_class    c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE t.tgname = 'evaluation_same_org'
   LIMIT 1;

  IF v_func_name IS NULL THEN
    RAISE EXCEPTION 'Could not find trigger evaluation_same_org';
  END IF;

  RAISE NOTICE 'Patching trigger function: %.%', v_func_schema, v_func_name;

  v_sql := format($func$
    CREATE OR REPLACE FUNCTION %I.%I()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $body$
    DECLARE
      v_class_org_id  uuid;
      v_is_admin      boolean := false;
    BEGIN
      -- Super-admins bypass unconditionally.
      SELECT EXISTS (
        SELECT 1
        FROM public.person_global_role pgl
        JOIN public.role r ON r.role_id = pgl.role_id
        WHERE pgl.person_id = NEW.instructor_person_id
          AND r.name IN ('super_admin', 'superadmin', 'super-admin')
      ) INTO v_is_admin;

      IF v_is_admin THEN RETURN NEW; END IF;

      -- Org-level admin bypass for this class's org.
      IF NEW.class_id IS NOT NULL THEN
        SELECT organization_id INTO v_class_org_id
        FROM public.class_entity
        WHERE class_id = NEW.class_id;

        SELECT EXISTS (
          SELECT 1
          FROM public.person_org_role  por
          JOIN public.person_organization po
            ON po.person_organization_id = por.person_organization_id
          JOIN public.role r ON r.role_id = por.role_id
          WHERE po.person_id       = NEW.instructor_person_id
            AND po.organization_id = v_class_org_id
            AND r.name IN ('admin', 'org_admin', 'org-admin')
        ) INTO v_is_admin;

        IF v_is_admin THEN RETURN NEW; END IF;
      END IF;

      -- Original check: instructor must be in group_instructor for this class.
      IF NEW.class_id IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1
          FROM public.group_instructor gi
          JOIN public.class_group      cg ON cg.group_id = gi.group_id
          WHERE gi.instructor_person_id = NEW.instructor_person_id
            AND cg.class_id             = NEW.class_id
        ) THEN
          RAISE EXCEPTION 'evaluation instructor must be assigned to a group for this class';
        END IF;
      END IF;

      RETURN NEW;
    END;
    $body$;
  $func$, v_func_schema, v_func_name);

  EXECUTE v_sql;

  RAISE NOTICE 'Done — %.% patched successfully.', v_func_schema, v_func_name;
END;
$$;
