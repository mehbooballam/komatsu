-- Products (whole families or individual models) attached to a regulation group.
-- Alerts filed in the group or any of its sub-groups inherit these products.
CREATE TABLE IF NOT EXISTS group_product_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  group_id UUID NOT NULL REFERENCES regulation_groups(id) ON DELETE CASCADE,
  family_id UUID REFERENCES product_families(id),
  product_id UUID REFERENCES products(id),
  created_by UUID REFERENCES memberships(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (family_id IS NOT NULL AND product_id IS NULL) OR
    (family_id IS NULL AND product_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS group_product_links_unique
  ON group_product_links (group_id, COALESCE(family_id, product_id));
CREATE INDEX IF NOT EXISTS group_product_links_company ON group_product_links (company_id);

-- Speeds up looking up an alert's product links
CREATE INDEX IF NOT EXISTS alert_product_links_alert ON alert_product_links (alert_id);

ALTER TABLE group_product_links ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user')
     AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'group_product_links' AND policyname = 'group_products_access') THEN
    CREATE POLICY group_products_access ON group_product_links FOR ALL TO app_user
      USING (company_id = current_setting('app.company_id', TRUE)::UUID);
  END IF;
END $$;
