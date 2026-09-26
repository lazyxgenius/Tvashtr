/**
 * Toolkit › Tools › Browse — the catalog. G1 lists the catalog's entries; the cards with their
 * actions (Add / Install GitHub App / Set up / Paste) come with the Browse group (G5).
 */
import { useEffect, useState } from "react";

import { Badge } from "../../design-system/components";
import { type CatalogEntry, listToolCatalog } from "../../lib/api/tools";

export function BrowseTab() {
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    listToolCatalog()
      .then((c) => live && setCatalog(c))
      .catch(() => live && setCatalog([]));
    return () => {
      live = false;
    };
  }, []);

  if (catalog === null) return <section className="tk-card" aria-busy="true" />;
  return (
    <div className="tk-catalog">
      {catalog.map((entry) => (
        <section key={entry.key} className="tk-card tk-catalog__card">
          <div className="tk-catalog__title">{entry.title}</div>
          {entry.badge && <Badge variant="neutral">{entry.badge}</Badge>}
          <p className="tk-catalog__desc">{entry.description}</p>
        </section>
      ))}
    </div>
  );
}
