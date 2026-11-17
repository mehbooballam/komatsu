import { query } from "@/lib/db";

/**
 * Links alerts to the product inventory based on the "Product" text from the import file.
 *
 * - Each semicolon-separated label is matched (ignoring case, spacing and "&"/"and")
 *   against active product families, then products (name or model code), then aliases.
 * - "All product lines" (and similar) means every active family.
 * - Matches become *suggested* links (origin "import"); a person confirms or removes them.
 * - Nothing is ever created in the inventory. Labels with no match are reported so a
 *   person can create the family/product or tag the alert by hand.
 * - A link someone removed (rejected) or confirmed is never touched; suggestions that no
 *   longer match the alert's current text are withdrawn.
 */

export interface UnmatchedLabel {
  label: string;
  alerts: number;
}

export interface ProductMatchResult {
  /** New suggested links created */
  linked: number;
  /** Alerts that now have at least one product from the import text */
  alerts_matched: number;
  unmatched: UnmatchedLabel[];
}

type Target = { kind: "family" | "product"; id: string };

/** Lower-case, "&" → "and", punctuation and extra spaces removed. */
export function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const ALL_RE = /^all( (products?|product lines?|product families|families|lines))?$/;

/** Splits the raw product text into labels. */
export function splitProductLabels(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[;\n|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function loadCatalog(companyId: string) {
  const [families, products, aliases] = await Promise.all([
    query(`SELECT id, name FROM product_families WHERE company_id = $1 AND state = 'active'`, [companyId]),
    query(
      `SELECT p.id, p.name, p.model_code FROM products p
       JOIN product_families f ON f.id = p.family_id AND f.state = 'active'
       WHERE p.company_id = $1 AND p.is_active`,
      [companyId]
    ),
    query(
      `SELECT normalized_name, target_family_id, target_product_id FROM product_aliases WHERE company_id = $1`,
      [companyId]
    ),
  ]);

  const byName = new Map<string, Target>();
  // Lowest priority first so families win over products, products over aliases
  for (const a of aliases.rows) {
    const t: Target | null = a.target_family_id
      ? { kind: "family", id: a.target_family_id }
      : a.target_product_id
      ? { kind: "product", id: a.target_product_id }
      : null;
    if (t) byName.set(normalizeLabel(a.normalized_name), t);
  }
  for (const p of products.rows) {
    if (p.model_code) byName.set(normalizeLabel(p.model_code), { kind: "product", id: p.id });
    byName.set(normalizeLabel(p.name), { kind: "product", id: p.id });
  }
  for (const f of families.rows) byName.set(normalizeLabel(f.name), { kind: "family", id: f.id });

  const allFamilies: Target[] = families.rows.map((f) => ({ kind: "family", id: f.id }));
  return { byName, allFamilies };
}

/** Matches the given alerts (or every alert in the workspace when omitted). */
export async function matchImportedProducts(companyId: string, alertIds?: string[]): Promise<ProductMatchResult> {
  const alertsRes = await query(
    `SELECT id, product_raw FROM alerts
     WHERE company_id = $1 AND archived_at IS NULL ${alertIds ? "AND id = ANY($2::uuid[])" : ""}`,
    alertIds ? [companyId, alertIds] : [companyId]
  );
  const result: ProductMatchResult = { linked: 0, alerts_matched: 0, unmatched: [] };
  if (alertsRes.rows.length === 0) return result;

  const { byName, allFamilies } = await loadCatalog(companyId);
  const unmatched = new Map<string, { label: string; alerts: Set<string> }>();

  // Existing links for these alerts, so we never touch confirmed/rejected ones
  const ids = alertsRes.rows.map((a) => a.id);
  const existingRes = await query(
    `SELECT id, alert_id, family_id, product_id, state, origin FROM alert_product_links
     WHERE company_id = $1 AND alert_id = ANY($2::uuid[])`,
    [companyId, ids]
  );
  const existing = new Map<string, Array<(typeof existingRes.rows)[number]>>();
  for (const l of existingRes.rows) {
    if (!existing.has(l.alert_id)) existing.set(l.alert_id, []);
    existing.get(l.alert_id)!.push(l);
  }

  const toInsert: Array<{ alertId: string; t: Target; reason: string }> = [];
  const toWithdraw: string[] = [];

  for (const a of alertsRes.rows) {
    const wanted = new Map<string, { t: Target; reason: string }>();
    for (const label of splitProductLabels(a.product_raw)) {
      const norm = normalizeLabel(label);
      if (!norm) continue;
      if (ALL_RE.test(norm)) {
        for (const t of allFamilies) wanted.set(`${t.kind}:${t.id}`, { t, reason: `Import file: "${label}"` });
        continue;
      }
      const t = byName.get(norm);
      if (t) {
        wanted.set(`${t.kind}:${t.id}`, { t, reason: `Import file: "${label}"` });
      } else {
        if (!unmatched.has(norm)) unmatched.set(norm, { label, alerts: new Set() });
        unmatched.get(norm)!.alerts.add(a.id);
      }
    }

    const links = existing.get(a.id) || [];
    const keyOf = (l: { family_id: string | null; product_id: string | null }) =>
      l.product_id ? `product:${l.product_id}` : `family:${l.family_id}`;
    const have = new Set(links.map(keyOf));

    for (const [key, w] of wanted) if (!have.has(key)) toInsert.push({ alertId: a.id, t: w.t, reason: w.reason });
    // Import suggestions that the current text no longer supports
    for (const l of links) {
      if (l.origin === "import" && l.state === "suggested" && !wanted.has(keyOf(l))) toWithdraw.push(l.id);
    }
    if (wanted.size > 0) result.alerts_matched++;
  }

  if (toWithdraw.length) {
    await query(`DELETE FROM alert_product_links WHERE company_id = $1 AND id = ANY($2::uuid[])`, [companyId, toWithdraw]);
  }
  if (toInsert.length) {
    await query(
      `INSERT INTO alert_product_links (company_id, alert_id, family_id, product_id, state, origin, confidence, reason)
       SELECT $1, x.alert_id, x.family_id, x.product_id, 'suggested', 'import', 'exact', x.reason
       FROM unnest($2::uuid[], $3::uuid[], $4::uuid[], $5::text[]) AS x(alert_id, family_id, product_id, reason)`,
      [
        companyId,
        toInsert.map((r) => r.alertId),
        toInsert.map((r) => (r.t.kind === "family" ? r.t.id : null)),
        toInsert.map((r) => (r.t.kind === "product" ? r.t.id : null)),
        toInsert.map((r) => r.reason),
      ]
    );
    result.linked = toInsert.length;
  }

  result.unmatched = [...unmatched.values()]
    .map((u) => ({ label: u.label, alerts: u.alerts.size }))
    .sort((x, y) => y.alerts - x.alerts || x.label.localeCompare(y.label));
  return result;
}

/** Product names used in imported alerts that aren't in the inventory yet (for the Inventory page). */
export async function unmatchedProductLabels(companyId: string): Promise<UnmatchedLabel[]> {
  const [alertsRes, catalog] = await Promise.all([
    query(
      `SELECT id, product_raw FROM alerts WHERE company_id = $1 AND archived_at IS NULL AND product_raw IS NOT NULL AND product_raw <> ''`,
      [companyId]
    ),
    loadCatalog(companyId),
  ]);
  const unmatched = new Map<string, { label: string; alerts: Set<string> }>();
  for (const a of alertsRes.rows) {
    for (const label of splitProductLabels(a.product_raw)) {
      const norm = normalizeLabel(label);
      if (!norm || ALL_RE.test(norm) || catalog.byName.has(norm)) continue;
      if (!unmatched.has(norm)) unmatched.set(norm, { label, alerts: new Set() });
      unmatched.get(norm)!.alerts.add(a.id);
    }
  }
  return [...unmatched.values()]
    .map((u) => ({ label: u.label, alerts: u.alerts.size }))
    .sort((x, y) => y.alerts - x.alerts || x.label.localeCompare(y.label));
}
