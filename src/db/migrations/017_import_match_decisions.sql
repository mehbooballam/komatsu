-- Alert uniqueness by content: what a person decided for a row that matches another alert,
-- and the match percentage from which a decision is asked for (per import).
ALTER TABLE import_rows ADD COLUMN IF NOT EXISTS decision TEXT CHECK (decision IN ('replace', 'ignore', 'add'));
-- 'alert:<uuid>' (an existing alert) or 'row:<number>' (another row of the same file)
ALTER TABLE import_rows ADD COLUMN IF NOT EXISTS decision_target TEXT;
ALTER TABLE import_rows ADD COLUMN IF NOT EXISTS decision_score SMALLINT;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS match_threshold SMALLINT NOT NULL DEFAULT 70
  CHECK (match_threshold BETWEEN 40 AND 100);
-- Earlier decisions are looked up by the alert ID in the file
CREATE INDEX IF NOT EXISTS idx_import_rows_decided ON import_rows (external_alert_id) WHERE decision IS NOT NULL;
