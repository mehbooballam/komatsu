function dateFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function isValidWorkspaceTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || !/^[a-z][a-z0-9_+/-]*$/i.test(timeZone)) return false;
  try {
    dateFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Calendar date shared by scoring, dashboard counts and alert filters. */
export function getWorkspaceDate(timeZone: string, now = new Date()): string {
  const frozen = process.env.COMPANY_FROZEN_DATE;
  if (frozen && /^\d{4}-\d{2}-\d{2}$/.test(frozen)) {
    const date = new Date(frozen);
    if (Number.isFinite(date.getTime()) && date.toISOString().startsWith(frozen)) return frozen;
  }

  // Previously saved workspaces may contain an invalid time zone.
  const zone = isValidWorkspaceTimeZone(timeZone) ? timeZone : "UTC";
  const parts = dateFormatter(zone).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}
