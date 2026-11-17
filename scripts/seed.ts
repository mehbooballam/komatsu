import pg from "pg";
import bcrypt from "bcryptjs";

import "dotenv/config";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://komatsu:komatsu_dev_2024@127.0.0.1:5432/komatsu_dev",
});

const SCORING_POLICY: object = {
  factors: {
    market_access: {
      allowed_values: [1, 3, 6, 9],
      boundaries: {
        "1": "USD 0 to under 100,000",
        "3": "USD 100,000 to 1,000,000",
        "6": "Over USD 1,000,000 through 5,000,000",
        "9": "Over USD 5,000,000",
      },
    },
    cost_to_implement: {
      allowed_values: [1, 3, 6, 9],
      boundaries: {
        "1": "USD 0 to under 25,000",
        "3": "USD 25,000 to 250,000",
        "6": "Over USD 250,000 through 1,000,000",
        "9": "Over USD 1,000,000",
      },
    },
    human_resources: {
      allowed_values: [1, 3, 6, 9],
      boundaries: {
        "1": "0 FTE",
        "3": "More than 0 through 5 FTE",
        "6": "More than 5 through 10 FTE",
        "9": "More than 10 FTE",
      },
      boundary_values: { exactly_5: 3 },
    },
    urgency: {
      allowed_values: [1, 3, 6, 9],
      boundaries: {
        "1": "More than 36 months",
        "3": "More than 18 through 36 months",
        "6": "More than 6 through 18 months",
        "9": "6 months or less, due today, or overdue",
      },
      boundary_values: { exactly_6_months: 9 },
    },
  },
  bands: {
    low: [1, 80],
    moderate: [81, 323],
    high: [324, 1295],
    critical: [1296, 6561],
  },
  escalations: [
    {
      condition: "market_access_9",
      minimum_band: "high",
      description: "Market access = 9 gives minimum High",
    },
    {
      condition: "urgency_9_and_market_access_gte_6",
      band: "critical",
      description: "Urgency = 9 and Market access >= 6 gives Critical",
    },
    {
      condition: "forecast_missed_deadline",
      band: "critical",
      description: "Forecast missed deadline gives Critical",
    },
  ],
  total_override_enabled: false,
  version: 1,
};

const GEOGRAPHIES = [
  { code: "US", iso_code: "US", display_name: "United States" },
  { code: "CA", iso_code: "CA", display_name: "Canada" },
  { code: "JP", iso_code: "JP", display_name: "Japan" },
  { code: "FR", iso_code: "FR", display_name: "France" },
  { code: "DE", iso_code: "DE", display_name: "Germany" },
  { code: "GB", iso_code: "GB", display_name: "United Kingdom" },
  { code: "CN", iso_code: "CN", display_name: "China" },
  { code: "AU", iso_code: "AU", display_name: "Australia" },
  { code: "BR", iso_code: "BR", display_name: "Brazil" },
  { code: "IN", iso_code: "IN", display_name: "India" },
  { code: "KR", iso_code: "KR", display_name: "South Korea" },
  { code: "MX", iso_code: "MX", display_name: "Mexico" },
];

const PRODUCT_FAMILIES = [
  "Earthmoving & Construction",
  "Mining & Quarrying",
  "Forestry & Logging",
  "Industrial Machinery & Presses",
];

export async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Idempotent cleanup
    const existing = await client.query(
      "SELECT id FROM companies WHERE slug = 'komatsu'"
    );
    if (existing.rows.length > 0) {
      const companyId = existing.rows[0].id;
      // Delete in dependency order
      await client.query("DELETE FROM alert_active_projections WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM score_assessments WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM source_factor_ratings WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM score_overrides WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM implementation_forecasts WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM alert_deadlines WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM alert_product_links WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM alert_geographies WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM alert_tags WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM alert_group_links WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM alert_topics WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM alert_scopes WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM alert_field_overrides WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM suggestions WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM review_runs WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM evidence_refs WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM assignment_events WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM assignment_rules WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM audit_events WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM jobs WHERE company_id = $1", [companyId]);
      // Null out current_source_revision_id before deleting revisions
      await client.query("UPDATE alerts SET current_source_revision_id = NULL WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM alert_source_revisions WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM import_rows WHERE batch_id IN (SELECT id FROM import_batches WHERE company_id = $1)", [companyId]);
      await client.query("DELETE FROM import_batches WHERE company_id = $1", [companyId]);
      await client.query("UPDATE alerts SET primary_group_id = NULL WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM alerts WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM regulation_groups WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM product_aliases WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM products WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM product_families WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM tag_labels WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM document_versions WHERE document_id IN (SELECT id FROM source_documents WHERE company_id = $1)", [companyId]);
      await client.query("DELETE FROM source_documents WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM feeds WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM invitations WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM team_memberships WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM teams WHERE company_id = $1", [companyId]);
      await client.query("UPDATE companies SET active_policy_id = NULL WHERE id = $1", [companyId]);
      await client.query("DELETE FROM scoring_policies WHERE company_id = $1", [companyId]);
      await client.query(
        "DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM memberships WHERE company_id = $1)",
        [companyId]
      );
      await client.query("DELETE FROM memberships WHERE company_id = $1", [companyId]);
      await client.query("DELETE FROM companies WHERE id = $1", [companyId]);
    }

    // Delete demo users if they exist
    for (const email of ["demo@komatsu.com", "owner@komatsu.com", "manager@komatsu.com"]) {
      await client.query("DELETE FROM sessions WHERE user_id IN (SELECT id FROM user_profiles WHERE LOWER(email) = $1)", [email]);
      await client.query("DELETE FROM user_profiles WHERE LOWER(email) = $1", [email]);
    }

    // Clean up geographies (idempotent)
    for (const geo of GEOGRAPHIES) {
      await client.query("DELETE FROM geographies WHERE code = $1", [geo.code]);
    }

    console.log("Cleaned up existing demo data.");

    // 1. Create company
    const companyRes = await client.query(
      `INSERT INTO companies (name, slug, time_zone, settings)
       VALUES ('Komatsu Ltd', 'komatsu', 'Asia/Tokyo', '{}')
       RETURNING id`,
    );
    const companyId = companyRes.rows[0].id;
    console.log(`Created company: ${companyId}`);

    // 2. Create demo admin user
    const adminHash = bcrypt.hashSync("Demo1234!", 12);
    const adminRes = await client.query(
      `INSERT INTO user_profiles (email, password_hash, display_name, verified_email)
       VALUES ('demo@komatsu.com', $1, 'Demo Admin', TRUE)
       RETURNING id`,
      [adminHash],
    );
    const adminUserId = adminRes.rows[0].id;

    const adminMemberRes = await client.query(
      `INSERT INTO memberships (company_id, user_id, role, access_scope, state)
       VALUES ($1, $2, 'company_admin', 'company', 'active')
       RETURNING id`,
      [companyId, adminUserId],
    );
    const adminMembershipId = adminMemberRes.rows[0].id;
    console.log(`Created admin user: ${adminUserId}, membership: ${adminMembershipId}`);

    // 3. Create risk owner user
    const ownerHash = bcrypt.hashSync("Owner1234!", 12);
    const ownerRes = await client.query(
      `INSERT INTO user_profiles (email, password_hash, display_name, verified_email)
       VALUES ('owner@komatsu.com', $1, 'Risk Owner', TRUE)
       RETURNING id`,
      [ownerHash],
    );
    const ownerUserId = ownerRes.rows[0].id;

    const ownerMemberRes = await client.query(
      `INSERT INTO memberships (company_id, user_id, role, access_scope, state)
       VALUES ($1, $2, 'risk_owner', 'assigned', 'active')
       RETURNING id`,
      [companyId, ownerUserId],
    );
    const ownerMembershipId = ownerMemberRes.rows[0].id;
    console.log(`Created risk owner: ${ownerUserId}, membership: ${ownerMembershipId}`);

    // 4. Create manager user
    const mgrHash = bcrypt.hashSync("Manager1234!", 12);
    const mgrRes = await client.query(
      `INSERT INTO user_profiles (email, password_hash, display_name, verified_email)
       VALUES ('manager@komatsu.com', $1, 'Import Manager', TRUE)
       RETURNING id`,
      [mgrHash],
    );
    const mgrUserId = mgrRes.rows[0].id;

    const mgrMemberRes = await client.query(
      `INSERT INTO memberships (company_id, user_id, role, access_scope, state)
       VALUES ($1, $2, 'manager', 'company', 'active')
       RETURNING id`,
      [companyId, mgrUserId],
    );
    const mgrMembershipId = mgrMemberRes.rows[0].id;
    console.log(`Created manager: ${mgrUserId}, membership: ${mgrMembershipId}`);

    // 5. Create team and add manager
    const teamRes = await client.query(
      `INSERT INTO teams (company_id, name) VALUES ($1, 'Global Compliance') RETURNING id`,
      [companyId],
    );
    const teamId = teamRes.rows[0].id;

    await client.query(
      `INSERT INTO team_memberships (company_id, team_id, membership_id)
       VALUES ($1, $2, $3)`,
      [companyId, teamId, mgrMembershipId],
    );
    console.log(`Created team: ${teamId}`);

    // 6. Create scoring policy
    const policyRes = await client.query(
      `INSERT INTO scoring_policies (company_id, version, effective_from, rules_json, created_by, published_at, is_active)
       VALUES ($1, 1, now(), $2, $3, now(), TRUE)
       RETURNING id`,
      [companyId, JSON.stringify(SCORING_POLICY), adminMembershipId],
    );
    const policyId = policyRes.rows[0].id;

    await client.query(
      `UPDATE companies SET active_policy_id = $1 WHERE id = $2`,
      [policyId, companyId],
    );
    console.log(`Created scoring policy: ${policyId}`);

    // 7. Create Daptic feed
    const feedRes = await client.query(
      `INSERT INTO feeds (company_id, provider_name, dataset_key, name)
       VALUES ($1, 'Daptic', 'daptic-default', 'Daptic Alert Feed')
       RETURNING id`,
      [companyId],
    );
    const feedId = feedRes.rows[0].id;
    console.log(`Created feed: ${feedId}`);

    // 8. Create geographies
    for (const geo of GEOGRAPHIES) {
      await client.query(
        `INSERT INTO geographies (code, iso_code, level, display_name)
         VALUES ($1, $2, 'country', $3)`,
        [geo.code, geo.iso_code, geo.display_name],
      );
    }
    console.log(`Created ${GEOGRAPHIES.length} geographies`);

    // 9. Create product families
    const familyIds: Record<string, string> = {};
    for (const name of PRODUCT_FAMILIES) {
      const res = await client.query(
        `INSERT INTO product_families (company_id, name, state)
         VALUES ($1, $2, 'active')
         RETURNING id`,
        [companyId, name],
      );
      familyIds[name] = res.rows[0].id;
    }
    console.log(`Created ${PRODUCT_FAMILIES.length} product families`);

    await client.query("COMMIT");

    console.log("\n=== Seed complete ===");
    console.log("Demo accounts:");
    console.log("  Admin:   demo@komatsu.com / Demo1234!");
    console.log("  Manager: manager@komatsu.com / Manager1234!");
    console.log("  Owner:   owner@komatsu.com / Owner1234!");
    console.log(`Company ID: ${companyId}`);
    console.log(`Feed ID:    ${feedId}`);
    console.log(`Policy ID:  ${policyId}`);

    return {
      companyId,
      adminUserId,
      adminMembershipId,
      ownerUserId,
      ownerMembershipId,
      mgrUserId,
      mgrMembershipId,
      teamId,
      policyId,
      feedId,
      familyIds,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Run directly
if (require.main === module || process.argv[1]?.endsWith("seed.ts")) {
  seed()
    .then(() => pool.end())
    .catch((err) => {
      console.error("Seed failed:", err);
      pool.end();
      process.exit(1);
    });
}

export { pool };
