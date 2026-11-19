import { after } from "next/server";
import { query } from "@/lib/db";
import { loadAiSettings, loadApiKey, type AiSettings } from "@/lib/ai/settings";
import { completeJson, ProviderError, type ProviderConfig } from "@/lib/ai/providers";
import { GROUPING_OUTPUT_RULES, GROUPING_SCHEMA } from "./ai-prompt";
import { keySegment } from "./identifiers";
import { refreshSourcePages } from "./source-pages";
import { groupByTheme, themeOf } from "./themes";

/**
 * AI regulatory grouping.
 *
 * A run reads every field of the alerts in scope (and the title/description of each source page),
 * sends them in batches to the configured model together with the existing groups, and collects
 * a proposal: new families/actions, alert placements with a confidence and a reason, and alerts
 * left ungrouped. A person reviews the proposal and applies it (or, if set up, it is applied after
 * each import). Alerts placed by hand are never moved.
 */

/* ---------- Types ---------- */

export type Scope = "ungrouped" | "all_automatic";
export type Mode = "review" | "apply";

const VERSION_TYPES = ["proposed_rule", "supplemental_proposal", "final_rule", "correction", "amendment", "enforcement_guidance", "notice"];
const IDENT_KINDS = ["rin", "docket", "bill", "tracking", "wto", "cfr", "act", "other"];

export interface ProposedGroup {
  ref: string;
  level: "family" | "action";
  parent_existing_id: string | null;
  parent_ref: string | null;
  title: string;
  jurisdiction: string | null;
  authority: string | null;
  key_identifier: string | null;
  identifiers: Array<{ kind: string; value: string }>;
  description: string;
}

export interface ProposedAssignment {
  alert_id: string;
  alert_title: string;
  external_alert_id: string | null;
  current_group_id: string | null;
  current_group_path: string | null;
  existing_group_id: string | null;
  group_ref: string | null;
  target_path: string;
  version_type: string | null;
  confidence: number;
  reason: string;
  /** Already in that group */
  unchanged: boolean;
}

export interface Proposal {
  groups: ProposedGroup[];
  assignments: ProposedAssignment[];
  ungrouped: Array<{ alert_id: string; alert_title: string; reason: string; theme?: string | null }>;
  alerts_total: number;
  batches: number;
  pages_read: number;
}

interface AlertData {
  id: string;
  external_alert_id: string | null;
  title: string;
  overview: string | null;
  summary: string | null;
  jurisdiction_raw: string | null;
  agency_name: string | null;
  source_name: string | null;
  source_url: string | null;
  source_page_title: string | null;
  source_page_description: string | null;
  stage: string | null;
  timing_raw: string | null;
  change_type: string | null;
  published_on: string | null;
  product_raw: string | null;
  topic_match: string | null;
  category_user_defined: string | null;
  key_dates: string | null;
  date_relevance: string | null;
  status_summary: string | null;
  status_details: string | null;
  timing_summary: string | null;
  timing_details: string | null;
  change_summary: string | null;
  change_details: string | null;
  source_context: string | null;
  source_context_summary: string | null;
  source_context_details: string | null;
  primary_group_id: string | null;
  grouping_method: string | null;
}

interface GroupData {
  id: string;
  title: string;
  parent_group_id: string | null;
  level: string | null;
  group_key: string | null;
  jurisdiction_ref: string | null;
  issuer: string | null;
  description: string | null;
  rule_identifiers: unknown;
}

/* ---------- Loading ---------- */

async function loadGroups(companyId: string): Promise<Map<string, GroupData>> {
  const res = await query(
    `SELECT id, title, parent_group_id, level, group_key, jurisdiction_ref, issuer, description, rule_identifiers
     FROM regulation_groups WHERE company_id = $1 AND state <> 'archived'`,
    [companyId]
  );
  return new Map(res.rows.map((g: GroupData) => [g.id, g]));
}

function pathOf(groups: Map<string, GroupData>, id: string | null): string | null {
  if (!id) return null;
  const parts: string[] = [];
  for (let g = groups.get(id), i = 0; g && i < 8; g = g.parent_group_id ? groups.get(g.parent_group_id) : undefined, i++) parts.unshift(g.title);
  return parts.join(" › ") || null;
}

function depthOf(groups: Map<string, GroupData>, id: string): number {
  let d = 1;
  for (let g = groups.get(id); g?.parent_group_id && groups.has(g.parent_group_id) && d < 9; g = groups.get(g.parent_group_id)) d++;
  return d;
}

async function alertsInScope(companyId: string, scope: Scope): Promise<string[]> {
  const res = await query(
    `SELECT id FROM alerts
     WHERE company_id = $1 AND archived_at IS NULL
       AND grouping_method IS DISTINCT FROM 'manual'
       ${scope === "ungrouped" ? "AND (primary_group_id IS NULL OR grouping_method = 'theme')" : ""}`,
    [companyId]
  );
  return res.rows.map((r) => r.id);
}

async function loadAlerts(companyId: string, ids: string[]): Promise<AlertData[]> {
  const res = await query(
    `SELECT id, external_alert_id, title, overview, summary, jurisdiction_raw, agency_name, source_name, source_url,
            source_page_title, source_page_description, stage, timing_raw, change_type, published_on::text, product_raw, topic_match,
            category_user_defined, key_dates, date_relevance, status_summary, status_details, timing_summary, timing_details,
            change_summary, change_details, source_context, source_context_summary, source_context_details,
            primary_group_id, grouping_method
     FROM alerts WHERE company_id = $1 AND id = ANY($2::uuid[])`,
    [companyId, ids]
  );
  return res.rows;
}

/* ---------- Building the request ---------- */

const clean = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)));

function alertPayload(a: AlertData, idents: Map<string, Array<{ kind: string; value: string }>>, groups: Map<string, GroupData>) {
  return clean({
    id: a.id,
    external_id: a.external_alert_id,
    title: a.title,
    overview: a.overview,
    summary: a.summary,
    jurisdiction: a.jurisdiction_raw,
    agency: a.agency_name,
    source: a.source_name,
    url: a.source_url,
    source_page: a.source_page_title || a.source_page_description ? clean({ title: a.source_page_title, description: a.source_page_description }) : null,
    status: a.stage,
    status_summary: a.status_summary,
    status_details: a.status_details,
    timing: a.timing_raw,
    timing_summary: a.timing_summary,
    timing_details: a.timing_details,
    change_type: a.change_type,
    change_summary: a.change_summary,
    change_details: a.change_details,
    key_dates: a.key_dates,
    date_relevance: a.date_relevance,
    source_context: a.source_context,
    source_context_summary: a.source_context_summary,
    source_context_details: a.source_context_details,
    category: a.category_user_defined,
    published_on: a.published_on,
    products: a.product_raw,
    topics: a.topic_match,
    theme: themeOf(a.topic_match),
    identifiers: idents.get(a.id) ?? [],
    current_group: a.primary_group_id ? clean({ id: a.primary_group_id, path: pathOf(groups, a.primary_group_id) }) : null,
  });
}

function groupsPayload(groups: Map<string, GroupData>, members: Map<string, string[]>) {
  return [...groups.values()].map((g) =>
    clean({
      id: g.id,
      level: g.level ?? "group",
      parent_id: g.parent_group_id,
      title: g.title,
      key: g.group_key,
      jurisdiction: g.jurisdiction_ref,
      authority: g.issuer,
      identifiers: Array.isArray(g.rule_identifiers) ? g.rule_identifiers : [],
      description: g.description,
      example_alerts: (members.get(g.id) ?? []).slice(0, 6),
    })
  );
}

/** Batches of related alerts (sorted by jurisdiction and agency), capped by count and size. */
function batches<T extends { jurisdiction_raw: string | null; agency_name: string | null; title: string }>(items: T[], size: (t: T) => number, maxItems = 30, maxChars = 90_000): T[][] {
  const sorted = [...items].sort(
    (a, b) =>
      (a.jurisdiction_raw ?? "~").localeCompare(b.jurisdiction_raw ?? "~") ||
      (a.agency_name ?? "~").localeCompare(b.agency_name ?? "~") ||
      a.title.localeCompare(b.title)
  );
  const out: T[][] = [];
  let cur: T[] = [];
  let chars = 0;
  for (const it of sorted) {
    const n = size(it);
    if (cur.length && (cur.length >= maxItems || chars + n > maxChars)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(it);
    chars += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

/* ---------- Reading the answer ---------- */

const str = (v: unknown, max = 500) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

interface RawAnswer {
  new_groups: ProposedGroup[];
  assignments: Array<{ alert_id: string; existing_group_id: string | null; group_ref: string | null; version_type: string | null; confidence: number; reason: string }>;
  ungrouped: Array<{ alert_id: string; reason: string }>;
}

function readAnswer(json: unknown): RawAnswer {
  const o = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") as Record<string, unknown>[] : []);
  return {
    new_groups: arr(o.new_groups).flatMap((g) => {
      const ref = str(g.ref, 40);
      const title = str(g.title, 200);
      if (!ref || !title) return [];
      return [{
        ref,
        level: g.level === "action" ? "action" : "family",
        parent_existing_id: str(g.parent_existing_id, 60),
        parent_ref: str(g.parent_ref, 40),
        title,
        jurisdiction: str(g.jurisdiction, 40),
        authority: str(g.authority, 80),
        key_identifier: str(g.key_identifier, 120),
        identifiers: arr(g.identifiers)
          .map((i) => ({ kind: IDENT_KINDS.includes(String(i.kind)) ? String(i.kind) : "other", value: str(i.value, 120) ?? "" }))
          .filter((i) => i.value),
        description: str(g.description, 1000) ?? "",
      } as ProposedGroup];
    }),
    assignments: arr(o.assignments).flatMap((a) => {
      const alert_id = str(a.alert_id, 60);
      if (!alert_id) return [];
      const c = Math.round(Number(a.confidence));
      return [{
        alert_id,
        existing_group_id: str(a.existing_group_id, 60),
        group_ref: str(a.group_ref, 40),
        version_type: VERSION_TYPES.includes(String(a.version_type)) ? String(a.version_type) : null,
        confidence: Number.isFinite(c) ? Math.max(0, Math.min(100, c)) : 0,
        reason: str(a.reason, 600) ?? "",
      }];
    }),
    ungrouped: arr(o.ungrouped).flatMap((u) => {
      const alert_id = str(u.alert_id, 60);
      return alert_id ? [{ alert_id, reason: str(u.reason, 600) ?? "" }] : [];
    }),
  };
}

/* ---------- Running ---------- */

async function setProgress(runId: string, progress: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const sets = ["progress = $2"];
  const vals: unknown[] = [runId, JSON.stringify(progress)];
  for (const [k, v] of Object.entries(extra)) {
    vals.push(typeof v === "object" && v !== null ? JSON.stringify(v) : v);
    sets.push(`${k} = $${vals.length}`);
  }
  await query(`UPDATE ai_grouping_runs SET ${sets.join(", ")} WHERE id = $1`, vals);
}

export async function providerConfig(companyId: string, settings?: AiSettings): Promise<ProviderConfig> {
  const s = settings ?? (await loadAiSettings(companyId));
  const apiKey = await loadApiKey(companyId);
  if (!apiKey) throw new ProviderError("Add an API key in Settings › AI grouping");
  if (!s.model) throw new ProviderError("Choose a model in Settings › AI grouping");
  return { provider: s.provider, apiKey, model: s.model, baseUrl: s.base_url, effort: s.effort };
}

/** Starts a run in the background. Returns the run id (or the id of a run already in progress). */
export async function startAiGrouping(
  companyId: string,
  opts: { mode: Mode; scope: Scope; trigger: "manual" | "import"; membershipId: string | null }
): Promise<{ runId: string; alreadyRunning?: boolean }> {
  const settings = await loadAiSettings(companyId);
  if (!settings.enabled) throw new ProviderError("AI grouping is turned off in Settings");
  const cfg = await providerConfig(companyId, settings);

  // Runs that died with the server stay "running": treat them as failed after 2 hours
  await query(
    `UPDATE ai_grouping_runs SET status = 'failed', error = 'Stopped (the server restarted)', finished_at = now()
     WHERE company_id = $1 AND status = 'running' AND created_at < now() - interval '2 hours'`,
    [companyId]
  );
  const running = await query(`SELECT id FROM ai_grouping_runs WHERE company_id = $1 AND status = 'running' LIMIT 1`, [companyId]);
  if (running.rows[0]) return { runId: running.rows[0].id, alreadyRunning: true };

  const ins = await query(
    `INSERT INTO ai_grouping_runs (company_id, mode, scope, trigger, provider, model, created_by, progress)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [companyId, opts.mode, opts.scope, opts.trigger, cfg.provider, cfg.model, opts.membershipId, JSON.stringify({ step: "starting" })]
  );
  const runId: string = ins.rows[0].id;
  // Runs after the response is sent; the platform keeps the function alive for the
  // route's maxDuration (on Vercel), or as long as needed on a Node server
  after(() =>
    executeRun(runId, companyId, settings, cfg, opts).catch(async (err) => {
      console.error("AI grouping run failed:", err);
      await query(
        `UPDATE ai_grouping_runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`,
        [runId, err instanceof Error ? err.message.slice(0, 1000) : "AI grouping failed"]
      ).catch(() => {});
    })
  );
  return { runId };
}

async function executeRun(runId: string, companyId: string, settings: AiSettings, cfg: ProviderConfig, opts: { mode: Mode; scope: Scope }) {
  const ids = await alertsInScope(companyId, opts.scope);
  const empty: Proposal = { groups: [], assignments: [], ungrouped: [], alerts_total: 0, batches: 0, pages_read: 0 };
  if (!ids.length) {
    await setProgress(runId, { step: "done" }, { status: "proposed", proposal: empty, finished_at: new Date().toISOString() });
    return;
  }

  // 1. Source pages
  let pagesRead = 0;
  if (settings.read_source_pages) {
    await setProgress(runId, { step: "pages", done: 0, total: ids.length });
    pagesRead = await refreshSourcePages(companyId, ids, (done, total) => {
      if (done % 5 === 0 || done === total) void setProgress(runId, { step: "pages", done, total });
    });
  }

  // 2. Data
  const alerts = await loadAlerts(companyId, ids);
  const groups = await loadGroups(companyId);
  const identRes = await query(
    `SELECT alert_id, kind, value FROM alert_identifiers WHERE company_id = $1 AND alert_id = ANY($2::uuid[])`,
    [companyId, ids]
  );
  const idents = new Map<string, Array<{ kind: string; value: string }>>();
  for (const r of identRes.rows) {
    if (!idents.has(r.alert_id)) idents.set(r.alert_id, []);
    idents.get(r.alert_id)!.push({ kind: r.kind, value: r.value });
  }
  const memberRes = await query(
    `SELECT primary_group_id AS gid, title FROM alerts
     WHERE company_id = $1 AND archived_at IS NULL AND primary_group_id IS NOT NULL ORDER BY published_on DESC NULLS LAST`,
    [companyId]
  );
  const members = new Map<string, string[]>();
  for (const r of memberRes.rows) {
    if (!members.has(r.gid)) members.set(r.gid, []);
    if (members.get(r.gid)!.length < 6) members.get(r.gid)!.push(r.title);
  }

  const system = `${settings.grouping_prompt.trim()}\n\n${GROUPING_OUTPUT_RULES}`;
  const existingPayload = groupsPayload(groups, members);
  const payloads = new Map(alerts.map((a) => [a.id, alertPayload(a, idents, groups)]));
  const plan = batches(alerts, (a) => JSON.stringify(payloads.get(a.id)).length);

  // 3. Ask the model, batch by batch
  const proposed = new Map<string, ProposedGroup>();
  const assigned = new Map<string, RawAnswer["assignments"][number]>();
  const ungrouped = new Map<string, string>();
  const usage = { input_tokens: 0, output_tokens: 0, requests: 0 };
  let doneAlerts = 0;

  const ask = async (batch: AlertData[], batchNo: number): Promise<void> => {
    const user = JSON.stringify({
      existing_groups: existingPayload,
      proposed_groups: [...proposed.values()].map((g) => clean({ ref: g.ref, level: g.level, parent_existing_id: g.parent_existing_id, parent_ref: g.parent_ref, title: g.title, key_identifier: g.key_identifier, jurisdiction: g.jurisdiction, authority: g.authority })),
      alerts: batch.map((a) => payloads.get(a.id)),
    });
    let answer;
    try {
      answer = await completeJson(cfg, { system, user, schema: GROUPING_SCHEMA, maxTokens: 64000 });
    } catch (err) {
      // Too long for one answer: split the batch
      if (err instanceof ProviderError && /cut off/.test(err.message) && batch.length > 1) {
        const mid = Math.ceil(batch.length / 2);
        await ask(batch.slice(0, mid), batchNo);
        await ask(batch.slice(mid), batchNo);
        return;
      }
      throw err;
    }
    usage.input_tokens += answer.usage.input_tokens;
    usage.output_tokens += answer.usage.output_tokens;
    usage.requests++;
    const raw = readAnswer(answer.json);
    const inBatch = new Set(batch.map((a) => a.id));

    // New groups: a group already proposed in an earlier batch (same level, jurisdiction and
    // key identifier, or same title) is merged into it; other refs are kept unique across the run
    const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const sameAs = (g: ProposedGroup) =>
      [...proposed.values()].find(
        (p) =>
          p.level === g.level &&
          ((!!g.key_identifier && norm(p.key_identifier) === norm(g.key_identifier) && norm(p.jurisdiction) === norm(g.jurisdiction)) ||
            norm(p.title) === norm(g.title))
      );
    const rename = new Map<string, string>();
    const added: ProposedGroup[] = [];
    for (const g of raw.new_groups) {
      const dup = sameAs(g);
      if (dup) {
        rename.set(g.ref, dup.ref);
        continue;
      }
      let ref = g.ref;
      if (proposed.has(ref)) ref = `${ref}_b${batchNo}_${proposed.size}`;
      rename.set(g.ref, ref);
      const p = { ...g, ref };
      proposed.set(ref, p);
      added.push(p);
    }
    for (const p of added) {
      if (p.parent_ref && rename.has(p.parent_ref)) p.parent_ref = rename.get(p.parent_ref)!;
    }
    for (const a of raw.assignments) {
      if (!inBatch.has(a.alert_id) || assigned.has(a.alert_id)) continue;
      const ref = a.group_ref ? rename.get(a.group_ref) ?? a.group_ref : null;
      assigned.set(a.alert_id, { ...a, group_ref: ref });
    }
    for (const u of raw.ungrouped) if (inBatch.has(u.alert_id) && !assigned.has(u.alert_id)) ungrouped.set(u.alert_id, u.reason);
    for (const a of batch) if (!assigned.has(a.id) && !ungrouped.has(a.id)) ungrouped.set(a.id, "The model did not return an answer for this alert");
    doneAlerts += batch.length;
    await setProgress(runId, { step: "grouping", done: doneAlerts, total: alerts.length, batch: batchNo, batches: plan.length, groups: proposed.size }, { usage });
  };

  await setProgress(runId, { step: "grouping", done: 0, total: alerts.length, batch: 0, batches: plan.length, groups: 0 });
  for (let i = 0; i < plan.length; i++) await ask(plan[i], i + 1);

  // 4. Check the proposal
  // Actions need a valid parent; otherwise they become families
  for (const g of proposed.values()) {
    if (g.level !== "action") continue;
    const parentOk =
      (g.parent_existing_id && groups.has(g.parent_existing_id) && depthOf(groups, g.parent_existing_id) < 4) ||
      (g.parent_ref && proposed.get(g.parent_ref)?.level === "family");
    if (!parentOk) {
      g.level = "family";
      g.parent_existing_id = null;
      g.parent_ref = null;
    } else if (g.parent_ref) g.parent_existing_id = null;
  }
  const targetPath = (a: { existing_group_id: string | null; group_ref: string | null }) => {
    if (a.existing_group_id) return pathOf(groups, a.existing_group_id) ?? "";
    const g = proposed.get(a.group_ref!)!;
    const parent = g.parent_existing_id ? pathOf(groups, g.parent_existing_id) : g.parent_ref ? proposed.get(g.parent_ref)?.title : null;
    return [parent, g.title].filter(Boolean).join(" › ");
  };

  const finalAssignments: ProposedAssignment[] = [];
  const finalUngrouped: Proposal["ungrouped"] = [];
  for (const a of alerts) {
    const asg = assigned.get(a.id);
    if (asg) {
      const target = asg.existing_group_id && groups.has(asg.existing_group_id)
        ? { existing_group_id: asg.existing_group_id, group_ref: null }
        : asg.group_ref && proposed.has(asg.group_ref)
          ? { existing_group_id: null, group_ref: asg.group_ref }
          : null;
      if (!target) {
        finalUngrouped.push({ alert_id: a.id, alert_title: a.title, theme: themeOf(a.topic_match), reason: `The model pointed to a group that does not exist. ${asg.reason}`.trim() });
        continue;
      }
      if (asg.confidence < settings.min_confidence) {
        finalUngrouped.push({ alert_id: a.id, alert_title: a.title, theme: themeOf(a.topic_match), reason: `Low confidence (${asg.confidence}%): ${asg.reason}` });
        continue;
      }
      finalAssignments.push({
        alert_id: a.id,
        alert_title: a.title,
        external_alert_id: a.external_alert_id,
        current_group_id: a.primary_group_id,
        current_group_path: pathOf(groups, a.primary_group_id),
        ...target,
        target_path: targetPath(target),
        version_type: asg.version_type,
        confidence: asg.confidence,
        reason: asg.reason,
        unchanged: !!target.existing_group_id && target.existing_group_id === a.primary_group_id,
      });
    } else {
      finalUngrouped.push({ alert_id: a.id, alert_title: a.title, theme: themeOf(a.topic_match), reason: ungrouped.get(a.id) || "Not placed" });
    }
  }
  // Drop proposed groups nothing ends up in (directly or through an action)
  const used = new Set(finalAssignments.flatMap((x) => (x.group_ref ? [x.group_ref] : [])));
  for (const g of proposed.values()) if (used.has(g.ref) && g.parent_ref) used.add(g.parent_ref);
  const finalGroups = [...proposed.values()].filter((g) => used.has(g.ref));

  const proposal: Proposal = {
    groups: finalGroups,
    assignments: finalAssignments,
    ungrouped: finalUngrouped,
    alerts_total: alerts.length,
    batches: plan.length,
    pages_read: pagesRead,
  };
  await setProgress(runId, { step: "done", done: alerts.length, total: alerts.length }, {
    status: "proposed",
    proposal,
    usage,
    finished_at: new Date().toISOString(),
  });

  if (opts.mode === "apply") await applyAiProposal(companyId, runId, { membershipId: null });
}

/* ---------- Applying ---------- */

export interface ApplyResult {
  groups_created: number;
  groups_reused: number;
  alerts_placed: number;
  needs_review: number;
  skipped: number;
  /** Alerts AI could not group, placed in their theme group */
  by_theme: number;
}

const labelsFor = (jur: string | null) => (!jur ? [] : /^US$/i.test(jur) ? ["Federal"] : /^US-/i.test(jur) ? ["State"] : []);

/**
 * Creates the chosen groups and places the chosen alerts.
 * excludeGroups: refs of proposed groups not to create (their alerts and actions are skipped too).
 * excludeAlerts: alert ids not to place.
 */
export async function applyAiProposal(
  companyId: string,
  runId: string,
  opts: { membershipId: string | null; comment?: string; excludeGroups?: string[]; excludeAlerts?: string[] }
): Promise<ApplyResult> {
  const runRes = await query(`SELECT status, proposal FROM ai_grouping_runs WHERE id = $1 AND company_id = $2`, [runId, companyId]);
  const run = runRes.rows[0];
  if (!run) throw new ProviderError("Run not found", 404);
  if (run.status !== "proposed") throw new ProviderError(`This run is ${run.status}`, 409);
  const proposal = run.proposal as Proposal;
  const settings = await loadAiSettings(companyId);
  const groups = await loadGroups(companyId);

  const excludedGroups = new Set(opts.excludeGroups ?? []);
  // Excluding a family excludes its new actions too
  for (const g of proposal.groups) if (g.parent_ref && excludedGroups.has(g.parent_ref)) excludedGroups.add(g.ref);
  const excludedAlerts = new Set(opts.excludeAlerts ?? []);
  const result: ApplyResult = { groups_created: 0, groups_reused: 0, alerts_placed: 0, needs_review: 0, skipped: 0, by_theme: 0 };

  // Only groups that will receive at least one alert
  const wanted = proposal.assignments.filter((a) => !excludedAlerts.has(a.alert_id) && !a.unchanged && (!a.group_ref || !excludedGroups.has(a.group_ref)));
  const neededRefs = new Set(wanted.flatMap((a) => (a.group_ref ? [a.group_ref] : [])));
  for (const g of proposal.groups) if (neededRefs.has(g.ref) && g.parent_ref) neededRefs.add(g.parent_ref);

  // Create families first, then actions
  const refToId = new Map<string, string>();
  const keyOf = new Map<string, string>();
  const ordered = proposal.groups.filter((g) => neededRefs.has(g.ref)).sort((a, b) => (a.level === b.level ? 0 : a.level === "family" ? -1 : 1));
  for (const g of ordered) {
    const parentId = g.parent_existing_id ?? (g.parent_ref ? refToId.get(g.parent_ref) ?? null : null);
    if (g.level === "action" && !parentId) continue;
    const parentKey = parentId ? groups.get(parentId)?.group_key ?? keyOf.get(parentId) ?? keySegment(groups.get(parentId)?.title ?? "") : null;
    const jur = g.jurisdiction ? keySegment(g.jurisdiction).replace(/_/g, "-") : "INTL";
    const auth = g.authority ? keySegment(g.authority) : "GEN";
    const primary = keySegment(g.key_identifier || g.title);
    const groupKey = g.level === "action" && parentKey ? `${parentKey}-${primary}`.slice(0, 120) : `${jur}-${auth}-${primary}`.slice(0, 120);

    const existing = [...groups.values()].find((x) => x.group_key === groupKey);
    if (existing) {
      refToId.set(g.ref, existing.id);
      result.groups_reused++;
      continue;
    }
    const ins = await query(
      `INSERT INTO regulation_groups (company_id, parent_group_id, title, jurisdiction_ref, issuer, level, group_key, auto_created, description, rule_identifiers, labels)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, $9, $10) RETURNING id`,
      [
        companyId, parentId, g.title.slice(0, 120), g.level === "family" ? g.jurisdiction : null, g.level === "family" ? g.authority : null,
        g.level, groupKey, `${g.description ? `${g.description} ` : ""}(Created by AI grouping.)`.slice(0, 2000),
        JSON.stringify(g.identifiers), g.level === "family" ? labelsFor(g.jurisdiction) : [],
      ]
    );
    const id = ins.rows[0].id;
    refToId.set(g.ref, id);
    keyOf.set(id, groupKey);
    groups.set(id, { id, title: g.title, parent_group_id: parentId, level: g.level, group_key: groupKey, jurisdiction_ref: g.jurisdiction, issuer: g.authority, description: g.description, rule_identifiers: g.identifiers });
    result.groups_created++;
  }

  // Alerts: skip those a person grouped in the meantime
  const alertIds = wanted.map((a) => a.alert_id);
  const curRes = await query(
    `SELECT id, primary_group_id, grouping_method FROM alerts WHERE company_id = $1 AND id = ANY($2::uuid[]) AND archived_at IS NULL`,
    [companyId, alertIds]
  );
  const current = new Map(curRes.rows.map((r) => [r.id, r]));
  const rows: Array<{ id: string; gid: string; conf: number; basis: string; reviewed: boolean; version: string | null; path: string }> = [];
  for (const a of wanted) {
    const cur = current.get(a.alert_id);
    const gid = a.existing_group_id ?? (a.group_ref ? refToId.get(a.group_ref) : undefined);
    if (!cur || cur.grouping_method === "manual" || !gid || !groups.has(gid)) {
      result.skipped++;
      continue;
    }
    const reviewed = a.confidence >= settings.auto_accept_confidence;
    if (!reviewed) result.needs_review++;
    rows.push({ id: a.alert_id, gid, conf: a.confidence, basis: a.reason, reviewed, version: a.version_type, path: pathOf(groups, gid) ?? "" });
  }

  if (rows.length) {
    await query(
      `UPDATE alerts a SET primary_group_id = x.gid, grouping_method = 'ai', grouping_confidence = x.conf, grouping_basis = x.basis,
              grouping_reviewed = x.reviewed, version_type = COALESCE(x.version, a.version_type), record_version = record_version + 1
       FROM unnest($1::uuid[], $2::uuid[], $3::int[], $4::text[], $5::bool[], $6::text[]) AS x(id, gid, conf, basis, reviewed, version)
       WHERE a.id = x.id AND a.company_id = $7`,
      [rows.map((r) => r.id), rows.map((r) => r.gid), rows.map((r) => r.conf), rows.map((r) => r.basis), rows.map((r) => r.reviewed), rows.map((r) => r.version), companyId]
    );
    const comment = opts.comment?.trim();
    await query(
      `INSERT INTO alert_notes (company_id, alert_id, author_membership_id, body, visibility, kind, action)
       SELECT $1, x.id, $2, x.body, 'team', 'change', 'Grouped by AI into ' || x.path
       FROM unnest($3::uuid[], $4::text[], $5::text[]) AS x(id, body, path)`,
      [
        companyId,
        opts.membershipId,
        rows.map((r) => r.id),
        rows.map((r) => `${r.basis} (${r.conf}% confidence${r.reviewed ? "" : ", needs review"})${comment ? ` — Approved: ${comment}` : ""}`),
        rows.map((r) => r.path),
      ]
    );
    await query(
      `UPDATE alert_active_projections p
       SET effective_owner_id = COALESCE(a.direct_owner_membership_id, rg.owner_membership_id), updated_at = NOW()
       FROM alerts a LEFT JOIN regulation_groups rg ON rg.id = a.primary_group_id
       WHERE p.alert_id = a.id AND a.id = ANY($1::uuid[])`,
      [rows.map((r) => r.id)]
    );
  }
  result.alerts_placed = rows.length;

  // Fallback: what AI could not group goes into its theme group (alerts a person left out stay as they are)
  const leftOver = proposal.ungrouped.map((u) => u.alert_id).filter((id) => !excludedAlerts.has(id));
  if (settings.theme_fallback && leftOver.length) {
    const t = await groupByTheme(companyId, {
      alertIds: leftOver,
      membershipId: opts.membershipId,
      comment: opts.comment,
      reason: undefined,
    });
    result.by_theme = t.placed;
  }

  await query(
    `UPDATE ai_grouping_runs SET status = 'applied', result = $2, applied_by = $3, applied_at = now() WHERE id = $1`,
    [runId, JSON.stringify(result), opts.membershipId]
  );
  await query(
    `INSERT INTO audit_events (company_id, actor_membership_id, actor_system, action, entity_type, entity_id, after_values, reason)
     VALUES ($1, $2, $3, 'ai_grouping_applied', 'company', $1, $4, $5)`,
    [companyId, opts.membershipId, opts.membershipId ? null : "grouping", JSON.stringify({ run_id: runId, automatic: !opts.membershipId, ...result }), opts.comment ?? null]
  );
  return result;
}
