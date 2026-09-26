/**
 * Toolkit › Tools › one tool (`#/toolkit/tools/<id>`). G1 ships the address with a breadcrumb back
 * to the list and the tool's name; the detail page itself (connection, remove, used by) is G8.
 */
import { useEffect, useState } from "react";

import { Button } from "../../design-system/components";
import { type ToolItem, getTool } from "../../lib/api/tools";
import { navigate } from "../../lib/nav";
import "./tools.css";

export function ToolDetailPage({ toolId }: { toolId: string }) {
  const [tool, setTool] = useState<ToolItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setTool(null);
    setError(null);
    getTool(toolId)
      .then((t) => live && setTool(t))
      .catch(
        (e: unknown) =>
          live && setError(e instanceof Error ? e.message : "Couldn’t load this tool."),
      );
    return () => {
      live = false;
    };
  }, [toolId]);

  return (
    <>
      <nav className="tk-crumbs" aria-label="Breadcrumb">
        <button
          type="button"
          className="tk-crumbs__link"
          onClick={() => navigate({ page: "tools", view: "installed" })}
        >
          Tools
        </button>
        <span aria-hidden="true">/</span>
        <span>{tool?.name ?? "…"}</span>
      </nav>
      {error ? (
        <section className="tk-card">
          <div className="tk-state" role="alert">
            <span>{error}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate({ page: "tools", view: "installed" })}
            >
              Back to tools
            </Button>
          </div>
        </section>
      ) : (
        <div className="tk-head">
          <h1 className="tk-head__title">{tool?.name ?? ""}</h1>
        </div>
      )}
    </>
  );
}
