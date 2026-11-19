-- "Need Human Review" column from the import feed.
-- human_review_required is the live flag shown in the app; a person clears it
-- (with a comment) once they have checked the alert. human_review_source keeps
-- the value the feed last sent, so a re-import only flags again when the feed
-- changes its mind, not every time the same row comes back.

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS human_review_required BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS human_review_source BOOLEAN;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS human_review_reason TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS human_review_flagged_at TIMESTAMPTZ;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS human_review_flagged_by UUID REFERENCES memberships(id) ON DELETE SET NULL;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS human_review_cleared_at TIMESTAMPTZ;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS human_review_cleared_by UUID REFERENCES memberships(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_alerts_human_review
  ON alerts (company_id) WHERE human_review_required AND archived_at IS NULL;
