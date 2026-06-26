/** Humanize a raw role/outcome token: "changes_requested" -> "Changes requested". A tiny shared
 *  helper — the run-view SidePanel header (`nodeTitle`) and the LastRun outcome labels both use it. */
export function titleCase(raw: string): string {
  const spaced = raw.replace(/[_-]+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : raw;
}
