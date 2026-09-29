/** Humanize a raw role/outcome token: "changes_requested" -> "Changes requested". A tiny shared
 *  helper (node titles, badge outcomes). */
export function titleCase(raw: string): string {
  const spaced = raw.replace(/[_-]+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : raw;
}
