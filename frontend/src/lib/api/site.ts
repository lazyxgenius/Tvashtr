/**
 * The public website's one read (website.md B-4; docs/superpowers/plans/api/website.md):
 * `GET /api/public/site`. Shape-checked, and null on any failure, so a page renders without the
 * version or the star count rather than blanking.
 */
export interface SiteInfo {
  /** GitHub stars, or null when GitHub couldn't say. */
  stars: number | null;
  /** The latest Desktop version ("0.7.0"), or null when unknown. */
  version: string | null;
}

export async function getSiteInfo(): Promise<SiteInfo | null> {
  try {
    const res = await fetch("/api/public/site");
    if (!res.ok) return null;
    const body = (await res.json()) as { stars?: unknown; desktop?: { version?: unknown } };
    const stars = body?.stars;
    const version = body?.desktop?.version;
    return {
      stars: typeof stars === "number" && Number.isFinite(stars) ? stars : null,
      version: typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version) ? version : null,
    };
  } catch {
    return null;
  }
}
