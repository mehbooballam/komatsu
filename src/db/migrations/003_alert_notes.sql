-- Notes written on an alert, shown as a comment thread.
-- private = only the author sees it; team = everyone in the workspace sees it.
CREATE TABLE IF NOT EXISTS alert_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  author_membership_id UUID NOT NULL REFERENCES memberships(id),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'team')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS alert_notes_alert ON alert_notes (alert_id, created_at DESC);

ALTER TABLE alert_notes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user')
     AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'alert_notes' AND policyname = 'alert_notes_access') THEN
    CREATE POLICY alert_notes_access ON alert_notes FOR ALL TO app_user
      USING (company_id = current_setting('app.company_id', TRUE)::UUID);
  END IF;
END $$;
