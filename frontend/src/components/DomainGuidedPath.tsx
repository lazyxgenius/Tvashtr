import { useState } from "react";

type GuidedContext = "list" | "detail";

/**
 * Lightweight Idea → Domains → Team happy-path panel (#2).
 * Sits on existing Domains pages — no new routes/wizard architecture.
 */
export function DomainGuidedPath({
  context = "list",
  onNewDomain,
  onOpenEngines,
  onCreateTeam,
  onGoConfig,
  onGoDocuments,
}: {
  context?: GuidedContext;
  onNewDomain?: () => void;
  onOpenEngines?: () => void;
  onCreateTeam?: () => void;
  onGoConfig?: () => void;
  onGoDocuments?: () => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <section className="tv-domains__guided" aria-label="Guided path">
      <header className="tv-domains__guided-head">
        <div>
          <h2 className="tv-domains__guided-title">Guided path</h2>
          <p className="tv-domains__guided-lede">
            Idea → Domains → Team — create a domain, configure embed/gen, ingest, then use it
            from a team (Domains MCP or fetch).
          </p>
        </div>
        <button
          type="button"
          className="tv-btn tv-btn--ghost"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Hide" : "Show"}
        </button>
      </header>

      {open && (
        <ol className="tv-domains__guided-steps">
          <li className="tv-domains__guided-step">
            <div className="tv-domains__guided-step-body">
              <strong>Create or open a domain</strong>
              <span className="tv-domains__guided-hint">
                Pick a template (Support / Legal / …) or open an existing corpus.
              </span>
            </div>
            {context === "list" && onNewDomain && (
              <button type="button" className="tv-btn tv-btn--ghost" onClick={onNewDomain}>
                New domain
              </button>
            )}
          </li>

          <li className="tv-domains__guided-step">
            <div className="tv-domains__guided-step-body">
              <strong>Configure embed &amp; generation</strong>
              <span className="tv-domains__guided-hint">
                Config tab — pick embedding + generation presets. Add provider keys under Engines
                before ingest/Ask. Switching embed provider/dim clears embeddings.
              </span>
            </div>
            <div className="tv-domains__guided-actions">
              {context === "detail" && onGoConfig && (
                <button type="button" className="tv-btn tv-btn--ghost" onClick={onGoConfig}>
                  Open Config
                </button>
              )}
              {onOpenEngines && (
                <button type="button" className="tv-btn tv-btn--ghost" onClick={onOpenEngines}>
                  Open Engines
                </button>
              )}
            </div>
          </li>

          <li className="tv-domains__guided-step">
            <div className="tv-domains__guided-step-body">
              <strong>Upload &amp; ingest</strong>
              <span className="tv-domains__guided-hint">
                Documents tab — upload pdf/md/txt/html, then Ingest with your Engines key.
              </span>
            </div>
            {context === "detail" && onGoDocuments && (
              <button type="button" className="tv-btn tv-btn--ghost" onClick={onGoDocuments}>
                Open Documents
              </button>
            )}
          </li>

          <li className="tv-domains__guided-step">
            <div className="tv-domains__guided-step-body">
              <strong>Attach Domains MCP or fetch</strong>
              <span className="tv-domains__guided-hint">
                On a team node → Tools: enable <em>Domains MCP</em> and/or click{" "}
                <em>Attach fetch</em> so agents can retrieve from this domain.
              </span>
            </div>
          </li>

          <li className="tv-domains__guided-step">
            <div className="tv-domains__guided-step-body">
              <strong>Create or open a team</strong>
              <span className="tv-domains__guided-hint">
                New team from Home, wire a thinker/worker (or Query domain node), then launch with
                your idea.
              </span>
            </div>
            {onCreateTeam && (
              <button type="button" className="tv-btn" onClick={onCreateTeam}>
                New team
              </button>
            )}
          </li>
        </ol>
      )}
    </section>
  );
}
