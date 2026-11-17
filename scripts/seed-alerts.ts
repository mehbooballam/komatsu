import pg from "pg";
import crypto from "crypto";

const pool = new pg.Pool({
  connectionString: "postgresql://komatsu:komatsu_dev_2024@127.0.0.1:5432/komatsu_dev",
});

const AS_OF_DATE = "2026-11-17";

interface AlertFixture {
  external_alert_id: string;
  title: string;
  overview: string;
  summary: string;
  status: string;
  jurisdiction_raw: string;
  deadline_date: string | null;
  deadline_description: string;
  product_raw: string;
  factors: { market_access: number | null; cost_to_implement: number | null; human_resources: number | null; urgency: number | null };
  overall_impact_score: number;
  timing: string;
  source_url: string;
  source_name: string;
  topic_match: string;
  category: string;
  published_on: string;
}

const ALERTS: AlertFixture[] = [
  {
    external_alert_id: "DEMO-001",
    title: "Early product signal",
    overview: "Early product signal",
    summary: "Synthetic test data, for the dashboard demo.",
    status: "Signal or Information",
    jurisdiction_raw: "CIRS Group",
    deadline_date: "2027-01-01",
    deadline_description: "",
    product_raw: "All product lines",
    factors: { market_access: null, cost_to_implement: null, human_resources: null, urgency: null },
    overall_impact_score: 0,
    timing: "No firm date",
    source_url: "",
    source_name: "",
    topic_match: "",
    category: "RECOMMEND_INCLUDE",
    published_on: "2026-11-16",
  },
  {
    external_alert_id: "DEMO-002",
    title: "Battery enclosure requirements",
    overview: "Battery enclosure requirements",
    summary: "Synthetic test data, for the dashboard demo.",
    status: "Final (mandatory)",
    jurisdiction_raw: "United States",
    deadline_date: "2026-12-17",
    deadline_description: "First compliance deadline",
    product_raw: "Earthmoving & Construction; Mining & Quarrying",
    factors: { market_access: 6, cost_to_implement: 1, human_resources: 1, urgency: 3 },
    overall_impact_score: 18,
    timing: "",
    source_url: "https://example.invalid/notice/battery-enclosure-2026",
    source_name: "Federal Register",
    topic_match: "Product safety | Certification",
    category: "RECOMMEND_INCLUDE",
    published_on: "2026-11-16",
  },
  {
    external_alert_id: "DEMO-003",
    title: "Battery enclosure requirements",
    overview: "Battery enclosure requirements",
    summary: "Synthetic test data, for the dashboard demo.\nWith a comma, and a line break.",
    status: "Final (mandatory)",
    jurisdiction_raw: "Canada",
    deadline_date: "2029-01-01",
    deadline_description: "Compliance deadline",
    product_raw: "Forestry & Logging",
    factors: { market_access: 3, cost_to_implement: 3, human_resources: 3, urgency: 3 },
    overall_impact_score: 81,
    timing: "",
    source_url: "",
    source_name: "",
    topic_match: "",
    category: "RECOMMEND_INCLUDE",
    published_on: "2026-11-16",
  },
  {
    external_alert_id: "DEMO-004",
    title: "Long range documentation update",
    overview: "Long range documentation update",
    summary: "Synthetic test data, for the dashboard demo.",
    status: "Final (mandatory)",
    jurisdiction_raw: "Japan",
    deadline_date: "2030-12-01",
    deadline_description: "Compliance deadline",
    product_raw: "Industrial Machinery & Presses",
    factors: { market_access: 1, cost_to_implement: 1, human_resources: 1, urgency: 1 },
    overall_impact_score: 1,
    timing: "",
    source_url: "",
    source_name: "",
    topic_match: "",
    category: "RECOMMEND_INCLUDE",
    published_on: "2026-11-16",
  },
  {
    external_alert_id: "DEMO-005",
    title: "Machinery testing update",
    overview: "Machinery testing update",
    summary: "Synthetic test data, for the dashboard demo.",
    status: "Final (mandatory)",
    jurisdiction_raw: "Canada",
    deadline_date: "2029-01-01",
    deadline_description: "Compliance deadline",
    product_raw: "Mining & Quarrying",
    factors: { market_access: 6, cost_to_implement: 6, human_resources: 3, urgency: 3 },
    overall_impact_score: 324,
    timing: "",
    source_url: "",
    source_name: "",
    topic_match: "",
    category: "RECOMMEND_INCLUDE",
    published_on: "2026-11-16",
  },
  {
    external_alert_id: "DEMO-006",
    title: "Industry note on enclosure rule",
    overview: "Industry note on enclosure rule",
    summary: "Synthetic test data, for the dashboard demo.",
    status: "Signal or Information",
    jurisdiction_raw: "Industry newsletter",
    deadline_date: null,
    deadline_description: "",
    product_raw: "",
    factors: { market_access: null, cost_to_implement: null, human_resources: null, urgency: null },
    overall_impact_score: 0,
    timing: "",
    source_url: "https://example.invalid/industry-news/enclosure-rule-update",
    source_name: "Industry Safety Weekly",
    topic_match: "",
    category: "RECOMMEND_INCLUDE",
    published_on: "2026-11-16",
  },
  {
    external_alert_id: "DEMO-007",
    title: "Consultation on machinery labelling",
    overview: "Consultation on machinery labelling",
    summary: "Synthetic test data, for the dashboard demo.",
    status: "Consultation open",
    jurisdiction_raw: "France",
    deadline_date: "2026-12-18",
    deadline_description: "Public comment deadline",
    product_raw: "All product lines",
    factors: { market_access: 9, cost_to_implement: 6, human_resources: 1, urgency: 3 },
    overall_impact_score: 162,
    timing: "No firm date",
    source_url: "",
    source_name: "",
    topic_match: "",
    category: "RECOMMEND_INCLUDE",
    published_on: "2026-11-16",
  },
];

function computeBand(total: number): string {
  if (total <= 80) return "low";
  if (total <= 323) return "moderate";
  if (total <= 1295) return "high";
  return "critical";
}

const BAND_ORDER: Record<string, number> = { low: 0, moderate: 1, high: 2, critical: 3 };

function higherBand(a: string, b: string): string {
  return (BAND_ORDER[a] ?? 0) >= (BAND_ORDER[b] ?? 0) ? a : b;
}

function computeUrgencyFromDeadline(deadlineDate: string, asOf: string): number {
  const dl = new Date(deadlineDate + "T00:00:00Z");
  const now = new Date(asOf + "T00:00:00Z");

  const diffMs = dl.getTime() - now.getTime();
  if (diffMs <= 0) return 9; // overdue or due today

  // Calendar month calculation
  let months = (dl.getUTCFullYear() - now.getUTCFullYear()) * 12 + (dl.getUTCMonth() - now.getUTCMonth());
  // Adjust if the day hasn't been reached yet in the target month
  if (dl.getUTCDate() < now.getUTCDate()) {
    months -= 1;
  }

  if (months <= 6) return 9;
  if (months <= 18) return 6;
  if (months <= 36) return 3;
  return 1;
}

function computeDaysRemaining(deadlineDate: string, asOf: string): number {
  const dl = new Date(deadlineDate + "T00:00:00Z");
  const now = new Date(asOf + "T00:00:00Z");
  return Math.round((dl.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export async function seedAlerts() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Get company data
    const companyRes = await client.query(
      "SELECT c.id, c.active_policy_id, f.id as feed_id FROM companies c JOIN feeds f ON f.company_id = c.id WHERE c.slug = 'komatsu' LIMIT 1"
    );
    if (companyRes.rows.length === 0) throw new Error("Company not found. Run seed.ts first.");
    const { id: companyId, active_policy_id: policyId, feed_id: feedId } = companyRes.rows[0];

    // Get memberships
    const adminRes = await client.query(
      "SELECT m.id FROM memberships m JOIN user_profiles u ON u.id = m.user_id WHERE u.email = 'demo@komatsu.com' AND m.company_id = $1",
      [companyId]
    );
    const adminMembershipId = adminRes.rows[0].id;

    const ownerRes = await client.query(
      "SELECT m.id FROM memberships m JOIN user_profiles u ON u.id = m.user_id WHERE u.email = 'owner@komatsu.com' AND m.company_id = $1",
      [companyId]
    );
    const ownerMembershipId = ownerRes.rows[0].id;

    // Get product family IDs
    const famRes = await client.query(
      "SELECT id, name FROM product_families WHERE company_id = $1",
      [companyId]
    );
    const familyIds: Record<string, string> = {};
    for (const row of famRes.rows) {
      familyIds[row.name] = row.id;
    }

    // Get geography IDs
    const geoRes = await client.query("SELECT id, code FROM geographies");
    const geoIds: Record<string, string> = {};
    for (const row of geoRes.rows) {
      geoIds[row.code] = row.id;
    }

    // Create import batch
    const batchRes = await client.query(
      `INSERT INTO import_batches
         (company_id, feed_id, uploader_membership_id, input_format, original_filename,
          selected_worksheet, header_row, column_mapping, update_mode, idempotency_key,
          status, started_at, completed_at, row_counts)
       VALUES ($1, $2, $3, 'xlsx', 'demo_alerts.xlsx', 'Alerts', 1, '{}', 'preserve',
               'seed-initial-' || gen_random_uuid()::text, 'completed', now(), now(),
               '{"total": 7, "created": 7, "updated": 0, "unchanged": 0, "skipped": 0, "invalid": 0}')
       RETURNING id`,
      [companyId, feedId, adminMembershipId]
    );
    const batchId = batchRes.rows[0].id;
    console.log(`Created import batch: ${batchId}`);

    const alertRecords: { id: string; fixture: AlertFixture }[] = [];

    for (let i = 0; i < ALERTS.length; i++) {
      const a = ALERTS[i];

      // Build raw payload
      const rawPayload: Record<string, unknown> = {
        alert_id: a.external_alert_id,
        category_algorithm_defined: a.category,
        title: a.title,
        overview: a.overview,
        summary: a.summary,
        published_on: a.published_on,
        deadline_date: a.deadline_date || "",
        deadline_description: a.deadline_description,
        jurisdiction: a.jurisdiction_raw,
        agency_name: "",
        source: a.source_name,
        link: a.source_url,
        topic_match: a.topic_match,
        relevance: "",
        product: a.product_raw,
        status: a.status,
        timing: a.timing,
        change_type: "",
        market_access_risk: a.factors.market_access ?? "",
        cost_to_implement: a.factors.cost_to_implement ?? "",
        human_resources: a.factors.human_resources ?? "",
        urgency: a.factors.urgency ?? "",
        overall_impact_score: a.overall_impact_score,
        market_access_risk_rationale: "",
        cost_to_implement_rationale: "",
        human_resources_rationale: "",
        urgency_rationale: "",
      };

      const rowHash = crypto.createHash("sha256").update(JSON.stringify(rawPayload)).digest("hex");

      // Create import row
      const importRowRes = await client.query(
        `INSERT INTO import_rows (batch_id, row_number, external_alert_id, row_hash, raw_payload, state)
         VALUES ($1, $2, $3, $4, $5, 'created')
         RETURNING id`,
        [batchId, i + 1, a.external_alert_id, rowHash, JSON.stringify(rawPayload)]
      );
      const importRowId = importRowRes.rows[0].id;

      // Map recommendation to provider_review_state
      const providerState = a.category === "RECOMMEND_INCLUDE" ? "recommend_include" : "unreviewed";

      // Create alert
      const alertRes = await client.query(
        `INSERT INTO alerts
           (company_id, feed_id, external_alert_id, title, overview, summary, relevance,
            published_on, stage, recommendation, change_type, timing_raw, product_raw,
            jurisdiction_raw, agency_name, source_name, source_url, topic_match,
            provider_review_state, local_state, record_version)
         VALUES ($1, $2, $3, $4, $5, $6, '', $7, $8, $9, '', $10, $11, $12, '', $13, $14, $15, $16, 'new', 1)
         RETURNING id`,
        [
          companyId, feedId, a.external_alert_id, a.title, a.overview, a.summary,
          a.published_on, a.status, a.category, a.timing, a.product_raw,
          a.jurisdiction_raw, a.source_name, a.source_url, a.topic_match,
          providerState,
        ]
      );
      const alertId = alertRes.rows[0].id;

      // Create source revision
      const revisionRes = await client.query(
        `INSERT INTO alert_source_revisions
           (company_id, alert_id, import_row_id, version_number, row_hash, source_payload, effective_source_fields)
         VALUES ($1, $2, $3, 1, $4, $5, $5)
         RETURNING id`,
        [companyId, alertId, importRowId, rowHash, JSON.stringify(rawPayload)]
      );
      const revisionId = revisionRes.rows[0].id;

      // Link revision to alert
      await client.query(
        "UPDATE alerts SET current_source_revision_id = $1 WHERE id = $2",
        [revisionId, alertId]
      );

      // Link import row to alert
      await client.query(
        "UPDATE import_rows SET alert_id = $1 WHERE id = $2",
        [alertId, importRowId]
      );

      // Create source factor ratings
      const factorKeys = ["market_access", "cost_to_implement", "human_resources", "urgency"] as const;
      const factorColumns = ["market_access", "cost_to_implement", "human_resources", "urgency"] as const;
      for (let fi = 0; fi < factorKeys.length; fi++) {
        const val = a.factors[factorColumns[fi]];
        await client.query(
          `INSERT INTO source_factor_ratings
             (company_id, alert_source_revision_id, factor_key, original_value, parsed_value, rationale)
           VALUES ($1, $2, $3, $4, $5, '')`,
          [companyId, revisionId, factorKeys[fi], val !== null ? String(val) : null, val]
        );
      }

      // Create deadline if deadline_date is present
      if (a.deadline_date) {
        await client.query(
          `INSERT INTO alert_deadlines
             (company_id, alert_id, kind, date_value, applies_to, verification_state, lifecycle_state, origin)
           VALUES ($1, $2, 'unknown', $3, NULL, 'unverified', 'outstanding', 'import')`,
          [companyId, alertId, a.deadline_date]
        );
      }

      alertRecords.push({ id: alertId, fixture: a });
      console.log(`Created alert ${a.external_alert_id}: ${alertId}`);
    }

    // ================================================================
    // TEST SETUP STEP
    // ================================================================
    console.log("\n--- Running test setup step ---");

    // Confirm compliance dates for DEMO-002, 003, 004, 005
    const confirmDemos = ["DEMO-002", "DEMO-003", "DEMO-004", "DEMO-005"];
    for (const demoId of confirmDemos) {
      const rec = alertRecords.find((r) => r.fixture.external_alert_id === demoId)!;
      await client.query(
        `UPDATE alert_deadlines
         SET kind = 'compliance', verification_state = 'verified', confirmed_by = $1, confirmed_at = now()
         WHERE alert_id = $2 AND company_id = $3`,
        [adminMembershipId, rec.id, companyId]
      );
      console.log(`Confirmed compliance deadline for ${demoId}`);
    }

    // Classify DEMO-007's date as a comment date
    const demo007 = alertRecords.find((r) => r.fixture.external_alert_id === "DEMO-007")!;
    await client.query(
      `UPDATE alert_deadlines
       SET kind = 'comment', verification_state = 'verified', confirmed_by = $1, confirmed_at = now()
       WHERE alert_id = $2 AND company_id = $3`,
      [adminMembershipId, demo007.id, companyId]
    );
    console.log("Classified DEMO-007 date as comment");

    // Map geographies
    const geoMapping: Record<string, string> = {
      "DEMO-002": "US",
      "DEMO-003": "CA",
      "DEMO-004": "JP",
      "DEMO-005": "CA",
      "DEMO-007": "FR",
    };
    for (const [demoId, geoCode] of Object.entries(geoMapping)) {
      const rec = alertRecords.find((r) => r.fixture.external_alert_id === demoId)!;
      await client.query(
        `INSERT INTO alert_geographies (company_id, alert_id, geography_id, state, source_evidence, confirmed_by, confirmed_at)
         VALUES ($1, $2, $3, 'confirmed', 'Seed setup', $4, now())`,
        [companyId, rec.id, geoIds[geoCode], adminMembershipId]
      );
      console.log(`Mapped ${demoId} to ${geoCode}`);
    }

    // Confirm two product families for DEMO-002
    const demo002 = alertRecords.find((r) => r.fixture.external_alert_id === "DEMO-002")!;
    for (const familyName of ["Earthmoving & Construction", "Mining & Quarrying"]) {
      await client.query(
        `INSERT INTO alert_product_links (company_id, alert_id, family_id, state, origin, confidence, confirmed_by, confirmed_at)
         VALUES ($1, $2, $3, 'confirmed', 'import', 'high', $4, now())`,
        [companyId, demo002.id, familyIds[familyName], adminMembershipId]
      );
    }
    console.log("Confirmed product families for DEMO-002");

    // Set alert_topics for DEMO-002
    for (const topic of ["product_safety", "certification"]) {
      await client.query(
        `INSERT INTO alert_topics (company_id, alert_id, normalized_key, source_label)
         VALUES ($1, $2, $3, $4)`,
        [companyId, demo002.id, topic, topic === "product_safety" ? "Product safety" : "Certification"]
      );
    }
    console.log("Set topics for DEMO-002");

    // Assign risk_owner to DEMO-002
    await client.query(
      "UPDATE alerts SET direct_owner_membership_id = $1 WHERE id = $2",
      [ownerMembershipId, demo002.id]
    );
    await client.query(
      `INSERT INTO assignment_events (company_id, alert_id, before_owner_id, after_owner_id, origin, cause, actor_membership_id)
       VALUES ($1, $2, NULL, $3, 'direct', 'Seed setup', $4)`,
      [companyId, demo002.id, ownerMembershipId, adminMembershipId]
    );
    console.log("Assigned risk owner to DEMO-002");

    // ================================================================
    // COMPUTE SCORES
    // ================================================================
    console.log("\n--- Computing score assessments ---");

    for (const rec of alertRecords) {
      const a = rec.fixture;

      // Find confirmed compliance deadline
      const dlRes = await client.query(
        `SELECT id, date_value FROM alert_deadlines
         WHERE alert_id = $1 AND company_id = $2
           AND kind = 'compliance' AND verification_state = 'verified' AND lifecycle_state = 'outstanding'
         ORDER BY date_value ASC LIMIT 1`,
        [rec.id, companyId]
      );

      const hasConfirmedDeadline = dlRes.rows.length > 0;
      const deadlineId = hasConfirmedDeadline ? dlRes.rows[0].id : null;
      const deadlineDateStr = hasConfirmedDeadline ? dlRes.rows[0].date_value : null;

      // Source factors
      const A = a.factors.market_access;
      const B = a.factors.cost_to_implement;
      const C = a.factors.human_resources;

      // Live urgency: from confirmed compliance deadline, else 1 (low confidence)
      let D: number | null;
      let daysRemaining: number | null = null;

      if (hasConfirmedDeadline && deadlineDateStr) {
        const dlDateStr = new Date(deadlineDateStr).toISOString().split("T")[0];
        D = computeUrgencyFromDeadline(dlDateStr, AS_OF_DATE);
        daysRemaining = computeDaysRemaining(dlDateStr, AS_OF_DATE);
      } else {
        D = 1; // no confirmed compliance date → urgency 1 low confidence
        daysRemaining = null;
      }

      // Determine if alert is scoreable (has all factors)
      const allFactorsPresent = A !== null && B !== null && C !== null;

      let rawTotal: number | null = null;
      let rawBand: string | null = null;
      let effectiveTotal: number | null = null;
      let effectiveBand: string | null = null;
      const escalationReasons: { reason: string; band: string }[] = [];
      const reviewFlags: string[] = [];

      if (allFactorsPresent) {
        rawTotal = A! * B! * C! * D!;
        rawBand = computeBand(rawTotal);
        effectiveTotal = rawTotal;
        effectiveBand = rawBand;

        // Escalation 1: Market access = 9 → minimum High
        if (A === 9) {
          escalationReasons.push({ reason: "Market access = 9 gives minimum High", band: "high" });
          effectiveBand = higherBand(effectiveBand, "high");
        }

        // Escalation 2: Urgency = 9 AND Market access >= 6 → Critical
        if (D === 9 && A! >= 6) {
          escalationReasons.push({ reason: "Urgency = 9 and Market access >= 6 gives Critical", band: "critical" });
          effectiveBand = higherBand(effectiveBand, "critical");
        }

        // Low-confidence deadline flag
        if (!hasConfirmedDeadline) {
          reviewFlags.push("low_confidence_deadline");
        }

        // Draft undated/high-market-access/high-cost review flag: A >= 6 AND B >= 6
        if (A! >= 6 && B! >= 6) {
          reviewFlags.push("high_market_access_and_cost");
        }
      } else {
        // Unscored — but check if we can still apply escalation from known facts
        if (!hasConfirmedDeadline) {
          reviewFlags.push("no_confirmed_compliance_date");
        }
        reviewFlags.push("unscored");
      }

      // Build input signature
      const sigData = JSON.stringify({
        A, B, C, D,
        deadline: deadlineDateStr,
        asOf: AS_OF_DATE,
        policyId,
      });
      const inputSignature = crypto.createHash("sha256").update(sigData).digest("hex").slice(0, 16);

      // Insert score assessment
      const assessRes = await client.query(
        `INSERT INTO score_assessments
           (company_id, alert_id, policy_id, source_revision_id, selected_deadline_id,
            as_of_date, days_remaining, margin_days,
            factor_market_access, factor_cost_to_implement, factor_human_resources, factor_urgency,
            effective_market_access, effective_cost_to_implement, effective_human_resources, effective_urgency,
            raw_total, raw_band, effective_total, base_band, effective_band,
            escalation_reasons, review_flags, input_signature, calculation_trigger, is_latest)
         VALUES ($1, $2, $3,
                 (SELECT current_source_revision_id FROM alerts WHERE id = $2),
                 $4, $5, $6, NULL,
                 $7, $8, $9, $10,
                 $7, $8, $9, $10,
                 $11, $12, $13, $12, $14,
                 $15, $16, $17, 'import', TRUE)
         RETURNING id`,
        [
          companyId, rec.id, policyId,
          deadlineId, AS_OF_DATE, daysRemaining,
          A, B, C, D,
          rawTotal, rawBand, effectiveTotal, effectiveBand,
          JSON.stringify(escalationReasons),
          JSON.stringify(reviewFlags),
          inputSignature,
        ]
      );
      const assessmentId = assessRes.rows[0].id;

      // Determine effective owner
      const ownerRes2 = await client.query(
        "SELECT direct_owner_membership_id FROM alerts WHERE id = $1",
        [rec.id]
      );
      const effectiveOwnerId = ownerRes2.rows[0].direct_owner_membership_id;

      // Priority label for projection
      let priority: string;
      if (!allFactorsPresent) {
        priority = "unscored";
      } else {
        priority = effectiveBand!;
      }

      // Create projection
      await client.query(
        `INSERT INTO alert_active_projections
           (company_id, alert_id, latest_assessment_id, next_compliance_deadline,
            days_remaining, effective_priority, effective_total, effective_owner_id, is_active, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, 1)`,
        [
          companyId, rec.id, assessmentId,
          hasConfirmedDeadline ? deadlineDateStr : null,
          daysRemaining, priority, effectiveTotal, effectiveOwnerId,
        ]
      );

      console.log(
        `  ${a.external_alert_id}: D=${D}, total=${rawTotal ?? "—"}, ` +
        `base=${rawBand ?? "unscored"}, effective=${effectiveBand ?? "unscored"}, ` +
        `days=${daysRemaining ?? "—"}, ` +
        `escalations=[${escalationReasons.map((e) => e.reason).join("; ")}], ` +
        `flags=[${reviewFlags.join(", ")}]`
      );
    }

    // Create audit event
    await client.query(
      `INSERT INTO audit_events (company_id, actor_system, action, entity_type, entity_id, reason, context)
       VALUES ($1, 'seed', 'seed_alerts', 'import_batch', $2, 'Initial demo data seed', '{"alert_count": 7}')`,
      [companyId, batchId]
    );

    await client.query("COMMIT");
    console.log("\n=== Alert seed complete ===");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module || process.argv[1]?.endsWith("seed-alerts.ts")) {
  seedAlerts()
    .then(() => pool.end())
    .catch((err) => {
      console.error("Alert seed failed:", err);
      pool.end();
      process.exit(1);
    });
}

export { pool as alertPool };
