import { query } from "@/lib/db";

/** Groups can nest: group › sub-group › sub-sub-group › level 4. */
export const MAX_GROUP_DEPTH = 4;

const PRIORITY_RANK: Record<string, number> = { critical: 1, high: 2, moderate: 3, low: 4 };

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
            COALESCE(c.cnt, 0)::int AS alert_count, c.top_rank
     FROM regulation_groups rg
     LEFT JOIN memberships m ON m.id = rg.owner_membership_id AND m.company_id = rg.company_id
     LEFT JOIN user_profiles up ON up.id = m.user_id
     LEFT JOIN (
       SELECT a.primary_group_id AS gid, COUNT(*) AS cnt,
              MIN(CASE p.effective_priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'moderate' THEN 3 WHEN 'low' THEN 4 END) AS top_rank
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
  const walk = (parent: string | null, depth: number, path: string[]): { total: number; rank: number } => {
    let total = 0;
    let rank = 99;
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
      total += node.total_count;
      rank = Math.min(rank, best);
    }
    return { total, rank };
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
