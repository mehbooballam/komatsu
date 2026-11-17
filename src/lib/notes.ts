/** Longest note a person can write on an alert. */
export const MAX_NOTE_LENGTH = 5000;

/** Columns for a note with its author's name and photo. */
export const NOTE_SELECT = `
  SELECT n.id, n.alert_id, n.body, n.visibility, n.created_at, n.updated_at,
         n.author_membership_id, up.display_name AS author_name,
         up.preferences->>'avatar' AS author_avatar
  FROM alert_notes n
  JOIN memberships m ON m.id = n.author_membership_id
  JOIN user_profiles up ON up.id = m.user_id`;
