import "dotenv/config";

/**
 * Replaces every regulation group with a sample set of regulatory families and actions
 * (Family › Action › Version), labelled Federal / State, then runs automatic grouping so
 * alerts that carry matching identifiers join them.
 *
 *   npx tsx scripts/sample-groups.ts            all workspaces
 *   npx tsx scripts/sample-groups.ts "Komatsu"  workspaces whose name contains the text
 *
 * Destructive for groups: all existing groups (active and archived) are deleted and every alert
 * is ungrouped first. Alerts, scores, owners and notes people wrote are kept; only the automatic
 * grouping notes (which refer to the deleted groups) are removed.
 */

type Ident = { kind: "rin" | "docket" | "bill" | "tracking" | "wto" | "cfr"; value: string };
interface SampleAction { title: string; key: string; identifiers?: Ident[]; description?: string }
interface SampleFamily {
  title: string;
  key: string;
  jurisdiction: string;
  issuer: string;
  labels: string[];
  identifiers?: Ident[];
  description: string;
  actions?: SampleAction[];
  /** Alerts placed here by hand for the sample (title starts with…), with the recorded basis */
  manual?: Array<{ titleStartsWith: string; basis: string; action?: string }>;
}

const FAMILIES: SampleFamily[] = [
  {
    title: "TSCA Significant New Use Rules",
    key: "US-EPA-TSCA_SNUR",
    jurisdiction: "US",
    issuer: "EPA",
    labels: ["Federal"],
    identifiers: [{ kind: "cfr", value: "40 CFR 721" }, { kind: "wto", value: "G/TBT/N/USA/2289" }],
    description: "EPA significant new use rules for chemical substances under TSCA section 5 (40 CFR Part 721).",
    actions: [
      {
        title: "SNUR 25-3.5e — certain chemical substances",
        key: "US-EPA-TSCA_SNUR-25_3_5E",
        identifiers: [{ kind: "tracking", value: "EPA 25-3.5e" }, { kind: "docket", value: "EPA-HQ-OPPT-2025-2169" }],
      },
      {
        title: "SNUR 23-1.M — modification of significant new uses",
        key: "US-EPA-TSCA_SNUR-23_1_M",
        identifiers: [{ kind: "tracking", value: "EPA 23-1.M" }, { kind: "docket", value: "EPA-HQ-OPPT-2022-0863" }],
      },
    ],
  },
  {
    title: "AIM Act",
    key: "US-EPA-AIM_ACT",
    jurisdiction: "US",
    issuer: "EPA",
    labels: ["Federal"],
    identifiers: [{ kind: "cfr", value: "40 CFR 84" }],
    description: "American Innovation and Manufacturing Act: HFC phasedown (40 CFR Part 84).",
    actions: [
      { title: "Technology Transitions Rule", key: "US-EPA-AIM_ACT-TECH_TRANSITIONS" },
      { title: "HFC Allocation Rule", key: "US-EPA-AIM_ACT-ALLOCATIONS" },
      { title: "HFC Reclamation Rule", key: "US-EPA-AIM_ACT-RECLAMATION" },
    ],
  },
  {
    title: "TSCA Section 6 PFAS Rulemaking",
    key: "US-EPA-TSCA_SEC6_PFAS",
    jurisdiction: "US",
    issuer: "EPA",
    labels: ["Federal"],
    identifiers: [{ kind: "cfr", value: "40 CFR 751" }],
    description: "Risk management rules for PFAS under TSCA section 6 (40 CFR Part 751).",
  },
  {
    title: "OSHA Hazard Communication Standard (GHS)",
    key: "US-OSHA-HCS_GHS",
    jurisdiction: "US",
    issuer: "OSHA",
    labels: ["Federal"],
    identifiers: [{ kind: "docket", value: "OSHA-2016-0005" }, { kind: "cfr", value: "29 CFR 1910" }],
    description: "Alignment of the Hazard Communication Standard with the UN GHS.",
  },
  {
    title: "California Vehicle Traction Battery Registration (SB 615)",
    key: "US-CA-CARB-SB_615",
    jurisdiction: "United States - California (State)",
    issuer: "CARB",
    labels: ["State"],
    identifiers: [{ kind: "bill", value: "US-CA SB 615" }],
    description: "Registration and end-of-life requirements for EV traction batteries under SB 615.",
  },
  {
    title: "California Safer Consumer Products",
    key: "US-CA-DTSC-SCP",
    jurisdiction: "United States - California (State)",
    issuer: "DTSC",
    labels: ["State"],
    description: "DTSC Safer Consumer Products program (priority products and alternatives analysis).",
  },
  {
    title: "Minnesota PFAS Reporting",
    key: "US-MN-MPCA-HF2310_PFAS",
    jurisdiction: "United States - Minnesota (State)",
    issuer: "MPCA",
    labels: ["State"],
    identifiers: [{ kind: "bill", value: "US-MN HF 2310" }],
    description: "PFAS-in-products reporting under Minnesota HF 2310 (Amara's Law).",
  },
  {
    title: "Washington Safer Products Program",
    key: "US-WA-ECOLOGY-SCPP",
    jurisdiction: "United States - Washington (State)",
    issuer: "ECOLOGY",
    labels: ["State"],
    description: "Safer Products for Washington: priority chemicals and consumer products.",
  },
  {
    title: "Maine PFAS in Products",
    key: "US-ME-MDEP-PFAS_PRODUCTS",
    jurisdiction: "United States - Maine (State)",
    issuer: "MDEP",
    labels: ["State"],
    description: "PFAS in products notification and currently unavoidable use (CUU) determinations.",
    manual: [{ titleStartsWith: "Maine Updates PFAS Product Notification", basis: "Sample grouping: Maine DEP PFAS product notification and CUU guidance belong to the PFAS in Products program." }],
  },
  {
    title: "EU CLP Regulation",
    key: "EU-EC-CLP",
    jurisdiction: "European Union",
    issuer: "EC",
    labels: [],
    description: "Classification, Labelling and Packaging Regulation (EC) No 1272/2008 and its revisions.",
    actions: [{ title: "CLP revision and harmonised classifications", key: "EU-EC-CLP-REVISION" }],
    manual: [
      { titleStartsWith: "European Commission Proposes Harmonised CLP", basis: "Sample grouping: harmonised CLP classifications proposed by the Commission.", action: "EU-EC-CLP-REVISION" },
      { titleStartsWith: "EU Proposes Amendments to CLP Regulation", basis: "Sample grouping: amendments to the CLP Regulation.", action: "EU-EC-CLP-REVISION" },
    ],
  },
  {
    title: "Hungary environmental decrees",
    key: "HU-GH-ENV_DECREES",
    jurisdiction: "Hungary (National)",
    issuer: "GH",
    labels: [],
    description: "Government of Hungary consultations and amendments to environmental, waste and water decrees.",
    actions: [{ title: "Waste management decrees", key: "HU-GH-ENV_DECREES-WASTE" }],
    manual: [
      { titleStartsWith: "Social consultation on waste decrees", basis: "Sample grouping: consultation on the waste management decrees.", action: "HU-GH-ENV_DECREES-WASTE" },
      { titleStartsWith: "Amendment of water management decrees", basis: "Sample grouping: Hungarian environmental decree amendments." },
      { titleStartsWith: "Amendment of Environmental Protection Decrees", basis: "Sample grouping: Hungarian environmental decree amendments." },
    ],
  },
];

async function main() {
  const { query, transaction } = await import("../src/lib/db");
  const { runGrouping } = await import("../src/lib/grouping/engine");
  const { ensureDefaultLabels } = await import("../src/lib/groups");

  const filter = process.argv[2];
  const companies = await query(
    `SELECT id, name FROM companies ${filter ? "WHERE name ILIKE $1" : ""} ORDER BY name`,
    filter ? [`%${filter}%`] : []
  );
  if (!companies.rowCount) {
    console.log("No matching workspace.");
    process.exit(1);
  }

  for (const c of companies.rows) {
    console.log(`\n${c.name}`);
    const before = await query(`SELECT COUNT(*)::int AS n FROM regulation_groups WHERE company_id = $1`, [c.id]);

    await transaction(async (client) => {
      // 1. Remove every group and what points at one
      await client.query(
        `UPDATE alerts SET primary_group_id = NULL, grouping_method = NULL, grouping_confidence = NULL,
                grouping_basis = NULL, grouping_reviewed = FALSE
         WHERE company_id = $1`,
        [c.id]
      );
      await client.query(`DELETE FROM alert_group_links WHERE company_id = $1`, [c.id]);
      await client.query(`DELETE FROM group_product_links WHERE company_id = $1`, [c.id]);
      await client.query(`UPDATE assignment_events SET group_id = NULL WHERE company_id = $1 AND group_id IS NOT NULL`, [c.id]);
      await client.query(`UPDATE regulation_groups SET parent_group_id = NULL WHERE company_id = $1`, [c.id]);
      await client.query(`DELETE FROM regulation_groups WHERE company_id = $1`, [c.id]);
      // Automatic grouping notes refer to the deleted groups; notes people wrote are kept
      await client.query(`DELETE FROM alert_notes WHERE company_id = $1 AND kind = 'change' AND author_membership_id IS NULL`, [c.id]);
      // Alerts no longer inherit a group owner
      await client.query(
        `UPDATE alert_active_projections p SET effective_owner_id = a.direct_owner_membership_id, updated_at = now()
         FROM alerts a WHERE p.alert_id = a.id AND a.company_id = $1`,
        [c.id]
      );

      // 2. Sample families and actions
      const actionIds = new Map<string, string>();
      for (const f of FAMILIES) {
        const fam = await client.query(
          `INSERT INTO regulation_groups (company_id, title, jurisdiction_ref, issuer, description, level, group_key, rule_identifiers, labels)
           VALUES ($1, $2, $3, $4, $5, 'family', $6, $7, $8) RETURNING id`,
          [c.id, f.title, f.jurisdiction, f.issuer, f.description, f.key, JSON.stringify(f.identifiers || []), f.labels]
        );
        const familyId = fam.rows[0].id;
        for (const a of f.actions || []) {
          const act = await client.query(
            `INSERT INTO regulation_groups (company_id, parent_group_id, title, jurisdiction_ref, issuer, description, level, group_key, rule_identifiers, labels)
             VALUES ($1, $2, $3, $4, $5, $6, 'action', $7, $8, $9) RETURNING id`,
            [c.id, familyId, a.title, f.jurisdiction, f.issuer, a.description || null, a.key, JSON.stringify(a.identifiers || []), f.labels]
          );
          actionIds.set(a.key, act.rows[0].id);
        }
        // Alerts placed by hand for the sample, with the basis recorded
        for (const m of f.manual || []) {
          const target = m.action ? actionIds.get(m.action)! : familyId;
          const res = await client.query(
            `UPDATE alerts SET primary_group_id = $1, grouping_method = 'manual', grouping_basis = $2, grouping_reviewed = TRUE
             WHERE company_id = $3 AND archived_at IS NULL AND title ILIKE $4 AND primary_group_id IS NULL
             RETURNING id`,
            [target, m.basis, c.id, `${m.titleStartsWith}%`]
          );
          for (const r of res.rows) {
            await client.query(
              `INSERT INTO alert_notes (company_id, alert_id, author_membership_id, body, visibility, kind, action)
               VALUES ($1, $2, NULL, $3, 'team', 'change', $4)`,
              [c.id, r.id, m.basis, `Grouped into ${f.title}${m.action ? " › " + (f.actions || []).find((x) => x.key === m.action)?.title : ""} (sample setup)`]
            );
          }
        }
      }
      await client.query(
        `INSERT INTO audit_events (company_id, actor_system, action, entity_type, entity_id, after_values)
         VALUES ($1, 'setup', 'sample_groups', 'company', $1, $2)`,
        [c.id, JSON.stringify({ deleted_groups: before.rows[0].n, families: FAMILIES.length })]
      );
    });
    await ensureDefaultLabels(c.id);
    console.log(`  deleted ${before.rows[0].n} old groups, created ${FAMILIES.length} sample families`);

    // 3. Automatic grouping pulls matching alerts in
    const result = await runGrouping(c.id);
    console.log(
      `  automatic grouping: ${result.placed.exact} exact, ${result.placed.strong} by CFR part, ${result.placed.similarity} by similarity;`,
      `${result.families_created} families and ${result.actions_created} actions created`
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
