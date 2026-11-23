/** Longest note a person can write on an alert. */
export const MAX_NOTE_LENGTH = 5000;

/**
 * Columns for a note with its author's name and photo.
 * kind 'change' = a change someone made (action + their comment); no author = made by the system.
 */
export const NOTE_SELECT = `
  SELECT n.id, n.alert_id, n.body, n.visibility, n.created_at, n.updated_at, n.kind, n.action,
         n.author_membership_id, COALESCE(up.display_name, 'RiskOrbit (automatic)') AS author_name,
         up.preferences->>'avatar' AS author_avatar
  FROM alert_notes n
  LEFT JOIN memberships m ON m.id = n.author_membership_id
  LEFT JOIN user_profiles up ON up.id = m.user_id`;
