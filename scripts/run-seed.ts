import pg from "pg";
import { seed } from "./seed";
import { seedAlerts } from "./seed-alerts";
import { generateFixtures } from "./generate-fixtures";
import { generateCorrection } from "./generate-correction";

async function main() {
  console.log("====================================");
  console.log("Komatsu Regulatory Risk Dashboard");
  console.log("Full Seed & Fixture Generation");
  console.log("====================================\n");

  try {
    // Step 1: Seed base data
    console.log("Step 1/4: Seeding base data (users, company, policy, geographies, products)...\n");
    const seedResult = await seed();
    console.log("");

    // Step 2: Seed alerts with scoring
    console.log("Step 2/4: Seeding alerts with scoring...\n");
    await seedAlerts();
    console.log("");

    // Step 3: Generate fixture files
    console.log("Step 3/4: Generating fixture files (xlsx, csv, templates)...\n");
    generateFixtures();
    console.log("");

    // Step 4: Generate correction file
    console.log("Step 4/4: Generating correction CSV...\n");
    generateCorrection();
    console.log("");

    console.log("====================================");
    console.log("All done!");
    console.log("====================================");
    console.log("\nDemo accounts:");
    console.log("  Admin:   demo@komatsu.com / Demo1234!");
    console.log("  Manager: manager@komatsu.com / Manager1234!");
    console.log("  Owner:   owner@komatsu.com / Owner1234!");
    console.log("\nGenerated files in templates/:");
    console.log("  demo_alerts.xlsx       - 7 test alerts (Excel)");
    console.log("  demo_alerts.csv        - 7 test alerts (CSV)");
    console.log("  demo_correction.csv    - DEMO-005 update");
    console.log("  blank_template.xlsx    - Empty import template (Excel)");
    console.log("  blank_template.csv     - Empty import template (CSV)");
  } catch (err) {
    console.error("\nSeed failed:", err);
    process.exit(1);
  }

  // Close all pool connections
  const pool = new pg.Pool({
    connectionString: "postgresql://komatsu:komatsu_dev_2024@127.0.0.1:5432/komatsu_dev",
  });
  await pool.end().catch(() => {});
  process.exit(0);
}

main();
