import "dotenv/config";

/**
 * Suggest inventory products on alerts that were imported before product matching existed
 * (or after the inventory changed). Never creates families/products; never touches links
 * a person confirmed or removed. Safe to run repeatedly.
 */
async function main() {
  const { query } = await import("../src/lib/db");
  const { matchImportedProducts } = await import("../src/lib/import/product-matching");
  const companies = await query("SELECT id, name FROM companies");
  for (const c of companies.rows) {
    const res = await matchImportedProducts(c.id);
    console.log(`${c.name}: ${res.alerts_matched} alerts matched, ${res.linked} new suggestions`);
    for (const u of res.unmatched) console.log(`  not in inventory: "${u.label}" (${u.alerts} alerts)`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Product matching failed:", err);
  process.exit(1);
});
