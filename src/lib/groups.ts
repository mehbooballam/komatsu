import { query } from "@/lib/db";
import { extractIdentifiers, jurisdictionCode, type Identifier } from "@/lib/grouping/identifiers";

/** Groups can nest: group › sub-group › sub-sub-group › level 4. */
export const MAX_GROUP_DEPTH = 4;

const PRIORITY_RANK: Record<string, number> = { critical: 1, high: 2, moderate: 3, low: 4 };

export type GroupLevel = "family" | "action";

export interface GroupNode {
  id: string;
  parent_group_id: string | null;
  title: string;
  jurisdiction_ref: string | null;
  issuer: string | null;
  description: string | null;
  owner_membership_id: string | null;
  owner_name: string | null;
  state: string;
  created_at: string;
  /** Regulatory family (level 1) or regulatory action (level 2); null for a free-form group. */
  level: GroupLevel | null;
  /** Stable key, e.g. US-EPA-AIM_ACT or US-EPA-AIM_ACT-ALLOCATIONS. */
  group_key: string | null;
  auto_created: boolean;
  /** Identifiers that pull matching alerts into this group automatically. */
  identifiers: Identifier[];
  /** Highest final score across this group and its sub-groups (the group's risk score). */
  score: number | null;
  /** Alerts per final priority across this group and its sub-groups. */
  by_band: { critical: number; high: number; moderate: number; low: number; unscored: number };
  /** Earliest upcoming compliance deadline in the group. */
  next_deadline: string | null;
  /** Alerts grouped by subject similarity that are waiting for someone to confirm. */
  needs_review: number;
  /** Labels such as Federal or State. */
  labels: string[];
  /** 1 = top level */
  depth: number;
  /** Titles from the top-level group down to this one. */
  path: string[];
  /** Alerts filed directly in this group. */
  alert_count: number;
  /** Alerts in this group and all of its sub-groups. */
  total_count: number;
  /** Highest final priority across this group and its sub-groups. */
  highest_priority: string | null;
  child_count: number;
}

/**
 * Loads every active group of a company as a flat list in tree order
 * (parents first, siblings alphabetical), with depth, path and roll-up counts.
 */
export async function loadGroupTree(companyId: string): Promise<GroupNode[]> {
  const res = await query(
    `SELECT rg.id, rg.parent_group_id, rg.title, rg.jurisdiction_ref, rg.issuer, rg.description,
            rg.owner_membership_id, rg.state, rg.created_at, up.display_name AS owner_name,
            rg.level, rg.group_key, rg.auto_created, rg.rule_identifiers, rg.labels,
            COALESCE(c.cnt, 0)::int AS alert_count, c.top_rank, c.top_score,
            COALESCE(c.critical, 0)::int AS critical, COALESCE(c.high, 0)::int AS high,
            COALESCE(c.moderate, 0)::int AS moderate, COALESCE(c.low, 0)::int AS low,
            COALESCE(c.unscored, 0)::int AS unscored, COALESCE(c.review, 0)::int AS review,
            to_char(c.next_deadline, 'YYYY-MM-DD') AS next_deadline
     FROM regulation_groups rg
     LEFT JOIN memberships m ON m.id = rg.owner_membership_id AND m.company_id = rg.company_id
     LEFT JOIN user_profiles up ON up.id = m.user_id
     LEFT JOIN (
       SELECT a.primary_group_id AS gid, COUNT(*) AS cnt,
              MIN(CASE p.effective_priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'moderate' THEN 3 WHEN 'low' THEN 4 END) AS top_rank,
              MAX(p.effective_total) AS top_score,
              COUNT(*) FILTER (WHERE p.effective_priority = 'critical') AS critical,
              COUNT(*) FILTER (WHERE p.effective_priority = 'high') AS high,
              COUNT(*) FILTER (WHERE p.effective_priority = 'moderate') AS moderate,
              COUNT(*) FILTER (WHERE p.effective_priority = 'low') AS low,
              COUNT(*) FILTER (WHERE p.effective_priority IS NULL OR p.effective_priority NOT IN ('critical','high','moderate','low')) AS unscored,
              COUNT(*) FILTER (WHERE a.grouping_method IN ('similarity', 'ai') AND NOT a.grouping_reviewed) AS review,
              MIN(p.next_compliance_deadline) FILTER (WHERE p.next_compliance_deadline >= CURRENT_DATE) AS next_deadline
       FROM alerts a
       LEFT JOIN alert_active_projections p ON p.alert_id = a.id AND p.company_id = a.company_id
       WHERE a.company_id = $1 AND a.archived_at IS NULL AND a.primary_group_id IS NOT NULL
       GROUP BY a.primary_group_id
     ) c ON c.gid = rg.id
     WHERE rg.company_id = $1 AND rg.state <> 'archived'`,
    [companyId]
  );

  type Row = (typeof res.rows)[number];
  const byId = new Map<string, Row>(res.rows.map((r) => [r.id, r]));
  const children = new Map<string | null, Row[]>();
  for (const r of res.rows) {
    // A parent that is archived or missing makes the group top level
    const parent = r.parent_group_id && byId.has(r.parent_group_id) ? r.parent_group_id : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(r);
  }
  for (const list of children.values()) list.sort((a, b) => a.title.localeCompare(b.title));

  const out: GroupNode[] = [];
  const seen = new Set<string>();
  type Roll = { total: number; rank: number; score: number | null; bands: GroupNode["by_band"]; next: string | null; review: number };
  const emptyBands = () => ({ critical: 0, high: 0, moderate: 0, low: 0, unscored: 0 });
  const walk = (parent: string | null, depth: number, path: string[]): Roll => {
    let total = 0;
    let rank = 99;
    let score: number | null = null;
    const bands = emptyBands();
    let next: string | null = null;
    let review = 0;
    for (const r of children.get(parent) || []) {
      if (seen.has(r.id)) continue; // guards against a cycle in bad data
      seen.add(r.id);
      const node: GroupNode = {
        id: r.id,
        parent_group_id: parent,
        title: r.title,
        jurisdiction_ref: r.jurisdiction_ref,
        issuer: r.issuer,
        description: r.description,
        owner_membership_id: r.owner_membership_id,
        owner_name: r.owner_name,
        state: r.state,
        created_at: r.created_at,
        level: r.level,
        group_key: r.group_key,
        auto_created: r.auto_created,
        identifiers: Array.isArray(r.rule_identifiers) ? r.rule_identifiers.filter((x: unknown) => x && typeof x === "object" && "kind" in x) : [],
        score: null,
        by_band: emptyBands(),
        next_deadline: null,
        needs_review: 0,
        labels: r.labels || [],
        depth,
        path: [...path, r.title],
        alert_count: r.alert_count,
        total_count: 0,
        highest_priority: null,
        child_count: (children.get(r.id) || []).length,
      };
      out.push(node);
      const sub = walk(r.id, depth + 1, node.path);
      node.total_count = r.alert_count + sub.total;
      const best = Math.min(r.top_rank ?? 99, sub.rank);
      node.highest_priority = Object.keys(PRIORITY_RANK).find((k) => PRIORITY_RANK[k] === best) || null;
      // Group priority & score roll up from every version in the family: the worst one sets the level
      const own = r.top_score === null || r.top_score === undefined ? null : Number(r.top_score);
      node.score = own === null ? sub.score : sub.score === null ? own : Math.max(own, sub.score);
      for (const b of Object.keys(node.by_band) as (keyof GroupNode["by_band"])[]) node.by_band[b] = (r[b] as number) + sub.bands[b];
      node.next_deadline = [r.next_deadline, sub.next].filter(Boolean).sort()[0] ?? null;
      node.needs_review = r.review + sub.review;

      total += node.total_count;
      rank = Math.min(rank, best);
      if (node.score !== null) score = score === null ? node.score : Math.max(score, node.score);
      for (const b of Object.keys(bands) as (keyof GroupNode["by_band"])[]) bands[b] += node.by_band[b];
      if (node.next_deadline && (!next || node.next_deadline < next)) next = node.next_deadline;
      review += node.needs_review;
    }
    return { total, rank, score, bands, next, review };
  };
  walk(null, 1, []);
  return out;
}

/** Ids of a group and all of its descendants (from an already loaded tree). */
export function subtreeIds(tree: GroupNode[], id: string): string[] {
  const ids = [id];
  for (let i = 0; i < ids.length; i++) {
    for (const g of tree) if (g.parent_group_id === ids[i]) ids.push(g.id);
  }
  return ids;
}

/** SQL condition: `column` is the group with id `$param` or one of its sub-groups. */
export function inGroupSubtreeSql(column: string, param: string): string {
  return `${column} IN (
    WITH RECURSIVE sub AS (
      SELECT id FROM regulation_groups WHERE id = ${param}::uuid
      UNION ALL
      SELECT rg.id FROM regulation_groups rg JOIN sub ON rg.parent_group_id = sub.id
    ) SELECT id FROM sub
  )`;
}

/**
 * Checks that `groupId` (null for a new group) can sit under `parentId`
 * without creating a loop or going deeper than MAX_GROUP_DEPTH.
 * Returns an error message, or null when it is allowed.
 */
export function checkParent(tree: GroupNode[], groupId: string | null, parentId: string | null): string | null {
  if (!parentId) return null;
  const parent = tree.find((g) => g.id === parentId);
  if (!parent) return "Parent group not found";
  let height = 1;
  if (groupId) {
    const own = subtreeIds(tree, groupId);
    if (own.includes(parentId)) return "A group can't be moved inside itself or its own sub-groups";
    const self = tree.find((g) => g.id === groupId);
    if (self) height = Math.max(...own.map((id) => tree.find((g) => g.id === id)!.depth)) - self.depth + 1;
  }
  if (parent.depth + height > MAX_GROUP_DEPTH) {
    return `Groups can be nested at most ${MAX_GROUP_DEPTH} levels deep`;
  }
  return null;
}

/**
 * Reads the regulatory-family fields of a group form:
 *  level        "family" | "action" | "" (free-form group)
 *  group_key    e.g. US-EPA-AIM_ACT (upper-case letters, digits, - and _)
 *  identifiers  free text such as "RIN 2070-AK67, EPA-HQ-OPPT-2025-0100, 40 CFR 751, SB 1215" —
 *               parsed into identifiers so matching alerts join the group automatically.
 */
export function parseGroupFields(
  body: { level?: unknown; group_key?: unknown; identifiers_text?: unknown; labels?: unknown },
  jurisdictionRef: string | null | undefined
):
  | {
      hasLevel: boolean; level: GroupLevel | null; group_key: string | null; hasIdentifiers: boolean; identifiers: Identifier[];
      hasLabels: boolean; labels: string[];
    }
  | { error: string } {
  const hasLabels = Array.isArray(body.labels);
  const labels = hasLabels
    ? [...new Set((body.labels as unknown[]).filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean))].slice(0, 20)
    : [];
  if (labels.some((l) => l.length > 40)) return { error: "Label names are at most 40 characters" };
  const hasLevel = body.level !== undefined || body.group_key !== undefined;
  const level = body.level === "family" || body.level === "action" ? body.level : null;
  if (body.level !== undefined && body.level !== "" && body.level !== null && !level) return { error: "Level must be family or action" };
  const rawKey = typeof body.group_key === "string" ? body.group_key.trim().toUpperCase().replace(/\s+/g, "_") : "";
  if (rawKey && !/^[A-Z0-9][A-Z0-9_\-.]{1,119}$/.test(rawKey)) return { error: "Keys use letters, numbers, - and _ (e.g. US-EPA-AIM_ACT)" };
  const hasIdentifiers = typeof body.identifiers_text === "string";
  const identifiers = hasIdentifiers
    ? extractIdentifiers(String(body.identifiers_text).replace(/[,;]+/g, "\n"), jurisdictionCode(jurisdictionRef ?? null))
    : [];
  if (hasIdentifiers && String(body.identifiers_text).trim() && identifiers.length === 0) {
    return { error: "No identifiers recognised. Use e.g. RIN 2070-AK67, EPA-HQ-OPPT-2025-0100, 40 CFR 751, SB 1215, WSR 23-14-008" };
  }
  return { hasLevel, level, group_key: rawKey || null, hasIdentifiers, identifiers, hasLabels, labels };
}

/** Colours a group label can use (Tailwind palette names). */
export const GROUP_LABEL_COLORS = ["slate", "blue", "emerald", "amber", "violet", "rose", "teal", "orange"];

export interface GroupLabel { id: string; name: string; color: string }

/** The workspace's labels; a workspace with none gets Federal and State. */
export async function ensureDefaultLabels(companyId: string): Promise<GroupLabel[]> {
  let res = await query(`SELECT id, name, color FROM group_labels WHERE company_id = $1 ORDER BY created_at, name`, [companyId]);
  if (res.rowCount === 0) {
    await query(
      `INSERT INTO group_labels (company_id, name, color) VALUES ($1, 'Federal', 'blue'), ($1, 'State', 'emerald') ON CONFLICT DO NOTHING`,
      [companyId]
    );
    res = await query(`SELECT id, name, color FROM group_labels WHERE company_id = $1 ORDER BY created_at, name`, [companyId]);
  }
  return res.rows;
}

/** Adds any labels a group uses that are not in the workspace list yet. */
export async function rememberLabels(companyId: string, labels: string[]) {
  if (!labels.length) return;
  await query(
    `INSERT INTO group_labels (company_id, name)
     SELECT $1, x FROM unnest($2::text[]) AS x
     WHERE NOT EXISTS (SELECT 1 FROM group_labels g WHERE g.company_id = $1 AND lower(g.name) = lower(x))
     ON CONFLICT DO NOTHING`,
    [companyId, labels]
  );
}

/** Federal for a national US family, State for a US state family (used by automatic grouping). */
export function defaultLabelsFor(jurisdiction: string | null): string[] {
  if (!jurisdiction) return [];
  if (jurisdiction === "US") return ["Federal"];
  if (jurisdiction.startsWith("US-")) return ["State"];
  return [];
}
