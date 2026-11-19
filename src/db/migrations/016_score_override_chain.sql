-- Score adjustments can be undone one step at a time, back to the imported value.
-- Each adjustment points at the adjustment it replaced (NULL = it replaced the imported value).
ALTER TABLE score_overrides ADD COLUMN IF NOT EXISTS replaces_override_id UUID REFERENCES score_overrides(id);

-- Adjustments made before this column existed: a new adjustment ended the previous one for the
-- same factor in the same request, so the previous one ended within seconds of the new one starting.
-- A previous adjustment that was cleared earlier (ended long before) is not linked: the value
-- in between was the imported one.
UPDATE score_overrides so
SET replaces_override_id = (
  SELECT p.id FROM score_overrides p
  WHERE p.alert_id = so.alert_id AND p.company_id = so.company_id AND p.target = so.target AND p.id <> so.id
    AND p.created_at < so.created_at
    AND p.ended_at BETWEEN so.created_at - INTERVAL '5 seconds' AND so.created_at + INTERVAL '5 seconds'
  ORDER BY p.created_at DESC
  LIMIT 1
)
WHERE so.replaces_override_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_score_overrides_history ON score_overrides (alert_id, target, ended_at DESC);
