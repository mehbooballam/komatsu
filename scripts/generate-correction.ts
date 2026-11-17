import { stringify } from "csv-stringify/sync";
import fs from "fs";
import path from "path";

const TEMPLATE_DIR = path.join(process.cwd(), "templates");

const HEADERS = [
  "alert_id",
  "category_algorithm_defined",
  "title",
  "overview",
  "summary",
  "published_on",
  "deadline_date",
  "deadline_description",
  "jurisdiction",
  "agency_name",
  "source",
  "link",
  "topic_match",
  "relevance",
  "product",
  "status",
  "timing",
  "change_type",
  "market_access_risk",
  "cost_to_implement",
  "human_resources",
  "urgency",
  "overall_impact_score",
  "market_access_risk_rationale",
  "cost_to_implement_rationale",
  "human_resources_rationale",
  "urgency_rationale",
];

export function generateCorrection() {
  fs.mkdirSync(TEMPLATE_DIR, { recursive: true });

  const row = [
    "DEMO-005",           // alert_id
    "RECOMMEND_INCLUDE",  // category_algorithm_defined
    "Machinery testing update", // title
    "Machinery testing update", // overview
    "Updated synthetic test data with revised compliance notes.", // summary (changed)
    "2026-11-16",         // published_on
    "2029-01-01",         // deadline_date
    "Compliance deadline", // deadline_description
    "Canada",             // jurisdiction
    "",                   // agency_name
    "",                   // source
    "",                   // link
    "",                   // topic_match
    "",                   // relevance
    "Mining & Quarrying", // product
    "Final (mandatory)",  // status
    "",                   // timing
    "",                   // change_type
    6,                    // market_access_risk
    6,                    // cost_to_implement
    3,                    // human_resources
    3,                    // urgency
    324,                  // overall_impact_score
    "",                   // market_access_risk_rationale
    "",                   // cost_to_implement_rationale
    "",                   // human_resources_rationale
    "",                   // urgency_rationale
  ];

  const csvContent = stringify([HEADERS, row], {
    quoted: true,
    quoted_empty: false,
  });

  const csvPath = path.join(TEMPLATE_DIR, "demo_correction.csv");
  fs.writeFileSync(csvPath, "﻿" + csvContent, "utf-8");
  console.log(`Generated correction CSV: ${csvPath}`);
}

if (require.main === module || process.argv[1]?.endsWith("generate-correction.ts")) {
  generateCorrection();
}
