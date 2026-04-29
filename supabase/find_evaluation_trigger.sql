SELECT t.tgname AS trigger_name, p.proname AS function_name, n.nspname AS function_schema
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE c.relname = 'evaluation'
  AND NOT t.tgisinternal;
