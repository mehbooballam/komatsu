-- Monthly leadership risk reports (one per workspace per month).
-- The written sections live in `content` (JSON, validated by the API);
-- `snapshot` holds the alert figures captured from the system for that month.
CREATE TABLE IF NOT EXISTS risk_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  period DATE NOT NULL CHECK (EXTRACT(DAY FROM period) = 1),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  snapshot JSONB,
  snapshot_at TIMESTAMPTZ,
  created_by UUID REFERENCES memberships(id),
  updated_by UUID REFERENCES memberships(id),
  published_by UUID REFERENCES memberships(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  UNIQUE (company_id, period)
);

CREATE INDEX IF NOT EXISTS risk_reports_company_period ON risk_reports (company_id, period DESC);

ALTER TABLE risk_reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user')
     AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'risk_reports' AND policyname = 'risk_reports_access') THEN
    CREATE POLICY risk_reports_access ON risk_reports FOR ALL TO app_user
      USING (company_id = current_setting('app.company_id', TRUE)::UUID);
  END IF;
END $$;
