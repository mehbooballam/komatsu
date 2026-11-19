-- AI-assisted regulatory grouping: provider settings (API key encrypted), saved prompt,
-- grouping runs (proposal reviewed before it is applied), and source page details.

CREATE TABLE IF NOT EXISTS ai_settings (
  company_id UUID PRIMARY KEY REFERENCES companies(id),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  provider TEXT NOT NULL DEFAULT 'anthropic' CHECK (provider IN ('anthropic', 'openai', 'gemini', 'openai_compatible')),
  model TEXT,
  base_url TEXT,
  -- AES-256-GCM: iv:tag:ciphertext (base64); never returned to the browser
  api_key_encrypted TEXT,
  api_key_last4 TEXT,
  effort TEXT NOT NULL DEFAULT 'high' CHECK (effort IN ('low', 'medium', 'high', 'xhigh', 'max')),
  grouping_prompt TEXT,
  read_source_pages BOOLEAN NOT NULL DEFAULT TRUE,
  -- After each import: off | review (proposal waits for a person) | apply (applied automatically)
  after_import TEXT NOT NULL DEFAULT 'off' CHECK (after_import IN ('off', 'review', 'apply')),
  -- Placements at or above this confidence count as reviewed; below it they wait in Needs review
  auto_accept_confidence SMALLINT NOT NULL DEFAULT 90,
  -- Below this confidence the alert is not placed at all
  min_confidence SMALLINT NOT NULL DEFAULT 60,
  updated_by UUID REFERENCES memberships(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_grouping_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'proposed', 'applied', 'failed', 'discarded')),
  -- review = stop at the proposal; apply = apply as soon as it is ready
  mode TEXT NOT NULL DEFAULT 'review' CHECK (mode IN ('review', 'apply')),
  scope TEXT NOT NULL DEFAULT 'ungrouped' CHECK (scope IN ('ungrouped', 'all_automatic')),
  trigger TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'import')),
  provider TEXT,
  model TEXT,
  progress JSONB NOT NULL DEFAULT '{}',
  proposal JSONB,
  result JSONB,
  usage JSONB NOT NULL DEFAULT '{}',
  error TEXT,
  created_by UUID REFERENCES memberships(id) ON DELETE SET NULL,
  applied_by UUID REFERENCES memberships(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ai_grouping_runs_company ON ai_grouping_runs (company_id, created_at DESC);

-- Title / description read from the alert's source link (helps name the regulation)
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS source_page_title TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS source_page_description TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS source_page_fetched_at TIMESTAMPTZ;

-- New grouping method: placed by the AI grouping run
DO $$
DECLARE c TEXT;
BEGIN
  SELECT conname INTO c FROM pg_constraint
  WHERE conrelid = 'alerts'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%grouping_method%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE alerts DROP CONSTRAINT %I', c); END IF;
END $$;
ALTER TABLE alerts ADD CONSTRAINT alerts_grouping_method_check
  CHECK (grouping_method IN ('exact', 'strong', 'similarity', 'manual', 'ai'));
