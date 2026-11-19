-- Confidence for each scoring factor. The import brings it in per factor
-- (source_factor_ratings.confidence, e.g. "High" or "85%"); a person can set
-- their own value here, which wins over the imported one until it is removed.

CREATE TABLE IF NOT EXISTS alert_factor_confidence (
  company_id UUID NOT NULL REFERENCES companies(id),
  alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  factor_key TEXT NOT NULL CHECK (factor_key IN ('market_access', 'cost_to_implement', 'human_resources', 'urgency')),
  confidence TEXT NOT NULL,
  set_by UUID REFERENCES memberships(id) ON DELETE SET NULL,
  set_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (alert_id, factor_key)
);
