/**
 * Deleting is switched on or off per type in Settings › Workspace (administrators).
 * All three are off by default: the delete buttons are hidden and the server refuses.
 * Browser-safe; the server check is `deletionAllowed` in lib/delete-settings-server.
 */

export type DeleteKind = "alerts" | "groups" | "products";

export const DELETE_KINDS: DeleteKind[] = ["alerts", "groups", "products"];

/** Key in companies.settings */
export const DELETE_SETTING_KEY: Record<DeleteKind, string> = {
  alerts: "allow_delete_alerts",
  groups: "allow_delete_groups",
  products: "allow_delete_products",
};

export const DELETE_LABELS: Record<DeleteKind, { title: string; hint: string; off: string }> = {
  alerts: {
    title: "Delete alerts",
    hint: "Administrators and managers can delete selected alerts; administrators can also delete all alerts. Deleted alerts and their notes, scores and deadlines cannot be restored.",
    off: "Deleting alerts is turned off in Settings › Workspace",
  },
  groups: {
    title: "Delete regulation groups",
    hint: "Administrators and managers can delete groups. Their alerts move to the parent group or become ungrouped; the group is kept in the history.",
    off: "Deleting groups is turned off in Settings › Workspace",
  },
  products: {
    title: "Delete products",
    hint: "Administrators and managers can delete product families and models. They are removed from every alert and group.",
    off: "Deleting products is turned off in Settings › Workspace",
  },
};

/** Whether deleting this type is switched on in the workspace settings. */
export function isDeleteAllowed(settings: Record<string, unknown> | null | undefined, kind: DeleteKind): boolean {
  return settings?.[DELETE_SETTING_KEY[kind]] === true;
}
