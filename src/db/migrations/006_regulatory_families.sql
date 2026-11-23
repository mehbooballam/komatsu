-- Regulatory family grouping: Family (level 1) › Action (level 2) › Version (the alert itself).
-- One risk = one regulatory family, however many proposals, amendments or final rules it has.

-- Groups: what level they are and their stable key (e.g. US-EPA-AIM_ACT, US-EPA-AIM_ACT-ALLOCATIONS)
ALTER TABLE regulation_groups ADD COLUMN IF NOT EXISTS level TEXT CHECK (level IN ('family', 'action'));
ALTER TABLE regulation_groups ADD COLUMN IF NOT EXISTS group_key TEXT;
ALTER TABLE regulation_groups ADD COLUMN IF NOT EXISTS auto_created BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS regulation_groups_key
  ON regulation_groups (company_id, group_key) WHERE group_key IS NOT NULL AND state <> 'archived';

-- Alerts: the version type and how the alert came to be in its group
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS version_type TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS grouping_method TEXT
  CHECK (grouping_method IN ('exact', 'strong', 'similarity', 'manual'));
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS grouping_confidence SMALLINT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS grouping_basis TEXT;
-- Similarity groupings wait for a person to confirm them
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS grouping_reviewed BOOLEAN NOT NULL DEFAULT FALSE;

-- Public identifiers found on an alert (RIN, docket, bill number, agency tracking number, CFR part …)
CREATE TABLE IF NOT EXISTS alert_identifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('rin', 'docket', 'bill', 'tracking', 'wto', 'cfr')),
  value TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'extracted' CHECK (source IN ('extracted', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (alert_id, kind, value)
);
CREATE INDEX IF NOT EXISTS alert_identifiers_lookup ON alert_identifiers (company_id, kind, value);

ALTER TABLE alert_identifiers ENABLE ROW LEVEL SECURITY;

-- Notes: a change made by a person (or by the system) is recorded as a note with the action taken
ALTER TABLE alert_notes ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'change'));
ALTER TABLE alert_notes ADD COLUMN IF NOT EXISTS action TEXT;
ALTER TABLE alert_notes ALTER COLUMN author_membership_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user')
     AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'alert_identifiers' AND policyname = 'alert_identifiers_access') THEN
    CREATE POLICY alert_identifiers_access ON alert_identifiers FOR ALL TO app_user
      USING (company_id = current_setting('app.company_id', TRUE)::UUID);
  END IF;
END $$;
