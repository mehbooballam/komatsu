import "dotenv/config";
import fs from "fs";
import path from "path";
import pg from "pg";

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://komatsu:komatsu_dev_2024@127.0.0.1:5432/komatsu_dev",
});

async function migrate() {
  const migrationsDir = path.join(__dirname, "../src/db/migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No migration files found.");
    return;
  }

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    const applied = await client.query("SELECT name FROM _migrations");
    const appliedSet = new Set(applied.rows.map((r) => r.name));

    // If no migrations recorded but tables already exist, mark initial migration as applied
    if (appliedSet.size === 0) {
      const tableCheck = await client.query(
        "SELECT 1 FROM information_schema.tables WHERE table_name = 'companies' AND table_schema = 'public'"
      );
      if (tableCheck.rows.length > 0) {
        console.log("  mark: 001_initial_schema.sql (tables already exist)");
        await client.query(
          "INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT DO NOTHING",
          ["001_initial_schema.sql"]
        );
        appliedSet.add("001_initial_schema.sql");
      }
    }

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`  skip: ${file} (already applied)`);
        continue;
      }
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      console.log(`  apply: ${file}`);
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
    }
    console.log("Migrations complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
