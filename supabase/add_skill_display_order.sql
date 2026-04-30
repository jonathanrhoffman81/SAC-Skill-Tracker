-- Add display_order to skill table for admin-controlled ordering.
-- Run once in Supabase SQL editor.

ALTER TABLE skill ADD COLUMN IF NOT EXISTS display_order integer;

-- Seed existing skills with an order based on current alphabetical order
-- so nothing is null / breaks immediately after migration.
WITH ranked AS (
  SELECT skill_id, row_number() OVER (PARTITION BY organization_id ORDER BY name) AS rn
  FROM skill
)
UPDATE skill s
SET display_order = r.rn
FROM ranked r
WHERE s.skill_id = r.skill_id;
