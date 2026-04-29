SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name ILIKE '%role%'
ORDER BY table_name, ordinal_position;
