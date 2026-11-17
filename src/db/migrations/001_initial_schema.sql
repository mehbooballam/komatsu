-- Komatsu Regulatory Risk Dashboard - Initial Schema
-- PostgreSQL 16+ with Row-Level Security

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Application role
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END $$;
GRANT CONNECT ON DATABASE komatsu_dev TO app_user;

-- ============================================================
-- COMPANIES
-- ============================================================
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  time_zone TEXT NOT NULL DEFAULT 'UTC',
  active_policy_id UUID,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_companies_slug ON companies(slug);

-- ============================================================
-- USER PROFILES
-- ============================================================
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_subject TEXT UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  display_name TEXT NOT NULL,
  verified_email BOOLEAN NOT NULL DEFAULT FALSE,
  email_verification_token TEXT,
  email_verification_expires TIMESTAMPTZ,
  password_reset_token TEXT,
  password_reset_expires TIMESTAMPTZ,
  preferences JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_user_profiles_email ON user_profiles(LOWER(email));

-- ============================================================
-- MEMBERSHIPS
-- ============================================================
CREATE TYPE membership_role AS ENUM ('company_admin', 'manager', 'reviewer', 'risk_owner');
CREATE TYPE membership_state AS ENUM ('active', 'suspended', 'revoked');
CREATE TYPE access_scope_type AS ENUM ('company', 'team', 'assigned');

CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  user_id UUID NOT NULL REFERENCES user_profiles(id),
  role membership_role NOT NULL,
  access_scope access_scope_type NOT NULL DEFAULT 'company',
  state membership_state NOT NULL DEFAULT 'active',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  UNIQUE(company_id, user_id)
);

CREATE INDEX idx_memberships_company ON memberships(company_id);
CREATE INDEX idx_memberships_user ON memberships(user_id);

-- ============================================================
-- TEAMS & TEAM MEMBERSHIPS
-- ============================================================
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  UNIQUE(company_id, name)
);

CREATE TABLE team_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  team_id UUID NOT NULL REFERENCES teams(id),
  membership_id UUID NOT NULL REFERENCES memberships(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(team_id, membership_id)
);

-- ============================================================
-- INVITATIONS
-- ============================================================
CREATE TYPE invitation_state AS ENUM ('pending', 'accepted', 'revoked', 'expired');

CREATE TABLE invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  email TEXT NOT NULL,
  role membership_role NOT NULL,
  scope access_scope_type NOT NULL DEFAULT 'company',
  team_ids UUID[] DEFAULT '{}',
  invited_by UUID NOT NULL REFERENCES memberships(id),
  token_hash TEXT NOT NULL UNIQUE,
  state invitation_state NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- FEEDS
-- ============================================================
CREATE TABLE feeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  provider_name TEXT NOT NULL DEFAULT 'Daptic',
  dataset_key TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  UNIQUE(company_id, dataset_key)
);

-- ============================================================
-- IMPORT BATCHES & ROWS
-- ============================================================
CREATE TYPE import_status AS ENUM ('uploading', 'validating', 'previewing', 'confirmed', 'processing', 'completed', 'failed', 'cancelled');
CREATE TYPE import_row_state AS ENUM ('valid', 'invalid', 'skipped', 'created', 'updated', 'unchanged', 'conflict');

CREATE TABLE import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  feed_id UUID NOT NULL REFERENCES feeds(id),
  uploader_membership_id UUID NOT NULL REFERENCES memberships(id),
  input_format TEXT NOT NULL CHECK (input_format IN ('xlsx', 'csv')),
  original_filename TEXT NOT NULL,
  selected_worksheet TEXT,
  header_row INT NOT NULL DEFAULT 1,
  column_mapping JSONB NOT NULL DEFAULT '{}',
  update_mode TEXT NOT NULL DEFAULT 'preserve' CHECK (update_mode IN ('preserve', 'replace')),
  report_date DATE,
  object_key TEXT,
  digest TEXT,
  idempotency_key TEXT NOT NULL,
  status import_status NOT NULL DEFAULT 'uploading',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  row_counts JSONB NOT NULL DEFAULT '{}',
  error_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, feed_id, idempotency_key)
);

CREATE TABLE import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES import_batches(id),
  row_number INT NOT NULL,
  external_alert_id TEXT,
  row_hash TEXT,
  raw_payload JSONB NOT NULL,
  validation JSONB,
  state import_row_state NOT NULL DEFAULT 'valid',
  alert_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(batch_id, row_number)
);

-- ============================================================
-- SCORING POLICIES
-- ============================================================
CREATE TABLE scoring_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  version INT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  rules_json JSONB NOT NULL,
  created_by UUID REFERENCES memberships(id),
  published_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, version)
);

ALTER TABLE companies ADD CONSTRAINT fk_active_policy
  FOREIGN KEY (active_policy_id) REFERENCES scoring_policies(id);

-- ============================================================
-- GEOGRAPHIES
-- ============================================================
CREATE TABLE geographies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  iso_code TEXT,
  level TEXT NOT NULL CHECK (level IN ('country', 'subdivision', 'region', 'other')),
  display_name TEXT NOT NULL,
  parent_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- REGULATION GROUPS
-- ============================================================
CREATE TABLE regulation_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  parent_group_id UUID REFERENCES regulation_groups(id),
  title TEXT NOT NULL,
  jurisdiction_ref TEXT,
  issuer TEXT,
  rule_identifiers JSONB DEFAULT '[]',
  description TEXT,
  owner_membership_id UUID REFERENCES memberships(id),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'draft', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- ALERTS
-- ============================================================
CREATE TYPE provider_review_state AS ENUM ('recommend_include', 'recommend_exclude', 'unreviewed');
CREATE TYPE local_state AS ENUM ('new', 'in_review', 'acknowledged', 'not_relevant', 'archived');

CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  feed_id UUID NOT NULL REFERENCES feeds(id),
  external_alert_id TEXT NOT NULL,
  current_source_revision_id UUID,
  title TEXT NOT NULL,
  overview TEXT,
  summary TEXT,
  relevance TEXT,
  published_on DATE,
  stage TEXT,
  recommendation TEXT,
  change_type TEXT,
  timing_raw TEXT,
  product_raw TEXT,
  jurisdiction_raw TEXT,
  agency_name TEXT,
  source_name TEXT,
  source_url TEXT,
  topic_match TEXT,
  provider_review_state provider_review_state NOT NULL DEFAULT 'unreviewed',
  local_state local_state NOT NULL DEFAULT 'new',
  primary_group_id UUID REFERENCES regulation_groups(id),
  direct_owner_membership_id UUID REFERENCES memberships(id),
  record_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  UNIQUE(company_id, feed_id, external_alert_id)
);

CREATE INDEX idx_alerts_company ON alerts(company_id);
CREATE INDEX idx_alerts_external_id ON alerts(company_id, external_alert_id);
CREATE INDEX idx_alerts_stage ON alerts(company_id, stage);
CREATE INDEX idx_alerts_owner ON alerts(direct_owner_membership_id);
CREATE INDEX idx_alerts_group ON alerts(primary_group_id);

-- ============================================================
-- ALERT SOURCE REVISIONS
-- ============================================================
CREATE TABLE alert_source_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  alert_id UUID NOT NULL REFERENCES alerts(id),
  import_row_id UUID REFERENCES import_rows(id),
  version_number INT NOT NULL,
  row_hash TEXT,
  source_payload JSONB NOT NULL,
  effective_source_fields JSONB NOT NULL DEFAULT '{}',
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(alert_id, version_number)
);

ALTER TABLE alerts ADD CONSTRAINT fk_current_source_revision
  FOREIGN KEY (current_source_revision_id) REFERENCES alert_source_revisions(id);

-- ============================================================
-- ALERT FIELD OVERRIDES
-- ============================================================
CREATE TABLE alert_field_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  alert_id UUID NOT NULL REFERENCES alerts(id),
  field_key TEXT NOT NULL,
  value JSONB,
  reason TEXT,
  evidence_id UUID,
  created_by UUID REFERENCES memberships(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX idx_field_overrides_active ON alert_field_overrides(alert_id, field_key) WHERE ended_at IS NULL;

-- ============================================================
-- ALERT SCOPES
-- ============================================================
CREATE TABLE alert_scopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  alert_id UUID NOT NULL REFERENCES alerts(id),
  team_id UUID REFERENCES teams(id),
  membership_id UUID REFERENCES memberships(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by UUID REFERENCES memberships(id),
  revoked_at TIMESTAMPTZ,
  CHECK (
    (team_id IS NOT NULL AND membership_id IS NULL) OR
    (team_id IS NULL AND membership_id IS NOT NULL)
  )
);

-- ============================================================
-- ALERT DEADLINES
-- ============================================================
CREATE TYPE deadline_kind AS ENUM ('compliance', 'comment', 'effective', 'internal', 'proposed', 'unknown');
CREATE TYPE verification_state AS ENUM ('unverified', 'verified', 'rejected', 'superseded');
CREATE TYPE lifecycle_state AS ENUM ('outstanding', 'completed', 'withdrawn', 'superseded');

CREATE TABLE alert_deadlines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  alert_id UUID NOT NULL REFERENCES alerts(id),
  kind deadline_kind NOT NULL DEFAULT 'unknown',
  date_value DATE NOT NULL,
  applies_to TEXT,
  verification_state verification_state NOT NULL DEFAULT 'unverified',
  lifecycle_state lifecycle_state NOT NULL DEFAULT 'outstanding',
  origin TEXT,
  evidence_id UUID,
  confirmed_by UUID REFERENCES memberships(id),
  confirmed_at TIMESTAMPTZ,
  supersedes_id UUID REFERENCES alert_deadlines(id),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deadlines_alert ON alert_deadlines(alert_id);

-- ============================================================
-- IMPLEMENTATION FORECASTS
-- ============================================================
CREATE TABLE implementation_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  alert_id UUID NOT NULL REFERENCES alerts(id),
  deadline_id UUID REFERENCES alert_deadlines(id),
  remaining_days INT CHECK (remaining_days >= 0),
  estimated_finish_date DATE,
  as_of_date DATE NOT NULL,
  evidence_id UUID,
  reason TEXT,
  set_by UUID REFERENCES memberships(id),
  status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current', 'superseded', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- SOURCE FACTOR RATINGS
-- ============================================================
CREATE TABLE source_factor_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  alert_source_revision_id UUID NOT NULL REFERENCES alert_source_revisions(id),
  factor_key TEXT NOT NULL CHECK (factor_key IN ('market_access', 'cost_to_implement', 'human_resources', 'urgency')),
  original_value TEXT,
  parsed_value SMALLINT CHECK (parsed_value IN (1, 3, 6, 9)),
  rationale TEXT,
  confidence TEXT,
  evidence_id UUID,
  UNIQUE(alert_source_revision_id, factor_key)
);

-- ============================================================
-- SCORE OVERRIDES
-- ============================================================
CREATE TABLE score_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  alert_id UUID NOT NULL REFERENCES alerts(id),
  target TEXT NOT NULL CHECK (target IN ('market_access', 'cost_to_implement', 'human_resources', 'urgency', 'total')),
  value SMALLINT NOT NULL,
  reason TEXT NOT NULL,
  evidence_id UUID,
  created_by UUID REFERENCES memberships(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);

CREATE INDEX idx_score_overrides_active ON score_overrides(alert_id, target) WHERE ended_at IS NULL;

-- ============================================================
-- SCORE ASSESSMENTS
-- ============================================================
CREATE TABLE score_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  alert_id UUID NOT NULL REFERENCES alerts(id),
  policy_id UUID REFERENCES scoring_policies(id),
  source_revision_id UUID REFERENCES alert_source_revisions(id),
  selected_deadline_id UUID REFERENCES alert_deadlines(id),
  forecast_id UUID REFERENCES implementation_forecasts(id),
  as_of_date DATE NOT NULL,
  days_remaining INT,
  margin_days INT,
  factor_market_access SMALLINT,
  factor_cost_to_implement SMALLINT,
  factor_human_resources SMALLINT,
  factor_urgency SMALLINT,
  effective_market_access SMALLINT,
  effective_cost_to_implement SMALLINT,
  effective_human_resources SMALLINT,
  effective_urgency SMALLINT,
  raw_total INT,
  raw_band TEXT,
  effective_total INT,
  base_band TEXT,
  effective_band TEXT,
  escalation_reasons JSONB DEFAULT '[]',
  review_flags JSONB DEFAULT '[]',
  input_signature TEXT,
  calculation_trigger TEXT NOT NULL DEFAULT 'import',
  is_latest BOOLEAN NOT NULL DEFAULT TRUE,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_assessments_alert_latest ON score_assessments(alert_id) WHERE is_latest = TRUE;
CREATE INDEX idx_assessments_company ON score_assessments(company_id, alert_id);

-- ============================================================
-- ALERT TOPICS
-- ============================================================
CREATE TABLE alert_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  alert_id UUID NOT NULL REFERENCES alerts(id),
  normalized_key TEXT NOT NULL,
  source_label TEXT,
  UNIQUE(alert_id, normalized_key)
);

-- ============================================================
-- TAG LABELS & ALERT TAGS
-- ============================================================
CREATE TABLE tag_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  color TEXT DEFAULT '#6b7280',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, normalized_name)
);

CREATE TABLE alert_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  alert_id UUID NOT NULL REFERENCES alerts(id),
  tag_id UUID NOT NULL REFERENCES tag_labels(id),
  origin TEXT DEFAULT 'local',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(alert_id, tag_id)
);

-- ============================================================
-- ALERT GROUP LINKS
-- ============================================================
CREATE TABLE alert_group_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  alert_id UUID NOT NULL REFERENCES alerts(id),
  group_id UUID NOT NULL REFERENCES regulation_groups(id),
  relationship TEXT NOT NULL DEFAULT 'related' CHECK (relationship IN ('primary', 'related')),
  evidence_id UUID,
  confirmed_by UUID REFERENCES memberships(id),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(alert_id, group_id)
);

-- ============================================================
-- ALERT GEOGRAPHIES
-- ============================================================
CREATE TABLE alert_geographies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  alert_id UUID NOT NULL REFERENCES alerts(id),
  geography_id UUID NOT NULL REFERENCES geographies(id),
  state TEXT NOT NULL DEFAULT 'mapped' CHECK (state IN ('mapped', 'confirmed', 'rejected')),
  source_evidence TEXT,
  confirmed_by UUID REFERENCES memberships(id),
  confirmed_at TIMESTAMPTZ,
  UNIQUE(alert_id, geography_id)
);

-- ============================================================
-- ASSIGNMENT RULES & EVENTS
-- ============================================================
CREATE TABLE assignment_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  matcher JSONB NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('group', 'membership')),
  target_id UUID NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'suggest' CHECK (mode IN ('auto', 'suggest')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE assignment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  alert_id UUID REFERENCES alerts(id),
  group_id UUID REFERENCES regulation_groups(id),
  before_owner_id UUID,
  after_owner_id UUID,
  origin TEXT NOT NULL CHECK (origin IN ('direct', 'group', 'rule', 'system')),
  cause TEXT,
  actor_membership_id UUID REFERENCES memberships(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- PRODUCT FAMILIES, PRODUCTS & ALIASES
-- ============================================================
CREATE TABLE product_families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  description TEXT,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, name)
);

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  family_id UUID NOT NULL REFERENCES product_families(id),
  model_code TEXT,
  name TEXT NOT NULL,
  description TEXT,
  region_hints JSONB DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, model_code)
);

CREATE TABLE product_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  normalized_name TEXT NOT NULL,
  target_family_id UUID REFERENCES product_families(id),
  target_product_id UUID REFERENCES products(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- ALERT PRODUCT LINKS
-- ============================================================
CREATE TABLE alert_product_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  alert_id UUID NOT NULL REFERENCES alerts(id),
  family_id UUID REFERENCES product_families(id),
  product_id UUID REFERENCES products(id),
  state TEXT NOT NULL DEFAULT 'suggested' CHECK (state IN ('suggested', 'confirmed', 'rejected')),
  origin TEXT NOT NULL DEFAULT 'import',
  evidence_id UUID,
  confidence TEXT,
  reason TEXT,
  confirmed_by UUID REFERENCES memberships(id),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (family_id IS NOT NULL AND product_id IS NULL) OR
    (family_id IS NULL AND product_id IS NOT NULL)
  )
);

-- ============================================================
-- SOURCE DOCUMENTS & VERSIONS
-- ============================================================
CREATE TABLE source_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  source_url TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'web' CHECK (source_type IN ('web', 'official', 'industry', 'internal')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES source_documents(id),
  final_url TEXT,
  content_hash TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  response_status INT,
  object_key TEXT,
  extraction_state TEXT DEFAULT 'pending'
);

-- ============================================================
-- EVIDENCE REFS
-- ============================================================
CREATE TABLE evidence_refs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  document_version_id UUID REFERENCES document_versions(id),
  import_row_id UUID REFERENCES import_rows(id),
  citation TEXT,
  page_section TEXT,
  excerpt TEXT,
  extraction_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- REVIEW RUNS & SUGGESTIONS
-- ============================================================
CREATE TYPE review_type AS ENUM ('source_review', 'regulation_match', 'product_suggest');
CREATE TYPE review_status AS ENUM ('queued', 'running', 'completed', 'failed', 'blocked', 'inaccessible');
CREATE TYPE suggestion_status AS ENUM ('pending', 'confirmed', 'rejected', 'superseded');

CREATE TABLE review_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  alert_id UUID NOT NULL REFERENCES alerts(id),
  type review_type NOT NULL,
  status review_status NOT NULL DEFAULT 'queued',
  input_versions JSONB,
  job_id UUID,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  worker TEXT,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  review_run_id UUID REFERENCES review_runs(id),
  candidate_type TEXT NOT NULL,
  candidate_id TEXT,
  structured_value JSONB,
  evidence_id UUID REFERENCES evidence_refs(id),
  rationale TEXT,
  confidence TEXT,
  status suggestion_status NOT NULL DEFAULT 'pending',
  reviewer_membership_id UUID REFERENCES memberships(id),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- JOBS
-- ============================================================
CREATE TYPE job_state AS ENUM ('scheduled', 'queued', 'running', 'completed', 'failed', 'cancelled');

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  kind TEXT NOT NULL,
  reference_id UUID,
  idempotency_key TEXT,
  scheduled_for TIMESTAMPTZ,
  lease_expires TIMESTAMPTZ,
  attempt_count INT NOT NULL DEFAULT 0,
  state job_state NOT NULL DEFAULT 'scheduled',
  error_code TEXT,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_jobs_queued ON jobs(state, scheduled_for) WHERE state IN ('scheduled', 'queued');

-- ============================================================
-- AUDIT EVENTS
-- ============================================================
CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  event_id TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::TEXT,
  actor_membership_id UUID REFERENCES memberships(id),
  actor_system TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_id TEXT,
  job_id UUID,
  before_values JSONB,
  after_values JSONB,
  reason TEXT,
  context JSONB
);

CREATE INDEX idx_audit_company_time ON audit_events(company_id, occurred_at DESC);
CREATE INDEX idx_audit_entity ON audit_events(entity_type, entity_id);

-- ============================================================
-- ALERT ACTIVE PROJECTIONS (materialized view equivalent)
-- ============================================================
CREATE TABLE alert_active_projections (
  company_id UUID NOT NULL REFERENCES companies(id),
  alert_id UUID NOT NULL REFERENCES alerts(id) UNIQUE,
  latest_assessment_id UUID REFERENCES score_assessments(id),
  next_compliance_deadline DATE,
  days_remaining INT,
  effective_priority TEXT,
  effective_total INT,
  effective_owner_id UUID REFERENCES memberships(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  version INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, alert_id)
);

CREATE INDEX idx_projections_priority ON alert_active_projections(company_id, effective_priority);
CREATE INDEX idx_projections_owner ON alert_active_projections(effective_owner_id);
CREATE INDEX idx_projections_deadline ON alert_active_projections(company_id, next_compliance_deadline);

-- ============================================================
-- SESSIONS TABLE (for auth)
-- ============================================================
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id),
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ============================================================
-- FULL-TEXT SEARCH
-- ============================================================
CREATE INDEX idx_alerts_fts ON alerts USING GIN (
  to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(overview, '') || ' ' || COALESCE(summary, '') || ' ' || COALESCE(relevance, '') || ' ' || COALESCE(external_alert_id, ''))
);

-- ============================================================
-- ROW-LEVEL SECURITY
-- ============================================================
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_source_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulation_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_active_projections ENABLE ROW LEVEL SECURITY;

-- Default-deny for app_user
CREATE POLICY companies_access ON companies FOR ALL TO app_user
  USING (id = current_setting('app.company_id', TRUE)::UUID);

CREATE POLICY memberships_access ON memberships FOR ALL TO app_user
  USING (company_id = current_setting('app.company_id', TRUE)::UUID);

CREATE POLICY teams_access ON teams FOR ALL TO app_user
  USING (company_id = current_setting('app.company_id', TRUE)::UUID);

CREATE POLICY alerts_access ON alerts FOR ALL TO app_user
  USING (company_id = current_setting('app.company_id', TRUE)::UUID);

CREATE POLICY revisions_access ON alert_source_revisions FOR ALL TO app_user
  USING (company_id = current_setting('app.company_id', TRUE)::UUID);

CREATE POLICY batches_access ON import_batches FOR ALL TO app_user
  USING (company_id = current_setting('app.company_id', TRUE)::UUID);

CREATE POLICY rows_access ON import_rows FOR ALL TO app_user
  USING (batch_id IN (SELECT id FROM import_batches WHERE company_id = current_setting('app.company_id', TRUE)::UUID));

CREATE POLICY assessments_access ON score_assessments FOR ALL TO app_user
  USING (company_id = current_setting('app.company_id', TRUE)::UUID);

CREATE POLICY audit_access ON audit_events FOR ALL TO app_user
  USING (company_id = current_setting('app.company_id', TRUE)::UUID);

CREATE POLICY groups_access ON regulation_groups FOR ALL TO app_user
  USING (company_id = current_setting('app.company_id', TRUE)::UUID);

CREATE POLICY projections_access ON alert_active_projections FOR ALL TO app_user
  USING (company_id = current_setting('app.company_id', TRUE)::UUID);
