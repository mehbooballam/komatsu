import { getClient } from "@/lib/db";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Deleting inventory is for admins and managers. */
export function canDeleteInventory(role: string) {
  return role === "company_admin" || role === "manager";
}

/**
 * Permanently deletes products (and, when given, whole families with all their models),
 * removing them from every alert and group they were attached to.
 * Returns how many alert links were removed.
 */
export async function deleteInventory(
  companyId: string,
  opts: { familyIds?: string[]; productIds?: string[] }
): Promise<{ products: number; alertLinks: number }> {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const familyIds = opts.familyIds || [];
    // Models of the families being deleted go too
    const prod = await client.query(
      `SELECT id FROM products WHERE company_id = $1 AND (id = ANY($2::uuid[]) OR family_id = ANY($3::uuid[]))`,
      [companyId, opts.productIds || [], familyIds]
    );
    const productIds = prod.rows.map((r) => r.id);

    const links = await client.query(
      `DELETE FROM alert_product_links
       WHERE company_id = $1 AND (product_id = ANY($2::uuid[]) OR family_id = ANY($3::uuid[]))`,
      [companyId, productIds, familyIds]
    );
    await client.query(
      `DELETE FROM group_product_links
       WHERE company_id = $1 AND (product_id = ANY($2::uuid[]) OR family_id = ANY($3::uuid[]))`,
      [companyId, productIds, familyIds]
    );
    await client.query(
      `DELETE FROM product_aliases
       WHERE company_id = $1 AND (target_product_id = ANY($2::uuid[]) OR target_family_id = ANY($3::uuid[]))`,
      [companyId, productIds, familyIds]
    );
    await client.query(`DELETE FROM products WHERE company_id = $1 AND id = ANY($2::uuid[])`, [companyId, productIds]);
    if (familyIds.length) {
      await client.query(`DELETE FROM product_families WHERE company_id = $1 AND id = ANY($2::uuid[])`, [companyId, familyIds]);
    }
    await client.query("COMMIT");
    return { products: productIds.length, alertLinks: links.rowCount ?? 0 };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
