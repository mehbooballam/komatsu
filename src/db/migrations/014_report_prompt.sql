-- Instructions (prompt) for writing the monthly report with AI, editable in Settings › AI.
ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS report_prompt TEXT;
