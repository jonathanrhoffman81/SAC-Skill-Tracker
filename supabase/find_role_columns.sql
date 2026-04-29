SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('person_org_role', 'person_global_role', 'person_organization')
ORDER BY table_name, ordinal_position;
