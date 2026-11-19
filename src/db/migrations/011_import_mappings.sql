-- Saved column mappings for import files. A file whose headers match a saved
-- mapping (same set of columns) gets it applied automatically on upload.

CREATE TABLE IF NOT EXISTS import_mapping_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  -- File headers in file order, and a hash of the sorted, normalised set
  headers JSONB NOT NULL DEFAULT '[]',
  signature TEXT NOT NULL,
  -- { "<file header>": "<import column>" | null }  (null = do not import)
  mapping JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES memberships(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES memberships(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_mapping_signature ON import_mapping_profiles (company_id, signature);

-- Every header in the uploaded file, in file order (JSONB objects do not keep key order)
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS file_headers JSONB;
-- Saved mapping applied to this batch, if any
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS mapping_profile_id UUID REFERENCES import_mapping_profiles(id) ON DELETE SET NULL;
