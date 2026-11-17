import pg from "pg";
import bcrypt from "bcryptjs";
import { allCountries } from "../src/lib/geo/countries";
import { DEFAULT_POLICY } from "../src/lib/scoring/policy";

import "dotenv/config";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://komatsu:komatsu_dev_2024@127.0.0.1:5432/komatsu_dev",
});

// Market access × Cost to implement × Urgency (1–729); see src/lib/scoring/policy.ts
const SCORING_POLICY = DEFAULT_POLICY;


const PRODUCT_FAMILIES = [
  "Earthmoving & Construction",
  "Mining & Quarrying",
  "Forestry & Logging",
  "Industrial Machinery & Presses",
];

// The first admin login. Override with env vars; change the password after first login.
const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL || "admin@komatsu.com").toLowerCase();
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "Admin1234!";
const ADMIN_NAME = process.env.SEED_ADMIN_NAME || "Administrator";

/**
 * Base setup for a clean database: company, admin login, scoring policy, feed,
 * the full ISO country list and product families. No sample alerts.
 *
 * Safe to re-run: if the company already exists, nothing is deleted — only
 * missing countries are added.
 */
export async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Countries (always upserted, so the map can resolve every country)
    const countries = allCountries();
    for (const c of countries) {
      await client.query(
        `INSERT INTO geographies (code, iso_code, level, display_name)
         VALUES ($1, $2, 'country', $3)
         ON CONFLICT (code) DO UPDATE SET iso_code = EXCLUDED.iso_code, display_name = EXCLUDED.display_name`,
        [c.code, c.iso_code, c.display_name],
      );
    }
    console.log(`Geographies: ${countries.length} countries`);

    const existing = await client.query("SELECT id FROM companies WHERE slug = 'komatsu'");
    if (existing.rows.length > 0) {
      await client.query("COMMIT");
      console.log("Company already set up — existing data left untouched.");
      return { companyId: existing.rows[0].id as string, created: false };
    }

    // 1. Company
    const companyRes = await client.query(
      `INSERT INTO companies (name, slug, time_zone, settings)
       VALUES ('Komatsu Ltd', 'komatsu', 'Asia/Tokyo', '{}')
       RETURNING id`,
    );
    const companyId = companyRes.rows[0].id;
    console.log(`Created company: ${companyId}`);

    // 2. Admin user (reuse the profile if the email already exists)
    const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 12);
    const adminRes = await client.query(
      `INSERT INTO user_profiles (email, password_hash, display_name, verified_email)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [ADMIN_EMAIL, adminHash, ADMIN_NAME],
    );
    const adminUserId = adminRes.rows[0].id;

    const adminMemberRes = await client.query(
      `INSERT INTO memberships (company_id, user_id, role, access_scope, state)
       VALUES ($1, $2, 'company_admin', 'company', 'active')
       RETURNING id`,
      [companyId, adminUserId],
    );
    const adminMembershipId = adminMemberRes.rows[0].id;
    console.log(`Created admin: ${ADMIN_EMAIL}`);

    // 3. Scoring policy
    const policyRes = await client.query(
      `INSERT INTO scoring_policies (company_id, version, effective_from, rules_json, created_by, published_at, is_active)
       VALUES ($1, 1, now(), $2, $3, now(), TRUE)
       RETURNING id`,
      [companyId, JSON.stringify(SCORING_POLICY), adminMembershipId],
    );
    const policyId = policyRes.rows[0].id;
    await client.query(`UPDATE companies SET active_policy_id = $1 WHERE id = $2`, [policyId, companyId]);
    console.log(`Created scoring policy: ${policyId}`);

    // 4. Alert feed (imports attach to this)
    await client.query(
      `INSERT INTO feeds (company_id, provider_name, dataset_key, name)
       VALUES ($1, 'Daptic', 'daptic-default', 'Daptic Alert Feed')`,
      [companyId],
    );

    // 5. Product families
    for (const name of PRODUCT_FAMILIES) {
      await client.query(
        `INSERT INTO product_families (company_id, name, state) VALUES ($1, $2, 'active')`,
        [companyId, name],
      );
    }
    console.log(`Created ${PRODUCT_FAMILIES.length} product families`);

    await client.query("COMMIT");
    return { companyId, created: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export { ADMIN_EMAIL, ADMIN_PASSWORD };

// Run directly
if (require.main === module || process.argv[1]?.split(/[\\/]/).pop() === "seed.ts") {
  seed()
    .then(() => pool.end())
    .catch((err) => {
      console.error("Seed failed:", err);
      pool.end();
      process.exit(1);
    });
}

export { pool };
