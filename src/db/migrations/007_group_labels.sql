-- Labels on regulation groups (e.g. Federal, State). Each workspace keeps its own list;
-- a group carries any number of them.
CREATE TABLE IF NOT EXISTS group_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  color TEXT NOT NULL DEFAULT 'slate',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS group_labels_name ON group_labels (company_id, lower(name));

ALTER TABLE regulation_groups ADD COLUMN IF NOT EXISTS labels TEXT[] NOT NULL DEFAULT '{}';

-- Every workspace starts with Federal and State
INSERT INTO group_labels (company_id, name, color)
SELECT c.id, l.name, l.color FROM companies c
CROSS JOIN (VALUES ('Federal', 'blue'), ('State', 'emerald')) AS l(name, color)
ON CONFLICT DO NOTHING;

ALTER TABLE group_labels ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user')
     AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'group_labels' AND policyname = 'group_labels_access') THEN
    CREATE POLICY group_labels_access ON group_labels FOR ALL TO app_user
      USING (company_id = current_setting('app.company_id', TRUE)::UUID);
  END IF;
END $$;
