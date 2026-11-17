import "dotenv/config";

/** Re-score every active alert in every company (run after scoring-rule changes). */
async function main() {
  const { query } = await import("../src/lib/db");
  const { recalculateCompanyAlerts, getAsOfDate } = await import("../src/lib/scoring/recalculate");
  const companies = await query("SELECT id, name, time_zone FROM companies");
  for (const c of companies.rows) {
    const res = await recalculateCompanyAlerts(c.id, getAsOfDate(c.time_zone || "UTC"), "manual_recalc");
    console.log(`${c.name}: ${res.recalculated} alerts recalculated, ${res.changed} updated`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Recalculation failed:", err);
  process.exit(1);
});
