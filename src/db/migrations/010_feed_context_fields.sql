-- Extra text columns from the Daptic feed (summary/details per topic, key dates, user category).
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS category_user_defined TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS key_dates TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS date_relevance TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS status_summary TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS status_details TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS timing_summary TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS timing_details TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS change_summary TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS change_details TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS source_context TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS source_context_summary TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS source_context_details TEXT;
