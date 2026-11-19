import { query } from "@/lib/db";
import {
  ACTION_IDENTIFIERS, IDENTIFIER_LABELS, agencyCode, extractIdentifiers, identifiersConflict, jurisdictionCode, keySegment, similarity,
  subjectWords, versionType, type Identifier,
} from "./identifiers";

/**
 * Automatic regulatory-family grouping.
 *
 *   Family (level 1)  key = Jurisdiction-Authority-PrimaryIdentifier   e.g. US-EPA-40_CFR_751
 *   Action (level 2)  key = FamilyKey-ActionIdentifier                  e.g. US-EPA-40_CFR_751-2070_AK67
 *   Version (level 3) the alert itself (proposed rule, final rule, correction …)
 *
 * Matching, strongest first:
 *   Step 1 exact      same RIN, docket, bill, agency tracking or WTO number → same action      (100%)
 *   Step 2 strong     same jurisdiction + agency + CFR part                 → same family       (95%)
 *   Step 3 similarity same jurisdiction + agency + subject words ≥ 80% alike → same family      (80–94%, needs review)
 *
 * Only alerts that are not in a group yet, and that nobody grouped or ungrouped by hand, are placed.
 * Alerts grouped by a person are never moved, but new alerts can join them.
 */

export const SIMILARITY_THRESHOLD = 0.8;
/** Same limit as MAX_GROUP_DEPTH in lib/groups (not imported to avoid a cycle). */
const MAX_DEPTH = 4;

type Method = "exact" | "strong" | "similarity";

interface AlertRow {
  id: string;
  title: string;
  text: string;
  stage: string | null;
  jur: string | null;
  agency: string | null;
  group_id: string | null;
  method: string | null;
  ids: Identifier[];
  words: Set<string>;
}

interface GroupRow {
  id: string;
  title: string;
  parent_group_id: string | null;
  level: string | null;
  group_key: string | null;
  jur: string | null;
  ids: Identifier[];
}

interface Edge {
  to: string;
  method: Method;
  confidence: number;
  /** Plain-language reason, e.g. "Same RIN 2070-AK67" */
  why: string;
  /** For exact matches: the shared action identifier */
  ident?: Identifier;
}

export interface GroupingResult {
  scanned: number;
  identifiers: number;
  placed: { exact: number; strong: number; similarity: number };
  families_created: number;
  actions_created: number;
}

const short = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const identText = (i: Identifier) => (i.kind === "bill" ? `bill ${i.value.split(" ").slice(1).join(" ")}` : `${IDENTIFIER_LABELS[i.kind]} ${i.value}`);

function parseGroupIdentifiers(raw: unknown): Identifier[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is Identifier => !!x && typeof x === "object" && "kind" in x && "value" in x);
}

export async function runGrouping(companyId: string): Promise<GroupingResult> {
  const [alertRes, manualIdRes, groupRes] = await Promise.all([
    query(
      `SELECT a.id, a.title, a.overview, a.summary, a.source_url, a.jurisdiction_raw, a.agency_name, a.stage,
              a.primary_group_id, a.grouping_method, a.version_type
       FROM alerts a
       LEFT JOIN regulation_groups rg ON rg.id = a.primary_group_id AND rg.state <> 'archived'
       WHERE a.company_id = $1 AND a.archived_at IS NULL`,
      [companyId]
    ),
    query(`SELECT alert_id, kind, value FROM alert_identifiers WHERE company_id = $1 AND source = 'manual'`, [companyId]),
    query(
      `SELECT id, title, parent_group_id, level, group_key, jurisdiction_ref, rule_identifiers
       FROM regulation_groups WHERE company_id = $1 AND state <> 'archived'`,
      [companyId]
    ),
  ]);

  const groups = new Map<string, GroupRow>(
    groupRes.rows.map((g) => [g.id, {
      id: g.id, title: g.title, parent_group_id: g.parent_group_id, level: g.level, group_key: g.group_key,
      jur: jurisdictionCode(g.jurisdiction_ref), ids: parseGroupIdentifiers(g.rule_identifiers),
    }])
  );
  const rootOf = (id: string) => {
    let g = groups.get(id);
    for (let i = 0; g?.parent_group_id && groups.has(g.parent_group_id) && i < 8; i++) g = groups.get(g.parent_group_id);
    return g?.id ?? id;
  };

  const manualIds = new Map<string, Identifier[]>();
  for (const r of manualIdRes.rows) {
    if (!manualIds.has(r.alert_id)) manualIds.set(r.alert_id, []);
    manualIds.get(r.alert_id)!.push({ kind: r.kind, value: r.value });
  }

  // 1. Identifiers, jurisdiction, agency and version type for every alert
  const alerts = new Map<string, AlertRow>();
  let identifierCount = 0;
  const idRows: Array<[string, string, string]> = [];
  const versionUpdates: Array<[string, string]> = [];
  for (const r of alertRes.rows) {
    const jur = jurisdictionCode(r.jurisdiction_raw);
    const text = [r.title, r.overview, r.summary, r.source_url].filter(Boolean).join("\n");
    const agency = agencyCode(r.agency_name);
    const extracted = extractIdentifiers(text, jur, agency);
    const ids = [...extracted, ...(manualIds.get(r.id) || [])];
    identifierCount += extracted.length;
    for (const i of extracted) idRows.push([r.id, i.kind, i.value]);
    const vt = versionType(r.title, r.stage);
    if (vt !== r.version_type) versionUpdates.push([r.id, vt]);
    alerts.set(r.id, {
      id: r.id, title: r.title, text, stage: r.stage, jur, agency,
      // A theme group only holds alerts until a regulation group is found: treat them as ungrouped
      group_id: r.primary_group_id && r.grouping_method !== "theme" && groups.has(r.primary_group_id) ? r.primary_group_id : null,
      method: r.grouping_method, ids, words: subjectWords(r.title),
    });
  }

  // Keep the stored identifiers in step with the text (manual ones are untouched)
  await query(`DELETE FROM alert_identifiers WHERE company_id = $1 AND source = 'extracted'`, [companyId]);
  if (idRows.length) {
    await query(
      `INSERT INTO alert_identifiers (company_id, alert_id, kind, value, source)
       SELECT $1, x.alert_id, x.kind, x.value, 'extracted'
       FROM unnest($2::uuid[], $3::text[], $4::text[]) AS x(alert_id, kind, value)
       ON CONFLICT (alert_id, kind, value) DO NOTHING`,
      [companyId, idRows.map((r) => r[0]), idRows.map((r) => r[1]), idRows.map((r) => r[2])]
    );
  }
  if (versionUpdates.length) {
    await query(
      `UPDATE alerts a SET version_type = x.vt FROM unnest($1::uuid[], $2::text[]) AS x(id, vt) WHERE a.id = x.id`,
      [versionUpdates.map((v) => v[0]), versionUpdates.map((v) => v[1])]
    );
  }

  // 2. Edges between alerts
  const edges = new Map<string, Edge[]>();
  const addEdge = (a: string, b: string, e: Omit<Edge, "to">) => {
    for (const [x, y] of [[a, b], [b, a]]) {
      if (!edges.has(x)) edges.set(x, []);
      const list = edges.get(x)!;
      const existing = list.find((l) => l.to === y);
      if (!existing || existing.confidence < e.confidence) {
        if (existing) list.splice(list.indexOf(existing), 1);
        list.push({ ...e, to: y });
      }
    }
  };

  // Step 1: shared action identifiers
  const byIdent = new Map<string, string[]>();
  for (const a of alerts.values()) {
    for (const i of a.ids) {
      if (!ACTION_IDENTIFIERS.includes(i.kind)) continue;
      const k = `${i.kind}:${i.value}`;
      if (!byIdent.has(k)) byIdent.set(k, []);
      byIdent.get(k)!.push(a.id);
    }
  }
  for (const [k, list] of byIdent) {
    const [kind, ...rest] = k.split(":");
    const ident = { kind, value: rest.join(":") } as Identifier;
    for (let i = 1; i < list.length; i++) addEdge(list[0], list[i], { method: "exact", confidence: 100, why: `Same ${identText(ident)}`, ident });
    for (let i = 2; i < list.length; i++) addEdge(list[1], list[i], { method: "exact", confidence: 100, why: `Same ${identText(ident)}`, ident });
  }

  // Steps 2 and 3 compare alerts with the same jurisdiction and agency
  const buckets = new Map<string, AlertRow[]>();
  for (const a of alerts.values()) {
    if (!a.jur || !a.agency) continue;
    const k = `${a.jur}|${a.agency}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(a);
  }
  for (const list of buckets.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const cfr = a.ids.find((x) => x.kind === "cfr" && b.ids.some((y) => y.kind === "cfr" && y.value === x.value));
        if (cfr) {
          addEdge(a.id, b.id, { method: "strong", confidence: 95, why: `Same jurisdiction (${a.jur}), agency (${a.agency}) and ${cfr.value}` });
          continue;
        }
        // Different dockets/RINs etc. are different actions, however alike the titles (same CFR part above may still join a family)
        if (identifiersConflict(a.ids, b.ids)) continue;
        const sim = similarity(a.words, b.words);
        if (sim >= SIMILARITY_THRESHOLD) {
          const pct = Math.min(94, Math.round(sim * 100));
          addEdge(a.id, b.id, { method: "similarity", confidence: pct, why: `Same jurisdiction (${a.jur}) and agency (${a.agency}); subject ${pct}% similar` });
        }
      }
    }
  }

  const movable = (a: AlertRow) => !a.group_id && a.method !== "manual";
  const placements = new Map<string, { group: string; method: Method; confidence: number; basis: string }>();
  const result: GroupingResult = {
    scanned: alerts.size, identifiers: identifierCount, placed: { exact: 0, strong: 0, similarity: 0 }, families_created: 0, actions_created: 0,
  };
  const place = (a: AlertRow, group: string, method: Method, confidence: number, basis: string) => {
    a.group_id = group;
    placements.set(a.id, { group, method, confidence, basis });
    result.placed[method]++;
  };

  // 3a. Identifiers recorded on a group pull matching alerts in
  for (const a of alerts.values()) {
    if (!movable(a)) continue;
    let best: { g: GroupRow; ident: Identifier; conf: number } | null = null;
    for (const g of groups.values()) {
      for (const gi of g.ids) {
        const hit = a.ids.find((x) => x.kind === gi.kind && x.value === gi.value);
        if (!hit) continue;
        const conf = gi.kind === "cfr" ? 95 : 100;
        if (gi.kind === "cfr" && g.jur && a.jur !== g.jur) continue;
        if (!best || conf > best.conf || (conf === best.conf && g.level === "action")) best = { g, ident: hit, conf };
      }
    }
    if (best) place(a, best.g.id, best.conf === 100 ? "exact" : "strong", best.conf, `${identText(best.ident)} is recorded on “${best.g.title}”`);
  }

  // 3b. Join an already grouped alert: action edges join its group, family edges join its family
  const joinNeighbours = () => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const a of alerts.values()) {
        if (!movable(a)) continue;
        const options = (edges.get(a.id) || [])
          .filter((e) => alerts.get(e.to)?.group_id)
          .sort((x, y) => y.confidence - x.confidence);
        const e = options[0];
        if (!e) continue;
        const other = alerts.get(e.to)!;
        const target = e.method === "exact" ? other.group_id! : rootOf(other.group_id!);
        place(a, target, e.method, e.confidence, `${e.why} as “${short(other.title)}”`);
        changed = true;
      }
    }
  };
  joinNeighbours();

  // 3c. Clusters of ungrouped alerts become a new family (with an action group per shared identifier)
  const pending = [...alerts.values()].filter(movable);
  const seen = new Set<string>();
  for (const start of pending) {
    if (seen.has(start.id)) continue;
    const comp: AlertRow[] = [];
    const stack = [start.id];
    seen.add(start.id);
    while (stack.length) {
      const id = stack.pop()!;
      const a = alerts.get(id)!;
      comp.push(a);
      for (const e of edges.get(id) || []) {
        const b = alerts.get(e.to)!;
        if (!seen.has(b.id) && movable(b)) {
          seen.add(b.id);
          stack.push(b.id);
        }
      }
    }
    if (comp.length < 2) continue;

    const family = await ensureFamily(companyId, comp, groups);
    if (family.created) result.families_created++;

    // Action groups: alerts joined by the same action identifier
    const inAction = new Set<string>();
    const actionIdents = new Map<string, { ident: Identifier; members: AlertRow[] }>();
    for (const a of comp) {
      for (const e of edges.get(a.id) || []) {
        if (e.method !== "exact" || !e.ident || !comp.some((c) => c.id === e.to)) continue;
        const k = `${e.ident.kind}:${e.ident.value}`;
        if (!actionIdents.has(k)) actionIdents.set(k, { ident: e.ident, members: [] });
        const entry = actionIdents.get(k)!;
        if (!entry.members.includes(a)) entry.members.push(a);
      }
    }
    for (const { ident, members } of actionIdents.values()) {
      const free = members.filter((m) => !inAction.has(m.id));
      if (free.length < 2) continue;
      const action = await ensureAction(companyId, family.id, family.key, ident, free, groups);
      if (action.created) result.actions_created++;
      for (const m of free) {
        inAction.add(m.id);
        const other = free.find((x) => x.id !== m.id)!;
        place(m, action.id, "exact", 100, `Same ${identText(ident)} as “${short(other.title)}”`);
      }
    }
    for (const a of comp) {
      if (inAction.has(a.id)) continue;
      const e = (edges.get(a.id) || []).filter((x) => comp.some((c) => c.id === x.to)).sort((x, y) => y.confidence - x.confidence)[0];
      const other = alerts.get(e.to)!;
      place(a, family.id, e.method, e.confidence, `${e.why} as “${short(other.title)}”`);
    }
  }
  joinNeighbours();

  // 3d. Versions of the same action that already sit together in a family or free-form group
  //     get an action group inside it. They stay within the group a person chose; only alerts
  //     a person explicitly placed (method "manual") are left exactly where they are.
  const depthOf = (id: string) => {
    let d = 1;
    for (let g = groups.get(id); g?.parent_group_id && groups.has(g.parent_group_id) && d < 9; g = groups.get(g.parent_group_id)) d++;
    return d;
  };
  const together = new Map<string, { groupId: string; ident: Identifier; members: AlertRow[] }>();
  for (const [k, list] of byIdent) {
    const [kind, ...rest] = k.split(":");
    const ident = { kind, value: rest.join(":") } as Identifier;
    const byGroup = new Map<string, AlertRow[]>();
    for (const id of list) {
      const a = alerts.get(id)!;
      if (!a.group_id || a.method === "manual") continue;
      const g = groups.get(a.group_id);
      if (!g || g.level === "action") continue;
      if (!byGroup.has(g.id)) byGroup.set(g.id, []);
      byGroup.get(g.id)!.push(a);
    }
    for (const [groupId, members] of byGroup) {
      if (members.length >= 2) together.set(`${groupId}|${k}`, { groupId, ident, members });
    }
  }
  const refined = new Set<string>();
  for (const { groupId, ident, members } of together.values()) {
    const free = members.filter((m) => !refined.has(m.id) && m.group_id === groupId);
    if (free.length < 2 || depthOf(groupId) >= MAX_DEPTH) continue;
    const parent = groups.get(groupId)!;
    const parentKey = parent.group_key ?? keySegment(parent.title);
    const action = await ensureAction(companyId, groupId, parentKey, ident, free, groups);
    if (action.created) result.actions_created++;
    for (const m of free) {
      refined.add(m.id);
      const other = free.find((x) => x.id !== m.id)!;
      place(m, action.id, "exact", 100, `Same ${identText(ident)} as “${short(other.title)}”`);
    }
  }

  // 4. Save placements, with a note on each alert explaining why it was grouped
  if (placements.size) {
    const ids = [...placements.keys()];
    const rows = ids.map((id) => placements.get(id)!);
    await query(
      `UPDATE alerts a SET primary_group_id = x.gid, grouping_method = x.method, grouping_confidence = x.conf,
              grouping_basis = x.basis, grouping_reviewed = (x.method <> 'similarity'), record_version = record_version + 1
       FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::int[], $5::text[]) AS x(id, gid, method, conf, basis)
       WHERE a.id = x.id AND a.company_id = $6`,
      [ids, rows.map((r) => r.group), rows.map((r) => r.method), rows.map((r) => r.confidence), rows.map((r) => r.basis), companyId]
    );
    await query(
      `INSERT INTO alert_notes (company_id, alert_id, author_membership_id, body, visibility, kind, action)
       SELECT $1, x.id, NULL, x.basis || ' (' || x.conf || '% confidence)', 'team', 'change', 'Grouped automatically into ' || x.path
       FROM unnest($2::uuid[], $3::text[], $4::int[], $5::text[]) AS x(id, basis, conf, path)`,
      [companyId, ids, rows.map((r) => r.basis), rows.map((r) => r.confidence), rows.map((r) => groupPath(groups, r.group))]
    );
    // Alerts now follow their new group's owner when they have none of their own
    await query(
      `UPDATE alert_active_projections p
       SET effective_owner_id = COALESCE(a.direct_owner_membership_id, rg.owner_membership_id), updated_at = NOW()
       FROM alerts a LEFT JOIN regulation_groups rg ON rg.id = a.primary_group_id
       WHERE p.alert_id = a.id AND a.id = ANY($1::uuid[])`,
      [ids]
    );
  }

  await query(
    `INSERT INTO audit_events (company_id, actor_system, action, entity_type, entity_id, after_values)
     VALUES ($1, 'grouping', 'auto_grouping', 'company', $1, $2)`,
    [companyId, JSON.stringify(result)]
  );
  return result;
}

function groupPath(groups: Map<string, GroupRow>, id: string): string {
  const parts: string[] = [];
  for (let g = groups.get(id), i = 0; g && i < 8; g = g.parent_group_id ? groups.get(g.parent_group_id) : undefined, i++) parts.unshift(g.title);
  return parts.join(" › ");
}

function mostCommon<T>(items: T[], key: (t: T) => string): T | null {
  const counts = new Map<string, { item: T; n: number }>();
  for (const it of items) {
    const k = key(it);
    const c = counts.get(k) ?? { item: it, n: 0 };
    c.n++;
    counts.set(k, c);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.item ?? null;
}

/** Family key = Jurisdiction-Authority-PrimaryIdentifier; reuses a family that already has the key. */
async function ensureFamily(companyId: string, comp: AlertRow[], groups: Map<string, GroupRow>) {
  const jur = mostCommon(comp.filter((a) => a.jur), (a) => a.jur!)?.jur ?? "INTL";
  const agency = mostCommon(comp.filter((a) => a.agency), (a) => a.agency!)?.agency ?? "GEN";
  const all = comp.flatMap((a) => a.ids);
  const cfr = mostCommon(all.filter((i) => i.kind === "cfr"), (i) => i.value);
  const action = mostCommon(all.filter((i) => ACTION_IDENTIFIERS.includes(i.kind)), (i) => `${i.kind}:${i.value}`);
  const shortest = [...comp].sort((a, b) => a.title.length - b.title.length)[0];

  let primary: string;
  let title: string;
  if (cfr) {
    primary = keySegment(cfr.value);
    title = `${agency} ${cfr.value}`;
  } else if (action) {
    primary = keySegment(action.kind === "bill" ? action.value.split(" ").slice(1).join(" ") : action.value);
    title = short(shortest.title, 90);
  } else {
    // Subject words every member shares, in title order
    const common = [...shortest.words].filter((w) => comp.every((a) => a.words.has(w))).slice(0, 3);
    primary = keySegment(common.join(" ") || shortest.title.split(/\s+/).slice(0, 3).join(" "));
    title = short(shortest.title, 90);
  }
  // e.g. US-EPA-40_CFR_751, US-CA-CARB-SB_1215
  const familyKey = `${keySegment(jur).replace(/_/g, "-")}-${keySegment(agency)}-${primary}`;

  const existing = [...groups.values()].find((g) => g.group_key === familyKey);
  if (existing) return { id: existing.id, key: familyKey, created: false };

  const res = await query(
    `INSERT INTO regulation_groups (company_id, title, jurisdiction_ref, issuer, level, group_key, auto_created, description, rule_identifiers, labels)
     VALUES ($1, $2, $3, $4, 'family', $5, TRUE, $6, $7, $8) RETURNING id`,
    [companyId, title, jur === "INTL" ? null : jur, agency === "GEN" ? null : agency, familyKey,
      "Created automatically by regulatory family grouping.", JSON.stringify(cfr ? [cfr] : []),
      jur === "US" ? ["Federal"] : jur.startsWith("US-") ? ["State"] : []]
  );
  const id = res.rows[0].id;
  groups.set(id, { id, title, parent_group_id: null, level: "family", group_key: familyKey, jur: jur === "INTL" ? null : jur, ids: cfr ? [cfr] : [] });
  return { id, key: familyKey, created: true };
}

/** Action key = FamilyKey-ActionIdentifier; reuses an action that already has the key. */
async function ensureAction(companyId: string, familyId: string, familyKey: string, ident: Identifier, members: AlertRow[], groups: Map<string, GroupRow>) {
  const actionKey = `${familyKey}-${keySegment(ident.kind === "bill" ? ident.value.split(" ").slice(1).join(" ") : ident.value)}`;
  const existing = [...groups.values()].find((g) => g.group_key === actionKey);
  if (existing) return { id: existing.id, created: false };
  const shortest = [...members].sort((a, b) => a.title.length - b.title.length)[0];
  const title = short(shortest.title, 90);
  const res = await query(
    `INSERT INTO regulation_groups (company_id, parent_group_id, title, level, group_key, auto_created, description, rule_identifiers)
     VALUES ($1, $2, $3, 'action', $4, TRUE, $5, $6) RETURNING id`,
    [companyId, familyId, title, actionKey, `Created automatically: versions sharing ${identText(ident)}.`, JSON.stringify([ident])]
  );
  const id = res.rows[0].id;
  groups.set(id, { id, title, parent_group_id: familyId, level: "action", group_key: actionKey, jur: null, ids: [ident] });
  return { id, created: true };
}
