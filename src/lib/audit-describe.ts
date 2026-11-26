/**
 * Turns raw audit events into plain-language sentences and before → after rows.
 * Pure functions, safe to use in the browser.
 */

export interface AuditEventLike {
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_values: Record<string, unknown> | null;
  after_values: Record<string, unknown> | null;
  reason: string | null;
}

export type Refs = Record<string, { kind: string; name: string }>;

/** A piece of the sentence: plain text, or an emphasised name (optionally linked). */
export type Part = string | { b: string; href?: string };

export interface Described {
  category: "alerts" | "groups" | "products" | "imports" | "scoring" | "reports" | "workspace" | "account" | "other";
  summary: Part[];
  changes: Array<{ label: string; before?: string; after?: string }>;
  note?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T/;

const LABELS: Record<string, string> = {
  title: "Name",
  name: "Name",
  display_name: "Name",
  email: "Email",
  description: "Description",
  parent_group_id: "Inside group",
  family_id: "Product family",
  product_id: "Product",
  model_code: "Model code",
  is_active: "Active",
  state: "Status",
  owner: "Owner",
  effective: "Effective owner",
  origin: "Assigned via",
  date_value: "Date",
  kind: "Type",
  verification_state: "Confirmation",
  lifecycle_state: "Status",
  time_zone: "Time zone",
  version: "Version",
  target: "Factor",
  value: "Value",
  remaining_days: "Days remaining",
  estimated_finish_date: "Estimated finish",
  relationship: "Relationship",
  alert_id: "Alert",
  local_state: "Review state",
  primary_group_id: "Group",
  direct_owner_membership_id: "Owner",
  rows: "Rows",
  filename: "File",
  format: "Format",
  path: "Group",
  image: "Image",
};

const WORDS: Record<string, string> = {
  market_access: "Market access",
  cost_to_implement: "Cost to implement",
  urgency: "Urgency",
  human_resources: "Human resources",
  total: "Total score",
  compliance: "Compliance",
  verified: "Confirmed",
  unverified: "Not confirmed",
  outstanding: "Outstanding",
  withdrawn: "Removed",
  met: "Met",
  superseded: "Replaced",
  active: "Active",
  archived: "Archived",
  direct: "Direct",
  group: "From group",
  primary: "Primary",
};

/** Fields that are bookkeeping, not something a person changed. */
const IGNORE = new Set(["record_version", "_before", "reason", "alert_ids", "errors", "alert_links", "subgroups", "models"]);

const humanize = (s: string) => {
  const t = s.replace(/[._]/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const fmtDate = (d: string) => {
  const date = new Date(ISO_DATE_RE.test(d) ? `${d}T00:00:00` : d);
  return isNaN(date.getTime())
    ? d
    : date.toLocaleDateString(undefined, ISO_DATE_RE.test(d)
        ? { day: "numeric", month: "short", year: "numeric" }
        : { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

/** Readable value: names for ids, Yes/No, dates, words for codes. */
export function formatValue(v: unknown, refs: Refs): string {
  if (v === null || v === undefined || v === "") return "None";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString();
  if (Array.isArray(v)) return v.length ? v.map((x) => formatValue(x, refs)).join(" › ") : "None";
  if (typeof v === "string") {
    if (UUID_RE.test(v)) return refs[v]?.name ?? "(deleted)";
    if (ISO_DATE_RE.test(v) || ISO_TS_RE.test(v)) return fmtDate(v);
    if (WORDS[v]) return WORDS[v];
    return v;
  }
  return JSON.stringify(v);
}

/** Rows for every field whose value differs between before and after. */
function diff(before: Record<string, unknown> | null, after: Record<string, unknown> | null, refs: Refs, skip: string[] = []) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const rows: Described["changes"] = [];
  for (const k of keys) {
    if (IGNORE.has(k) || skip.includes(k)) continue;
    const b = before?.[k];
    const a = after?.[k];
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    rows.push({
      label: LABELS[k] || humanize(k),
      before: before && k in before ? formatValue(b, refs) : undefined,
      after: after && k in after ? formatValue(a, refs) : undefined,
    });
  }
  return rows;
}

const CATEGORY: Record<string, Described["category"]> = {
  alert: "alerts",
  regulation_group: "groups",
  product: "products",
  product_family: "products",
  import_batch: "imports",
  scoring_policy: "scoring",
  risk_report: "reports",
  company: "workspace",
  invitation: "workspace",
  team: "workspace",
  user: "account",
};

/** Name of something by id, falling back to a stored name and then a generic word. */
function named(id: unknown, refs: Refs, fallback: unknown, generic: string, href?: (id: string) => string): Part {
  const s = typeof id === "string" ? id : "";
  const name = refs[s]?.name ?? (typeof fallback === "string" && fallback ? fallback : null);
  if (!name) return { b: generic };
  return refs[s] && href ? { b: name, href: href(s) } : { b: name };
}

const alertHref = (id: string) => `/alerts/${id}`;
const groupHref = (id: string) => `/alerts?group_id=${id}`;
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;

export function describeEvent(e: AuditEventLike, refs: Refs): Described {
  const before = e.before_values || null;
  const after = e.after_values || null;
  const b = (before || {}) as Record<string, unknown>;
  const a = (after || {}) as Record<string, unknown>;
  const category = CATEGORY[e.entity_type] || "other";
  const note = e.reason || undefined;
  const alert = () => named(e.entity_id, refs, null, "a deleted alert", alertHref);
  const group = (id: unknown = e.entity_id, fallback?: unknown) => named(id, refs, fallback, "a deleted group", groupHref);
  const report = (v: Record<string, unknown>) => named(e.entity_id, refs, v.title, "a deleted report", (id) => `/reports/${id}`);
  const product = (v: Record<string, unknown>) =>
    v.product_id ? named(v.product_id, refs, null, "a deleted product") : named(v.family_id, refs, null, "a deleted product family");

  switch (e.action) {
    case "user.login":
      return { category: "account", summary: ["Signed in"], changes: [] };
    case "password_changed":
      return {
        category: "account",
        summary: ["Changed their password"],
        changes: Number(a.other_sessions_ended) > 0 ? [{ label: "Other devices signed out", after: String(a.other_sessions_ended) }] : [],
      };
    case "profile_updated":
      return { category: "account", summary: ["Updated their profile"], changes: diff(before, after, refs) };
    case "member.created":
      return {
        category: "workspace",
        summary: ["Set up ", { b: String(a.name ?? a.email ?? "a member") }, a.new_account ? " as a new user" : " (existing account added)"],
        changes: [{ label: "Role", after: String(a.role ?? "").replace(/_/g, " ") }, { label: "Email", after: String(a.email ?? "") }],
      };
    case "member.revoked":
      return { category: "workspace", summary: ["Revoked the access of ", { b: String(b.name ?? b.email ?? "a member") }], changes: [] };
    case "invitation.accepted":
      return { category: "workspace", summary: ["Joined the workspace"], changes: [] };
    case "company.created":
    case "workspace_created":
      return { category: "workspace", summary: ["Created the workspace ", { b: String(a.name ?? "") }], changes: [] };
    case "workspace_updated":
      return { category: "workspace", summary: ["Updated workspace settings"], changes: diff(null, after, refs) };
    case "delete_settings_updated": {
      const names: Record<string, string> = { allow_delete_alerts: "Delete alerts", allow_delete_groups: "Delete regulation groups", allow_delete_products: "Delete products" };
      return {
        category: "workspace",
        summary: ["Changed which items can be deleted"],
        changes: Object.entries(a).map(([k, v]) => ({ label: names[k] ?? k, before: b[k] === true ? "On" : "Off", after: v === true ? "On" : "Off" })),
      };
    }
    case "workspace_branding_updated":
      return { category: "workspace", summary: ["Changed the workspace ", { b: String(a.image ?? "image").toLowerCase() }], changes: [] };
    case "workspace_branding_removed":
      return { category: "workspace", summary: ["Removed the workspace ", { b: String(a.image ?? "image").toLowerCase() }], changes: [] };

    /* ---- Alerts ---- */
    case "alerts_deleted":
      return { category: "alerts", summary: ["Deleted ", { b: plural(Number(a.deleted) || 0, "alert") }], changes: [] };
    case "alerts_deleted_all":
      return {
        category: "alerts",
        summary: ["Deleted ", { b: `all ${plural(Number(a.deleted) || 0, "alert")}` }, a.include_imports ? " and cleared the import history" : ""],
        changes: [],
      };
    case "assign_owner":
      if (e.entity_type === "regulation_group") {
        return {
          category: "groups",
          summary: [a.owner ? "Assigned group " : "Removed the owner of group ", group(), ...(a.owner ? [" to ", named(a.owner, refs, null, "a former member")] : [])],
          changes: [{ label: "Owner", before: formatValue(b.owner, refs), after: formatValue(a.owner, refs) }],
        };
      }
      return {
        category: "alerts",
        summary: a.owner ? ["Assigned ", alert(), " to ", named(a.owner, refs, null, "a former member")] : ["Removed the owner of ", alert()],
        changes: [{ label: "Owner", before: formatValue(b.owner, refs), after: formatValue(a.owner, refs) }],
      };
    case "deadline_added":
      return {
        category: "alerts",
        summary: [`Added a ${formatValue(a.kind, refs).toLowerCase()} deadline of `, { b: formatValue(a.date_value, refs) }, " to ", alert()],
        changes: a.verification_state ? [{ label: "Confirmation", after: formatValue(a.verification_state, refs) }] : [],
        note,
      };
    case "deadline_updated": {
      const what =
        a.lifecycle_state !== b.lifecycle_state
          ? a.lifecycle_state === "withdrawn" ? "Removed a deadline from "
          : a.lifecycle_state === "met" ? "Marked a deadline as met on "
          : "Updated a deadline on "
          : a.verification_state === "verified" && b.verification_state !== "verified" ? "Confirmed a deadline on "
          : "Updated a deadline on ";
      return { category: "alerts", summary: [what, alert()], changes: diff(before, after, refs), note };
    }
    case "forecast_set":
      return {
        category: "alerts",
        summary: ["Set a completion forecast on ", alert()],
        changes: diff(null, after, refs),
        note,
      };
    case "score_override": {
      const isTotal = a.target === "total";
      return {
        category: "alerts",
        summary: isTotal
          ? ["Set the total score of ", alert(), " to ", { b: formatValue(a.value, refs) }]
          : ["Changed ", { b: formatValue(a.target, refs) }, " to ", { b: formatValue(a.value, refs) }, " on ", alert()],
        // Older entries did not record the value before the change
        changes: "value" in b
          ? [{ label: formatValue(a.target, refs), before: b.value == null ? "Imported value" : formatValue(b.value, refs), after: formatValue(a.value, refs) }]
          : [],
        note,
      };
    }
    case "score_override_cleared":
      return {
        category: "alerts",
        summary: ["Removed the ", { b: formatValue(b.target, refs) }, " adjustment from ", alert()],
        changes: [{ label: formatValue(b.target, refs), before: formatValue(b.value, refs), after: "Calculated value" }],
      };
    case "score_override_reverted":
    case "score_override_restored": {
      const restored = e.action === "score_override_restored";
      return {
        category: "alerts",
        summary: [restored ? "Restored the " : "Undid the last ", { b: formatValue(a.target ?? b.target, refs) }, restored ? " adjustment on " : " change on ", alert()],
        changes: [{
          label: formatValue(a.target ?? b.target, refs),
          before: b.value == null ? "Imported value" : formatValue(b.value, refs),
          after: a.value == null ? "Imported value" : formatValue(a.value, refs),
        }],
        note,
      };
    }
    case "alert_updated":
      return { category: "alerts", summary: ["Updated ", alert()], changes: diff(before, after, refs), note };
    case "factor_confidence_set":
      return {
        category: "alerts",
        summary: ["Changed ", { b: formatValue(a.factor_key ?? b.factor_key, refs) }, " confidence on ", alert()],
        changes: [{ label: "Confidence", before: formatValue(b.confidence ?? "Imported value", refs), after: formatValue(a.confidence ?? "Imported value", refs) }],
        note,
      };
    case "human_review_flagged":
      return { category: "alerts", summary: ["Marked ", alert(), " as ", { b: "Needs review" }], changes: [], note };
    case "human_review_cleared":
      return { category: "alerts", summary: ["Marked ", alert(), " as ", { b: "reviewed" }], changes: [], note };
    case "geography_mapping_updated": {
      const countries = (value: unknown) =>
        Array.isArray(value) && value.length ? value.join(", ") : "Unmapped";
      return {
        category: "alerts",
        summary: ["Updated the country mapping for ", alert()],
        changes: [{ label: "Countries", before: countries(b.countries), after: countries(a.countries) }],
      };
    }

    /* ---- Groups ---- */
    case "link_alert":
      return { category: "groups", summary: ["Added ", named(a.alert_id, refs, null, "a deleted alert", alertHref), " to group ", group()], changes: [] };
    case "unlink_alert":
      return { category: "groups", summary: ["Removed ", named(b.alert_id, refs, null, "a deleted alert", alertHref), " from group ", group()], changes: [] };

    /* ---- Products on alerts / groups ---- */
    case "attach_product":
      return {
        category: e.entity_type === "alert" ? "alerts" : "groups",
        summary: ["Attached ", product(a), e.entity_type === "alert" ? " to " : " to group ", e.entity_type === "alert" ? alert() : group()],
        changes: [],
      };
    case "detach_product":
      return {
        category: e.entity_type === "alert" ? "alerts" : "groups",
        summary: ["Removed ", product(b), " from ", e.entity_type === "alert" ? alert() : group()],
        changes: [],
      };

    /* ---- Imports & scoring ---- */
    case "file_uploaded":
      return {
        category: "imports",
        summary: ["Uploaded ", { b: String(a.filename ?? "a file") }, a.rows != null ? ` (${plural(Number(a.rows), "row")})` : ""],
        changes: [],
      };
    case "import_completed": {
      const parts = (["created", "replaced", "updated", "unchanged", "ignored", "skipped", "invalid", "conflicts"] as const)
        .filter((k) => Number(a[k]) > 0)
        .map((k) => `${Number(a[k]).toLocaleString()} ${k}`);
      if (Number(a.added_despite_match) > 0) parts.push(`${Number(a.added_despite_match).toLocaleString()} added as new despite a match`);
      return {
        category: "imports",
        summary: ["Completed the import of ", named(e.entity_id, refs, null, "a file")],
        changes: parts.length ? [{ label: "Result", after: parts.join(", ") }] : [],
      };
    }
    case "ai_settings_updated":
      return {
        category: "workspace",
        summary: ["Changed the AI grouping settings"],
        changes: Object.entries(a).map(([k, v]) => ({ label: k.replace(/_/g, " "), after: formatValue(v, refs) })),
      };
    case "theme_grouping":
      return {
        category: "groups",
        summary: [a.automatic ? "Alerts without a regulation group were grouped by theme" : "Grouped alerts by theme", ` (${Number(a.placed ?? 0)} alerts)`],
        changes: Array.isArray(a.by_theme)
          ? (a.by_theme as Array<{ theme: string; alerts: number }>).map((t) => ({ label: t.theme, after: `${t.alerts} alert${t.alerts === 1 ? "" : "s"}` }))
          : [],
        note,
      };
    case "ai_grouping_applied":
      return {
        category: "groups",
        summary: [a.automatic ? "AI grouping was applied automatically" : "Applied AI grouping", ` (${Number(a.alerts_placed ?? 0)} alerts, ${Number(a.groups_created ?? 0)} new groups)`],
        changes: [],
        note,
      };
    case "report_ai_written":
      return { category: "reports", summary: ["Wrote ", report(a), " with AI", a.model ? ` (${String(a.model)})` : ""], changes: [] };
    case "import_cancelled":
      return { category: "imports", summary: ["Cancelled the import of ", { b: String(b.filename ?? "a file") }], changes: [] };
    case "import_mapping_changed":
      return {
        category: "imports",
        summary: ["Changed the column mapping of ", named(e.entity_id, refs, null, "an import")],
        changes: Array.isArray(a.changes)
          ? (a.changes as Array<{ header: string; before: string | null; after: string | null }>).slice(0, 20).map((c) => ({
              label: c.header,
              before: c.before ?? "Not imported",
              after: c.after ?? "Not imported",
            }))
          : [],
      };
    case "import_mapping_saved":
      return { category: "imports", summary: ["Saved the import mapping ", { b: String(a.name ?? "") }], changes: [] };
    case "import_mapping_deleted":
      return { category: "imports", summary: ["Deleted the import mapping ", { b: String(b.name ?? "") }], changes: [] };
    /* ---- Monthly reports ---- */
    case "report_created":
      return {
        category: "reports",
        summary: ["Started the monthly report ", report(a)],
        changes: a.copied_from ? [{ label: "Started from", after: "Previous month's report" }] : [],
      };
    case "report_updated":
      return { category: "reports", summary: ["Renamed the monthly report ", report(b)], changes: diff(before, after, refs) };
    case "report_published":
      return { category: "reports", summary: ["Published the monthly report ", report(a)], changes: [] };
    case "report_unpublished":
      return { category: "reports", summary: ["Moved the monthly report ", report(a), " back to draft"], changes: [] };
    case "report_deleted":
      return { category: "reports", summary: ["Deleted the draft report ", { b: String(b.title ?? "a monthly report") }], changes: [] };

    case "scoring_policy_published":
      return {
        category: "scoring",
        summary: ["Published scoring policy ", { b: `version ${a.version ?? "?"}` }, " and re-scored all alerts"],
        changes: [],
        note: typeof a.reason === "string" && a.reason ? a.reason : note,
      };
  }

  /* ---- Create / update / delete of groups, products and families ---- */
  const kindWord =
    e.entity_type === "regulation_group" ? "group"
    : e.entity_type === "product_family" ? "product family"
    : e.entity_type === "product" ? "product"
    : humanize(e.entity_type).toLowerCase();
  const nameOf = (v: Record<string, unknown>) =>
    e.entity_type === "regulation_group"
      ? group(e.entity_id, Array.isArray(v.path) ? (v.path as string[]).join(" › ") : v.title)
      : named(e.entity_id, refs, v.name ?? v.title, `a deleted ${kindWord}`);

  if (e.action === "create") {
    const where: Part[] =
      e.entity_type === "regulation_group" && a.parent_group_id ? [" inside ", group(a.parent_group_id)]
      : e.entity_type === "product" && a.family_id ? [" to ", named(a.family_id, refs, null, "a deleted family")]
      : [];
    return { category, summary: [`Added ${kindWord} `, nameOf(a), ...where], changes: [] };
  }
  if (e.action === "update") {
    return { category, summary: [`Updated ${kindWord} `, nameOf(a)], changes: diff(before, after, refs) };
  }
  if (e.action === "delete") {
    const extra: Part[] = [];
    if (Number(b.subgroups) > 0) extra.push(` and ${plural(Number(b.subgroups), "sub-group")}`);
    if (Number(b.models) > 0) extra.push(` and ${plural(Number(b.models), "model")}`);
    const changes: Described["changes"] = [];
    if (e.entity_type === "regulation_group" && Number(a.alerts_moved) > 0) {
      changes.push({ label: "Alerts moved", after: `${plural(Number(a.alerts_moved), "alert")} → ${a.alerts_moved_to ? formatValue(a.alerts_moved_to, refs) : "No group"}` });
    }
    if (Number(b.alert_links) > 0) changes.push({ label: "Removed from", after: plural(Number(b.alert_links), "alert") });
    return { category, summary: [`Deleted ${kindWord} `, nameOf(b), ...extra], changes };
  }

  /* ---- Anything else ---- */
  const subject = e.entity_id && refs[e.entity_id] ? [" · ", { b: refs[e.entity_id].name }] : [];
  return { category, summary: [humanize(e.action), ...subject], changes: diff(before, after, refs), note };
}
