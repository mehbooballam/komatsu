import "dotenv/config";
import { seed, pool, ADMIN_EMAIL, ADMIN_PASSWORD } from "./seed";

async function main() {
  console.log("====================================");
  console.log("Komatsu Regulatory Risk Dashboard");
  console.log("Base data setup (no sample alerts)");
  console.log("====================================\n");

  try {
    const result = await seed();
    console.log("\nDone.");
    if (result.created) {
      console.log("\nAdmin login:");
      console.log(`  ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
      console.log("  (set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD to choose your own; change it after first login)");
    }
    console.log("\nNext: sign in and use Imports to upload your alerts (.xlsx or .csv).");
  } catch (err) {
    console.error("\nSeed failed:", err);
    await pool.end().catch(() => {});
    process.exit(1);
  }

  await pool.end().catch(() => {});
  process.exit(0);
}

main();
