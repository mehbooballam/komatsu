import XLSX from "xlsx";
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

const FIELD_DEFINITIONS = [
  { column: "alert_id", type: "text", description: "Stable external alert key, stored as text." },
  { column: "category_algorithm_defined", type: "text", description: "Raw Daptic recommendation, e.g. RECOMMEND_INCLUDE." },
  { column: "title", type: "text", description: "Short display title." },
  { column: "overview", type: "text", description: "One-line takeaway." },
  { column: "summary", type: "text", description: "Full summary, searchable." },
  { column: "published_on", type: "date", description: "Source publication date (YYYY-MM-DD)." },
  { column: "deadline_date", type: "date", description: "Raw published deadline date (YYYY-MM-DD)." },
  { column: "deadline_description", type: "text", description: "Deadline context and evidence for classification." },
  { column: "jurisdiction", type: "text", description: "Raw jurisdiction or source grouping." },
  { column: "agency_name", type: "text", description: "Issuing agency or organisation from the feed." },
  { column: "source", type: "text", description: "Daptic feed or publisher." },
  { column: "link", type: "text", description: "Source URL." },
  { column: "topic_match", type: "text (pipe-delimited)", description: "Source topics, pipe-delimited." },
  { column: "relevance", type: "text", description: "Daptic's explanation of relevance." },
  { column: "product", type: "text (semicolon-delimited)", description: "Daptic-inferred product labels, semicolon-delimited." },
  { column: "status", type: "text", description: "Regulatory stage: signal/information, draft, consultation open, final mandatory, final voluntary or unknown." },
  { column: "timing", type: "text", description: "Raw source timing label." },
  { column: "change_type", type: "text", description: "Source change classification." },
  { column: "market_access_risk", type: "integer (1,3,6,9)", description: "Market access risk rating." },
  { column: "cost_to_implement", type: "integer (1,3,6,9)", description: "Implementation cost rating." },
  { column: "human_resources", type: "integer (1,3,6,9)", description: "Additional people rating." },
  { column: "urgency", type: "integer (1,3,6,9)", description: "Urgency snapshot rating." },
  { column: "overall_impact_score", type: "integer", description: "Imported total snapshot." },
  { column: "market_access_risk_rationale", type: "text", description: "Market access explanation." },
  { column: "cost_to_implement_rationale", type: "text", description: "Implementation cost explanation." },
  { column: "human_resources_rationale", type: "text", description: "People explanation." },
  { column: "urgency_rationale", type: "text", description: "Urgency explanation." },
];

interface AlertRow {
  alert_id: string;
  category_algorithm_defined: string;
  title: string;
  overview: string;
  summary: string;
  published_on: string;
  deadline_date: string;
  deadline_description: string;
  jurisdiction: string;
  agency_name: string;
  source: string;
  link: string;
  topic_match: string;
  relevance: string;
  product: string;
  status: string;
  timing: string;
  change_type: string;
  market_access_risk: number | string;
  cost_to_implement: number | string;
  human_resources: number | string;
  urgency: number | string;
  overall_impact_score: number;
  market_access_risk_rationale: string;
  cost_to_implement_rationale: string;
  human_resources_rationale: string;
  urgency_rationale: string;
}

const ALERT_DATA: AlertRow[] = [
  {
    alert_id: "DEMO-001",
    category_algorithm_defined: "RECOMMEND_INCLUDE",
    title: "Early product signal",
    overview: "Early product signal",
    summary: "Synthetic test data, for the dashboard demo.",
    published_on: "2026-11-16",
    deadline_date: "2027-01-01",
    deadline_description: "",
    jurisdiction: "CIRS Group",
    agency_name: "",
    source: "",
    link: "",
    topic_match: "",
    relevance: "",
    product: "All product lines",
    status: "Signal or Information",
    timing: "No firm date",
    change_type: "",
    market_access_risk: "",
    cost_to_implement: "",
    human_resources: "",
    urgency: "",
    overall_impact_score: 0,
    market_access_risk_rationale: "",
    cost_to_implement_rationale: "",
    human_resources_rationale: "",
    urgency_rationale: "",
  },
  {
    alert_id: "DEMO-002",
    category_algorithm_defined: "RECOMMEND_INCLUDE",
    title: "Battery enclosure requirements",
    overview: "Battery enclosure requirements",
    summary: "Synthetic test data, for the dashboard demo.",
    published_on: "2026-11-16",
    deadline_date: "2026-12-17",
    deadline_description: "First compliance deadline",
    jurisdiction: "United States",
    agency_name: "",
    source: "Federal Register",
    link: "https://example.invalid/notice/battery-enclosure-2026",
    topic_match: "Product safety | Certification",
    relevance: "",
    product: "Earthmoving & Construction; Mining & Quarrying",
    status: "Final (mandatory)",
    timing: "",
    change_type: "",
    market_access_risk: 6,
    cost_to_implement: 1,
    human_resources: 1,
    urgency: 3,
    overall_impact_score: 18,
    market_access_risk_rationale: "",
    cost_to_implement_rationale: "",
    human_resources_rationale: "",
    urgency_rationale: "",
  },
  {
    alert_id: "DEMO-003",
    category_algorithm_defined: "RECOMMEND_INCLUDE",
    title: "Battery enclosure requirements",
    overview: "Battery enclosure requirements",
    summary: "Synthetic test data, for the dashboard demo.\nWith a comma, and a line break.",
    published_on: "2026-11-16",
    deadline_date: "2029-01-01",
    deadline_description: "Compliance deadline",
    jurisdiction: "Canada",
    agency_name: "",
    source: "",
    link: "",
    topic_match: "",
    relevance: "",
    product: "Forestry & Logging",
    status: "Final (mandatory)",
    timing: "",
    change_type: "",
    market_access_risk: 3,
    cost_to_implement: 3,
    human_resources: 3,
    urgency: 3,
    overall_impact_score: 81,
    market_access_risk_rationale: "",
    cost_to_implement_rationale: "",
    human_resources_rationale: "",
    urgency_rationale: "",
  },
  {
    alert_id: "DEMO-004",
    category_algorithm_defined: "RECOMMEND_INCLUDE",
    title: "Long range documentation update",
    overview: "Long range documentation update",
    summary: "Synthetic test data, for the dashboard demo.",
    published_on: "2026-11-16",
    deadline_date: "2030-12-01",
    deadline_description: "Compliance deadline",
    jurisdiction: "Japan",
    agency_name: "",
    source: "",
    link: "",
    topic_match: "",
    relevance: "",
    product: "Industrial Machinery & Presses",
    status: "Final (mandatory)",
    timing: "",
    change_type: "",
    market_access_risk: 1,
    cost_to_implement: 1,
    human_resources: 1,
    urgency: 1,
    overall_impact_score: 1,
    market_access_risk_rationale: "",
    cost_to_implement_rationale: "",
    human_resources_rationale: "",
    urgency_rationale: "",
  },
  {
    alert_id: "DEMO-005",
    category_algorithm_defined: "RECOMMEND_INCLUDE",
    title: "Machinery testing update",
    overview: "Machinery testing update",
    summary: "Synthetic test data, for the dashboard demo.",
    published_on: "2026-11-16",
    deadline_date: "2029-01-01",
    deadline_description: "Compliance deadline",
    jurisdiction: "Canada",
    agency_name: "",
    source: "",
    link: "",
    topic_match: "",
    relevance: "",
    product: "Mining & Quarrying",
    status: "Final (mandatory)",
    timing: "",
    change_type: "",
    market_access_risk: 6,
    cost_to_implement: 6,
    human_resources: 3,
    urgency: 3,
    overall_impact_score: 324,
    market_access_risk_rationale: "",
    cost_to_implement_rationale: "",
    human_resources_rationale: "",
    urgency_rationale: "",
  },
  {
    alert_id: "DEMO-006",
    category_algorithm_defined: "RECOMMEND_INCLUDE",
    title: "Industry note on enclosure rule",
    overview: "Industry note on enclosure rule",
    summary: "Synthetic test data, for the dashboard demo.",
    published_on: "2026-11-16",
    deadline_date: "",
    deadline_description: "",
    jurisdiction: "Industry newsletter",
    agency_name: "",
    source: "Industry Safety Weekly",
    link: "https://example.invalid/industry-news/enclosure-rule-update",
    topic_match: "",
    relevance: "",
    product: "",
    status: "Signal or Information",
    timing: "",
    change_type: "",
    market_access_risk: "",
    cost_to_implement: "",
    human_resources: "",
    urgency: "",
    overall_impact_score: 0,
    market_access_risk_rationale: "",
    cost_to_implement_rationale: "",
    human_resources_rationale: "",
    urgency_rationale: "",
  },
  {
    alert_id: "DEMO-007",
    category_algorithm_defined: "RECOMMEND_INCLUDE",
    title: "Consultation on machinery labelling",
    overview: "Consultation on machinery labelling",
    summary: "Synthetic test data, for the dashboard demo.",
    published_on: "2026-11-16",
    deadline_date: "2026-12-18",
    deadline_description: "Public comment deadline",
    jurisdiction: "France",
    agency_name: "",
    source: "",
    link: "",
    topic_match: "",
    relevance: "",
    product: "All product lines",
    status: "Consultation open",
    timing: "No firm date",
    change_type: "",
    market_access_risk: 9,
    cost_to_implement: 6,
    human_resources: 1,
    urgency: 3,
    overall_impact_score: 162,
    market_access_risk_rationale: "",
    cost_to_implement_rationale: "",
    human_resources_rationale: "",
    urgency_rationale: "",
  },
];

function generateXlsx() {
  const wb = XLSX.utils.book_new();

  // Alerts sheet
  const alertRows = ALERT_DATA.map((row) => {
    const obj: Record<string, unknown> = {};
    for (const h of HEADERS) {
      obj[h] = (row as unknown as Record<string, unknown>)[h];
    }
    return obj;
  });

  const alertsWs = XLSX.utils.json_to_sheet(alertRows, { header: HEADERS });

  // Set date columns as date cells in Excel
  for (let r = 0; r < ALERT_DATA.length; r++) {
    const pubCell = XLSX.utils.encode_cell({ r: r + 1, c: HEADERS.indexOf("published_on") });
    const dlCell = XLSX.utils.encode_cell({ r: r + 1, c: HEADERS.indexOf("deadline_date") });

    if (ALERT_DATA[r].published_on) {
      alertsWs[pubCell] = { t: "d", v: new Date(ALERT_DATA[r].published_on + "T00:00:00"), z: "yyyy-mm-dd" };
    }
    if (ALERT_DATA[r].deadline_date) {
      alertsWs[dlCell] = { t: "d", v: new Date(ALERT_DATA[r].deadline_date + "T00:00:00"), z: "yyyy-mm-dd" };
    }
  }

  // Set column widths
  alertsWs["!cols"] = HEADERS.map((h) => ({
    wch: Math.max(h.length, 15),
  }));

  XLSX.utils.book_append_sheet(wb, alertsWs, "Alerts");

  // Field definitions sheet
  const defRows = FIELD_DEFINITIONS.map((d) => ({
    "Column Name": d.column,
    Type: d.type,
    Description: d.description,
  }));
  const defsWs = XLSX.utils.json_to_sheet(defRows);
  defsWs["!cols"] = [{ wch: 30 }, { wch: 25 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, defsWs, "Field definitions");

  const xlsxPath = path.join(TEMPLATE_DIR, "demo_alerts.xlsx");
  XLSX.writeFile(wb, xlsxPath);
  console.log(`Generated: ${xlsxPath}`);
}

function generateCsv() {
  const rows = ALERT_DATA.map((row) => {
    const arr: (string | number)[] = [];
    for (const h of HEADERS) {
      const val = (row as unknown as Record<string, unknown>)[h];
      arr.push(val === undefined || val === null ? "" : val as string | number);
    }
    return arr;
  });

  const csvContent = stringify([HEADERS, ...rows], {
    quoted: true,
    quoted_empty: false,
  });

  const csvPath = path.join(TEMPLATE_DIR, "demo_alerts.csv");
  fs.writeFileSync(csvPath, "﻿" + csvContent, "utf-8"); // BOM for Excel compat
  console.log(`Generated: ${csvPath}`);
}

function generateBlankXlsx() {
  const wb = XLSX.utils.book_new();

  // Empty alerts sheet with headers only
  const alertsWs = XLSX.utils.aoa_to_sheet([HEADERS]);
  alertsWs["!cols"] = HEADERS.map((h) => ({ wch: Math.max(h.length, 15) }));
  XLSX.utils.book_append_sheet(wb, alertsWs, "Alerts");

  // Field definitions sheet
  const defRows = FIELD_DEFINITIONS.map((d) => [d.column, d.type, d.description]);
  const defsWs = XLSX.utils.aoa_to_sheet([["Column Name", "Type", "Description"], ...defRows]);
  defsWs["!cols"] = [{ wch: 30 }, { wch: 25 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, defsWs, "Field definitions");

  const blankPath = path.join(TEMPLATE_DIR, "blank_template.xlsx");
  XLSX.writeFile(wb, blankPath);
  console.log(`Generated: ${blankPath}`);
}

function generateBlankCsv() {
  const csvContent = stringify([HEADERS]);
  const csvPath = path.join(TEMPLATE_DIR, "blank_template.csv");
  fs.writeFileSync(csvPath, "﻿" + csvContent, "utf-8");
  console.log(`Generated: ${csvPath}`);
}

export function generateFixtures() {
  fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
  generateXlsx();
  generateCsv();
  generateBlankXlsx();
  generateBlankCsv();
  console.log("\n=== Fixture generation complete ===");
}

if (require.main === module || process.argv[1]?.endsWith("generate-fixtures.ts")) {
  generateFixtures();
}
