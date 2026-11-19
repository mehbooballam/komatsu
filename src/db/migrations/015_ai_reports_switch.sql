-- Separate on/off switch for writing the monthly report with AI (Settings › AI).
-- "enabled" stays the switch for AI grouping. Reports default to on, as before this switch existed.
ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS reports_enabled BOOLEAN NOT NULL DEFAULT true;
