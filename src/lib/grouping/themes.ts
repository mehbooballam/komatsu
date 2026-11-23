import { query } from "@/lib/db";
import { keySegment } from "./identifiers";

/**
 * Regulatory themes.
 *
 * An alert's theme is its first Daptic topic (the same rule the regulation risk scorer uses:
 * "Electromagnetic Compatibility (EMC)", "Global Chemical Regulations", "Battery Regulations" …).
 * Alerts with no topic have no theme ("Unclassified") and are never grouped by theme.
 *
 * Theme grouping is a fallback: alerts that neither the rules nor AI could place in a regulation
 * group go into one group per theme, so nothing is left loose. Alerts grouped by hand are never moved.
 */

export const THEME_LABEL = "Theme";
export const themeGroupKey = (theme: string) => `THEME-${keySegment(theme)}`.slice(0, 120);
export const themeGroupTitle = (theme: string) => `Theme: ${theme}`.slice(0, 120);

/** First topic of a Daptic topic_match value ("A | B | C" or "A; B"). */
export function themeOf(topicMatch: string | null | undefined): string | null {
  const first = (topicMatch ?? "").split(/[|;]/).map((t) => t.trim()).find(Boolean);
  return first ? first.slice(0, 200) : null;
}

/** Keeps alerts.theme in step with alerts.topic_match (after imports). */
export async function refreshThemes(companyId: string) {
  await query(
    `UPDATE alerts SET theme = NULLIF(trim(split_part(replace(COALESCE(topic_match, ''), ';', '|'), '|', 1)), '')
     WHERE company_id = $1 AND theme IS DISTINCT FROM NULLIF(trim(split_part(replace(COALESCE(topic_match, ''), ';', '|'), '|', 1)), '')`,
    [companyId]
  );
}

export interface ThemeResult {
  placed: number;
  groups_created: number;
  by_theme: Array<{ theme: string; alerts: number }>;
  no_theme: number;
}

/**
 * Places alerts in their theme group (creating it when needed).
 * alertIds: only these alerts (when still ungrouped); null = every ungrouped alert.
 */
export async function groupByTheme(
  companyId: string,
  opts: { alertIds?: string[] | null; membershipId: string | null; comment?: string; reason?: string }
): Promise<ThemeResult> {
  await refreshThemes(companyId);
  const res = await query(
    `SELECT id, theme FROM alerts
     WHERE company_id = $1 AND archived_at IS NULL AND primary_group_id IS NULL
       AND grouping_method IS DISTINCT FROM 'manual'
       ${opts.alertIds ? "AND id = ANY($2::uuid[])" : ""}`,
    opts.alertIds ? [companyId, opts.alertIds] : [companyId]
  );
  const result: ThemeResult = { placed: 0, groups_created: 0, by_theme: [], no_theme: 0 };
  const byTheme = new Map<string, string[]>();
  for (const r of res.rows) {
    if (!r.theme) {
      result.no_theme++;
      continue;
    }
    if (!byTheme.has(r.theme)) byTheme.set(r.theme, []);
    byTheme.get(r.theme)!.push(r.id);
  }
  if (!byTheme.size) return result;

  const comment = opts.comment?.trim();
  for (const [theme, ids] of byTheme) {
    // Reuse the theme's group (also one a person renamed), otherwise create it
    const key = themeGroupKey(theme);
    let groupId: string | null =
      (await query(`SELECT id FROM regulation_groups WHERE company_id = $1 AND group_key = $2 AND state <> 'archived'`, [companyId, key])).rows[0]?.id ?? null;
    if (!groupId) {
      const ins = await query(
        `INSERT INTO regulation_groups (company_id, title, group_key, auto_created, description, labels)
         VALUES ($1, $2, $3, TRUE, $4, $5) RETURNING id`,
        [
          companyId,
          themeGroupTitle(theme),
          key,
          `Regulatory theme “${theme}”. Holds alerts on this theme that no regulation group was found for — move them into a regulation group when one exists.`,
          [THEME_LABEL],
        ]
      );
      groupId = ins.rows[0].id;
      result.groups_created++;
    }
    const basis = opts.reason ?? `Theme “${theme}” — no regulation group was found for this alert`;
    const upd = await query(
      `UPDATE alerts SET primary_group_id = $2, grouping_method = 'theme', grouping_confidence = NULL, grouping_basis = $3,
              grouping_reviewed = TRUE, record_version = record_version + 1
       WHERE company_id = $1 AND id = ANY($4::uuid[]) AND primary_group_id IS NULL AND grouping_method IS DISTINCT FROM 'manual'
       RETURNING id`,
      [companyId, groupId, basis, ids]
    );
    const placed: string[] = upd.rows.map((r) => r.id);
    if (!placed.length) continue;
    await query(
      `INSERT INTO alert_notes (company_id, alert_id, author_membership_id, body, visibility, kind, action)
       SELECT $1, x, $2, $3, 'team', 'change', $4 FROM unnest($5::uuid[]) AS x`,
      [companyId, opts.membershipId, `${basis}${comment ? ` — ${comment}` : ""}`, `Grouped by theme into ${themeGroupTitle(theme)}`, placed]
    );
    await query(
      `UPDATE alert_active_projections p
       SET effective_owner_id = COALESCE(a.direct_owner_membership_id, rg.owner_membership_id), updated_at = NOW()
       FROM alerts a LEFT JOIN regulation_groups rg ON rg.id = a.primary_group_id
       WHERE p.alert_id = a.id AND a.id = ANY($1::uuid[])`,
      [placed]
    );
    result.placed += placed.length;
    result.by_theme.push({ theme, alerts: placed.length });
  }

  if (result.placed) {
    await query(
      `INSERT INTO audit_events (company_id, actor_membership_id, actor_system, action, entity_type, entity_id, after_values, reason)
       VALUES ($1, $2, $3, 'theme_grouping', 'company', $1, $4, $5)`,
      [companyId, opts.membershipId, opts.membershipId ? null : "grouping", JSON.stringify({ automatic: !opts.membershipId, ...result }), comment ?? null]
    );
  }
  return result;
}
