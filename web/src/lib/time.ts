const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Jira writes offsets as +0000; normalise so every engine parses them. */
export function parseJiraDate(iso: string): Date {
  return new Date(iso.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}

export function timeAgo(iso: string, now: Date = new Date()): string {
  const d = parseJiraDate(iso);
  if (Number.isNaN(d.getTime())) return "";
  const secs = (now.getTime() - d.getTime()) / 1000;
  if (secs < 45) return "now";
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h`;
  if (secs < 14 * 86_400) return `${Math.floor(secs / 86_400)}d`;
  const base = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return d.getUTCFullYear() === now.getUTCFullYear() ? base : `${base}, ${d.getUTCFullYear()}`;
}
