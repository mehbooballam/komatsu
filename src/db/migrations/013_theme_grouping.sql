-- Regulatory themes: an alert's theme is its first Daptic topic (as in the regulation risk scorer).
-- Alerts that no regulation group was found for (by the rules or by AI) can be grouped by theme.

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS theme TEXT;
UPDATE alerts SET theme = NULLIF(trim(split_part(replace(COALESCE(topic_match, ''), ';', '|'), '|', 1)), '')
WHERE theme IS NULL;
CREATE INDEX IF NOT EXISTS alerts_theme ON alerts (company_id, theme);

-- After AI grouping, place the alerts it could not group into their theme group
ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS theme_fallback BOOLEAN NOT NULL DEFAULT TRUE;

-- New grouping method: placed in a theme group as a fallback
DO $$
DECLARE c TEXT;
BEGIN
  SELECT conname INTO c FROM pg_constraint
  WHERE conrelid = 'alerts'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%grouping_method%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE alerts DROP CONSTRAINT %I', c); END IF;
END $$;
ALTER TABLE alerts ADD CONSTRAINT alerts_grouping_method_check
  CHECK (grouping_method IN ('exact', 'strong', 'similarity', 'manual', 'ai', 'theme'));

-- Theme groups carry a "Theme" label
INSERT INTO group_labels (company_id, name, color)
SELECT c.id, 'Theme', 'violet' FROM companies c
ON CONFLICT DO NOTHING;
