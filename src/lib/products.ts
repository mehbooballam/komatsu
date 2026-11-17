import { query } from "@/lib/db";
import { loadGroupTree, type GroupNode } from "@/lib/groups";

/** A product reference: a whole family or one model. */
export interface ProductTarget {
  kind: "family" | "product";
  id: string;
}

/** A product as attached to an alert, either directly or through its group. */
export interface AttachedProduct {
  /** "family:<id>" or "product:<id>" */
  key: string;
  kind: "family" | "product";
  id: string;
  name: string;
  family_name: string | null;
  model_code: string | null;
  /** alert = attached to the alert itself; group = inherited from its group or a parent group */
  source: "alert" | "group";
  /** For alert links: confirmed (attached by a person) or suggested (from the import). */
  state?: string;
  origin?: string;
  group_id?: string;
  group_path?: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads `family_id` / `product_id` from a request body and checks it exists in
 * the company's inventory. Returns the target, or an error message.
 */
export async function resolveTarget(
  companyId: string,
  body: { family_id?: unknown; product_id?: unknown }
): Promise<ProductTarget | { error: string }> {
  const familyId = typeof body.family_id === "string" ? body.family_id : null;
  const productId = typeof body.product_id === "string" ? body.product_id : null;
  if (!!familyId === !!productId) return { error: "Choose one product family or one product" };
  const id = (familyId || productId)!;
  if (!UUID_RE.test(id)) return { error: "Product not found" };
  const res = familyId
    ? await query(`SELECT 1 FROM product_families WHERE id = $1 AND company_id = $2 AND state = 'active'`, [id, companyId])
    : await query(`SELECT 1 FROM products WHERE id = $1 AND company_id = $2 AND is_active`, [id, companyId]);
  if (res.rows.length === 0) return { error: "Product not found in the inventory" };
  return { kind: familyId ? "family" : "product", id };
}

type LinkRow = {
  family_id: string | null;
  product_id: string | null;
  family_name: string | null;
  product_name: string | null;
  product_family_name: string | null;
  model_code: string | null;
};

function toProduct(r: LinkRow): Pick<AttachedProduct, "key" | "kind" | "id" | "name" | "family_name" | "model_code"> {
  const kind = r.product_id ? "product" : "family";
  const id = (r.product_id || r.family_id)!;
  return {
    key: `${kind}:${id}`,
    kind,
    id,
    name: (r.product_id ? r.product_name : r.family_name) || "Unknown product",
    family_name: r.product_id ? r.product_family_name : r.family_name,
    model_code: r.model_code,
  };
}

const LINK_JOINS = `
  LEFT JOIN product_families pf ON pf.id = l.family_id AND pf.company_id = l.company_id
  LEFT JOIN products pr ON pr.id = l.product_id AND pr.company_id = l.company_id
  LEFT JOIN product_families ppf ON ppf.id = pr.family_id AND ppf.company_id = l.company_id`;
const LINK_COLS = `l.family_id, l.product_id, pf.name AS family_name, pr.name AS product_name,
  ppf.name AS product_family_name, pr.model_code`;

/** Products attached directly to each group (not including parents). */
export async function groupProducts(companyId: string, groupIds?: string[]) {
  const res = await query(
    `SELECT l.group_id, ${LINK_COLS}
     FROM group_product_links l ${LINK_JOINS}
     WHERE l.company_id = $1 ${groupIds ? "AND l.group_id = ANY($2::uuid[])" : ""}
     ORDER BY COALESCE(pr.name, pf.name)`,
    groupIds ? [companyId, groupIds] : [companyId]
  );
  const map = new Map<string, ReturnType<typeof toProduct>[]>();
  for (const r of res.rows) {
    if (!map.has(r.group_id)) map.set(r.group_id, []);
    map.get(r.group_id)!.push(toProduct(r));
  }
  return map;
}

/**
 * Every product that applies to each alert: those attached to the alert (not rejected)
 * plus those attached to its group or any parent group.
 */
export async function alertProducts(
  companyId: string,
  alertIds: string[],
  tree?: GroupNode[]
): Promise<Map<string, AttachedProduct[]>> {
  const out = new Map<string, AttachedProduct[]>(alertIds.map((id) => [id, []]));
  if (alertIds.length === 0) return out;

  const [direct, alerts] = await Promise.all([
    query(
      `SELECT l.alert_id, l.state, l.origin, ${LINK_COLS}
       FROM alert_product_links l ${LINK_JOINS}
       WHERE l.company_id = $1 AND l.alert_id = ANY($2::uuid[]) AND l.state <> 'rejected'
       ORDER BY COALESCE(pr.name, pf.name)`,
      [companyId, alertIds]
    ),
    query(`SELECT id, primary_group_id FROM alerts WHERE company_id = $1 AND id = ANY($2::uuid[])`, [companyId, alertIds]),
  ]);

  /*
   * Precedence when the same product comes from several places:
   *   1. attached to the alert by a person (confirmed)
   *   2. assigned to the alert's group or a parent group — automatically applies to every alert in it
   *   3. suggested by the import file (only shown when nothing above covers it)
   */
  const confirmed = direct.rows.filter((r) => r.state === "confirmed");
  const suggested = direct.rows.filter((r) => r.state !== "confirmed");

  for (const r of confirmed) {
    const list = out.get(r.alert_id)!;
    const p = toProduct(r);
    if (list.some((x) => x.key === p.key)) continue;
    list.push({ ...p, source: "alert", state: r.state, origin: r.origin });
  }

  const grouped = alerts.rows.filter((a) => a.primary_group_id);
  if (grouped.length) {
    const groups = tree || (await loadGroupTree(companyId));
    const byId = new Map(groups.map((g) => [g.id, g]));
    const gp = await groupProducts(companyId);
    for (const a of grouped) {
      const list = out.get(a.id)!;
      for (let g = byId.get(a.primary_group_id); g; g = g.parent_group_id ? byId.get(g.parent_group_id) : undefined) {
        for (const p of gp.get(g.id) || []) {
          if (list.some((x) => x.key === p.key)) continue;
          list.push({ ...p, source: "group", group_id: g.id, group_path: g.path });
        }
      }
    }
  }

  for (const r of suggested) {
    const list = out.get(r.alert_id)!;
    const p = toProduct(r);
    if (list.some((x) => x.key === p.key)) continue;
    list.push({ ...p, source: "alert", state: r.state, origin: r.origin });
  }
  return out;
}
