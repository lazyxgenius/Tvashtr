/**
 * The Domains page with no domains yet (Dm-ListEmpty, DmF-First-1; DM-18…DM-21): the "Give your
 * agents your own documents" card, the four starting points, and — while the account holds no key
 * for any reading model — the key hint.
 */
import { BookOpen, KeyRound, Plus } from "lucide-react";

import { Button } from "../../design-system/components";
import type { DomainTemplate } from "../../lib/api/domains";
import { routeToHash } from "../../lib/nav";
import { pieceSizeLabel } from "./domainFormat";

export function DomainsEmpty({
  templates,
  showKeyHint,
  onNewDomain,
  onHowItWorks,
}: {
  /** The starting points to offer as cards (Blank is left out: it has nothing to show). */
  templates: DomainTemplate[];
  showKeyHint: boolean;
  onNewDomain: (template?: string) => void;
  onHowItWorks: () => void;
}) {
  const cards = templates.filter((t) => t.template !== "blank");
  return (
    <>
      <section className="dm-empty" aria-labelledby="dm-empty-title">
        <span className="dm-empty__tile" aria-hidden="true">
          <BookOpen size={26} strokeWidth={1.6} />
        </span>
        <h2 id="dm-empty-title" className="dm-empty__title">
          Give your agents your own documents
        </h2>
        <p className="dm-empty__body">
          Put your help docs, contracts or papers in a domain. Ask it questions and see the exact
          passage behind every answer. Then let your teams use it too.
        </p>
        <div className="dm-empty__actions">
          <Button
            variant="primary"
            size="md"
            className="dm-btn-inline"
            onClick={() => onNewDomain()}
          >
            <Plus size={15} strokeWidth={1.6} aria-hidden />
            <span>New domain</span>
          </Button>
          <Button variant="ghost" size="md" onClick={onHowItWorks}>
            How domains work
          </Button>
        </div>
      </section>
      {cards.length > 0 && (
        <>
          <div className="dm-templates__label" id="dm-templates-label">
            Or start from a template
          </div>
          <div className="dm-templates" role="group" aria-labelledby="dm-templates-label">
            {cards.map((t) => (
              <button
                key={t.template}
                type="button"
                className="dm-template"
                onClick={() => onNewDomain(t.template)}
              >
                <span className="dm-template__name">{t.name}</span>
                {t.short && <span className="dm-template__short">{t.short}</span>}
                {t.piece_size !== undefined && (
                  <span className="dm-pill">{pieceSizeLabel(t.piece_size)}</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
      {showKeyHint && (
        <div className="dm-hint">
          <span className="dm-hint__icon" aria-hidden="true">
            <KeyRound size={14} strokeWidth={1.6} />
          </span>
          <span className="dm-hint__text">
            You’ll need an API key for a reading model, like OpenAI. There’s also a free Hugging
            Face option for testing.{" "}
            <a className="dm-link" href={routeToHash({ page: "engines", tab: "keys" })}>
              Check Engines
            </a>
          </span>
        </div>
      )}
    </>
  );
}
