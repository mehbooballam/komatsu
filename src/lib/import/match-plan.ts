import { query } from "@/lib/db";
import { compareContent, ContentIndex, MATCH_THRESHOLD, MAX_MATCHES, type Content, type ContentMatch } from "./content-match";
import { rowsFromRaw, type ColumnMapping } from "./mapping";
import { validateRows, type ValidatedRow } from "./validator";
import { computeRowHash } from "./processor";

/**
 * What an import will do with each row, given its matches and what a person decided.
 *
 *  - The alert ID is known and the content is the same: nothing to do.
 *  - The alert ID is known and the content changed: replaced by default, can be changed.
 *  - The alert ID is new but the content matches another alert (or another row of the file) at or above
 *    the import's threshold: a person decides replace, ignore or add as new. Nothing is imported before that.
 *  - Otherwise: a new alert.
 */

export type Decision = "replace" | "ignore" | "add";

export interface MatchOption {
  /** 'alert:<uuid>' or 'row:<number>' */
  target: string;
  title: string;
  external_alert_id: string;
  score: number;
  compared: number;
  identical: number;
}

export interface RowMatch {
  row: number;
  title: string;
  external_alert_id: string;
  /** id = same alert ID (or one replaced earlier); content = another alert with similar content */
  kind: "id" | "content";
  matches: MatchOption[];
  decision: Decision | null;
  target: string | null;
  /** Where the decision comes from: the person, the default for a known ID, or an earlier import */
  source: "user" | "default" | "earlier" | null;
  /** Why the decision can't be carried out */
  conflict: string | null;
}

export interface RowPlan {
  action: "create" | "update" | "skip";
  alertId?: string;
  /** New ID when a row is added as new although its ID is taken */
  externalId?: string;
  decision?: { action: Decision; score: number; alertId: string | null; title: string };
}

export interface ImportMatches {
  threshold: number;
  rows: RowMatch[];
  undecided: number;
  conflicts: number;
  /** Rows that will be created / updated / left as they are / left out with the current decisions */
  totals: { create: number; update: number; unchanged: number; skip: number };
  plan: Map<number, RowPlan>;
  validated: ValidatedRow[];
}

interface Batch {
  id: string;
  feed_id: string;
  column_mapping: ColumnMapping | null;
  match_threshold: number | null;
}

interface StoredRow {
  row_number: number;
  raw_payload: Record<string, string | null> | null;
  decision: Decision | null;
  decision_target: string | null;
}

interface AlertRow {
  id: string;
  external_alert_id: string;
  feed_id: string;
  title: string;
  archived: boolean;
  row_hash: string | null;
  payload: Content | null;
}

const ALERTS_SQL = `
  SELECT a.id, a.external_alert_id, a.feed_id, a.title, a.archived_at IS NOT NULL AS archived, asr.row_hash,
         COALESCE(asr.source_payload, jsonb_build_object(
           'title', a.title, 'overview', a.overview, 'summary', a.summary, 'status', a.stage, 'change_type', a.change_type,
           'jurisdiction', a.jurisdiction_raw, 'agency_name', a.agency_name, 'source', a.source_name, 'link', a.source_url,
           'topic_match', a.topic_match, 'product', a.product_raw)) AS payload
  FROM alerts a
  LEFT JOIN alert_source_revisions asr ON asr.id = a.current_source_revision_id
  WHERE a.company_id = $1`;

const alertKey = (id: string) => `alert:${id}`;
const rowKey = (n: number) => `row:${n}`;

async function loadRows(batchId: string): Promise<StoredRow[]> {
  return (
    await query(`SELECT row_number, raw_payload, decision, decision_target FROM import_rows WHERE batch_id = $1 ORDER BY row_number`, [batchId])
  ).rows;
}

export async function loadImportMatches(companyId: string, batch: Batch): Promise<ImportMatches> {
  const threshold = batch.match_threshold ?? MATCH_THRESHOLD;
  const [stored, alertRes] = await Promise.all([loadRows(batch.id), query(ALERTS_SQL, [companyId])]);
  const validated = validateRows(rowsFromRaw(stored, batch.column_mapping || {})).rows;
  const rows = validated.filter((r) => r.isValid && !r.isDuplicate);
  const storedBy = new Map(stored.map((r) => [r.row_number, r]));
  const alerts = alertRes.rows as AlertRow[];
  const alertById = new Map(alerts.map((a) => [a.id, a]));
  const alertByExternal = new Map(alerts.filter((a) => a.feed_id === batch.feed_id).map((a) => [a.external_alert_id, a]));

  // Earlier decisions for IDs the app has no alert for
  const unknownIds = rows.map((r) => r.parsed.alert_id as string).filter((id) => !alertByExternal.has(id));
  const earlierRes = unknownIds.length
    ? await query(
        `SELECT DISTINCT ON (ir.external_alert_id, ir.decision) ir.external_alert_id, ir.decision, ir.decision_target, ir.alert_id, ir.row_hash
         FROM import_rows ir JOIN import_batches b ON b.id = ir.batch_id
         WHERE b.company_id = $1 AND b.feed_id = $2 AND b.status = 'completed' AND ir.decision IN ('replace', 'ignore')
           AND ir.external_alert_id = ANY($3::text[])
         ORDER BY ir.external_alert_id, ir.decision, b.created_at DESC`,
        [companyId, batch.feed_id, unknownIds]
      )
    : { rows: [] };
  const replacedInto = new Map<string, string>();
  const ignoredBefore = new Map<string, { target: string | null; hash: string | null }>();
  for (const e of earlierRes.rows) {
    if (e.decision === "replace" && e.alert_id && alertById.get(e.alert_id) && !alertById.get(e.alert_id)!.archived) replacedInto.set(e.external_alert_id, e.alert_id);
    if (e.decision === "ignore") ignoredBefore.set(e.external_alert_id, { target: e.decision_target, hash: e.row_hash });
  }

  // 1. Rows whose ID belongs to an alert; then IDs whose content replaced an alert earlier (unless that
  //    alert has its own row in this file, or another such row: then a person decides again)
  const ownAlert = new Map<number, AlertRow>();
  const claimed = new Set<string>();
  for (const r of rows) {
    const a = alertByExternal.get(r.parsed.alert_id as string);
    if (a) {
      ownAlert.set(r.rowNumber, a);
      claimed.add(a.id);
    }
  }
  for (const r of rows) {
    const id = replacedInto.get(r.parsed.alert_id as string);
    if (id && !ownAlert.has(r.rowNumber) && !claimed.has(id)) {
      ownAlert.set(r.rowNumber, alertById.get(id)!);
      claimed.add(id);
    }
  }

  // 2. Content index: alerts (those updated by a row of this file count with that row's content), then
  //    the new rows one after the other, so each is compared with the rows before it
  const index = new ContentIndex();
  for (const a of alerts) if (!a.archived && !claimed.has(a.id) && a.payload) index.add({ key: alertKey(a.id), content: a.payload });
  for (const r of rows) if (ownAlert.has(r.rowNumber)) index.add({ key: rowKey(r.rowNumber), content: r.mapped });
  const rowByNumber = new Map(rows.map((r) => [r.rowNumber, r]));

  const option = (key: string, m: ContentMatch): MatchOption => {
    const base = { target: key, score: m.score, compared: m.compared, identical: m.identical };
    if (key.startsWith("alert:")) {
      const a = alertById.get(key.slice(6))!;
      return { ...base, title: a.title, external_alert_id: a.external_alert_id };
    }
    const r = rowByNumber.get(Number(key.slice(4)))!;
    return { ...base, title: String(r.parsed.title ?? ""), external_alert_id: String(r.parsed.alert_id ?? "") };
  };

  const out: RowMatch[] = [];
  const unchanged = new Set<number>();
  for (const r of rows) {
    const saved = storedBy.get(r.rowNumber);
    const base = { row: r.rowNumber, title: String(r.parsed.title ?? ""), external_alert_id: String(r.parsed.alert_id ?? ""), conflict: null };
    const own = ownAlert.get(r.rowNumber);
    if (own) {
      const hash = computeRowHash(r.mapped);
      if (own.row_hash === hash) {
        unchanged.add(r.rowNumber);
        continue;
      }
      const m = option(alertKey(own.id), compareContent(r.mapped, own.payload || {}));
      const mine = saved?.decision && saved.decision_target === m.target ? saved.decision : null;
      out.push({ ...base, kind: "id", matches: [m], decision: mine ?? "replace", target: m.target, source: mine ? "user" : "default" });
      continue;
    }
    const matches = index.find(r.mapped, threshold).slice(0, MAX_MATCHES).map((x) => option(x.key, x.match));
    index.add({ key: rowKey(r.rowNumber), content: r.mapped });
    if (!matches.length) continue;
    // A decision counts only while the alert it was made for still matches
    let decision: Decision | null = null;
    let target = matches[0].target;
    let source: RowMatch["source"] = null;
    if (saved?.decision && matches.some((m) => m.target === saved.decision_target)) {
      decision = saved.decision;
      target = saved.decision_target!;
      source = "user";
    } else {
      const before = ignoredBefore.get(base.external_alert_id);
      if (before?.target && matches.some((m) => m.target === before.target) && before.hash === computeRowHash(r.mapped)) {
        decision = "ignore";
        target = before.target;
        source = "earlier";
      }
    }
    out.push({ ...base, kind: "content", matches, decision, target, source });
  }

  // 3. Two rows can't replace the same alert or row
  const replacing = new Map<string, number>();
  for (const m of out) {
    if (m.decision !== "replace" || !m.target) continue;
    const other = replacing.get(m.target);
    if (other !== undefined) m.conflict = `Row ${other} already replaces this one. Choose Ignore or Add as new, or pick another match.`;
    else replacing.set(m.target, m.row);
  }

  // 4. The plan
  const matchBy = new Map(out.map((m) => [m.row, m]));
  const displaced = new Set<number>(); // rows another row takes the place of
  for (const m of out) if (m.decision === "replace" && m.target?.startsWith("row:")) displaced.add(Number(m.target.slice(4)));
  /** The alert a row ends up updating, or null when it creates one. */
  const placeOf = (n: number): string | null => {
    const m = matchBy.get(n);
    const own = ownAlert.get(n);
    if (m?.decision === "add") return null;
    if (own) return own.id;
    if (m?.decision !== "replace" || !m.target) return null;
    return m.target.startsWith("alert:") ? m.target.slice(6) : placeOf(Number(m.target.slice(4)));
  };
  const takenIds = new Set([...alertByExternal.keys(), ...rows.map((r) => String(r.parsed.alert_id))]);
  const plan = new Map<number, RowPlan>();
  const totals = { create: 0, update: 0, unchanged: 0, skip: 0 };
  for (const r of rows) {
    const n = r.rowNumber;
    const m = matchBy.get(n);
    if (displaced.has(n)) {
      plan.set(n, { action: "skip" });
      totals.skip++;
      continue;
    }
    if (unchanged.has(n)) {
      totals.unchanged++;
      const own = ownAlert.get(n)!;
      if (own.external_alert_id !== r.parsed.alert_id) plan.set(n, { action: "update", alertId: own.id });
      continue;
    }
    const chosen = m?.matches.find((x) => x.target === m.target) ?? null;
    const decided =
      m?.decision && chosen && (m.kind === "content" || m.decision !== "replace")
        ? { action: m.decision, score: chosen.score, alertId: chosen.target.startsWith("alert:") ? chosen.target.slice(6) : null, title: chosen.title }
        : undefined;
    if (m?.decision === "ignore") {
      plan.set(n, { action: "skip", decision: decided });
      totals.skip++;
    } else if (m?.decision === "add") {
      let externalId: string | undefined;
      // The ID is free when its alert was only taken over by an earlier Replace
      if (alertByExternal.has(m.external_alert_id)) {
        for (let i = 2; ; i++) {
          externalId = `${m.external_alert_id}-${i}`;
          if (!takenIds.has(externalId)) break;
        }
        takenIds.add(externalId);
      }
      plan.set(n, { action: "create", externalId, decision: decided });
      totals.create++;
    } else {
      const alertId = placeOf(n);
      plan.set(n, alertId ? { action: "update", alertId, decision: decided } : { action: "create", decision: decided });
      totals[alertId ? "update" : "create"]++;
    }
  }

  return {
    threshold,
    rows: out,
    undecided: out.filter((m) => !m.decision).length,
    conflicts: out.filter((m) => m.conflict).length,
    totals,
    plan,
    validated,
  };
}

/** Column-by-column comparison of one row with one of its matches. */
export async function compareRowWith(companyId: string, batch: Batch, rowNumber: number, target: string): Promise<ContentMatch | null> {
  const validated = validateRows(rowsFromRaw(await loadRows(batch.id), batch.column_mapping || {})).rows;
  const row = validated.find((r) => r.rowNumber === rowNumber);
  if (!row) return null;
  if (target.startsWith("row:")) {
    const other = validated.find((r) => r.rowNumber === Number(target.slice(4)));
    return other ? compareContent(row.mapped, other.mapped) : null;
  }
  const id = target.startsWith("alert:") ? target.slice(6) : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const res = await query(`${ALERTS_SQL} AND a.id = $2`, [companyId, id]);
  return res.rows[0]?.payload ? compareContent(row.mapped, res.rows[0].payload) : null;
}
