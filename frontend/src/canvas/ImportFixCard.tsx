import { TriangleAlert, X } from "lucide-react";

import { CodeText } from "../components/CodeText";
import { Button, IconButton } from "../design-system/components";
import type { ImportFix } from "../lib/api/teams";
import { GithubIcon } from "../pages/home/homeIcons";

/**
 * M4 — "2 things to fix before shipping" (File-Imported): what an imported team still needs, one row
 * per fix with the place to fix it, and the server's note. Hide puts it away (the cards' chips stay).
 */
export function ImportFixCard({
  fixes,
  note,
  onFix,
  onHide,
}: {
  fixes: readonly ImportFix[];
  note: string;
  onFix: (fix: ImportFix) => void;
  onHide: () => void;
}) {
  const n = fixes.length;
  return (
    <section className="cv-fixes" aria-label="Things to fix">
      <div className="cv-fixes__head">
        <span className="cv-fixes__icon">
          <TriangleAlert size={16} strokeWidth={1.6} aria-hidden />
        </span>
        <span className="cv-fixes__title">
          {n} {n === 1 ? "thing" : "things"} to fix before shipping
        </span>
      </div>
      <IconButton
        size="sm"
        className="cv-fixes__hide"
        aria-label="Hide"
        title="Hide"
        onClick={onHide}
      >
        <X size={14} strokeWidth={1.6} aria-hidden />
      </IconButton>
      {fixes.map((f) => (
        <div key={f.key} className="cv-fixes__row">
          <span>
            <CodeText
              text={f.text}
              code={f.action === "open_toolkit" && f.target ? [f.target] : []}
            />
          </span>
          {f.action === "open_team" ? null : f.action === "sign_in" ? (
            <Button variant="secondary" size="sm" className="cv-btn-flush" onClick={() => onFix(f)}>
              {f.target === "github" && <GithubIcon size={14} />}
              <span>Sign in</span>
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => onFix(f)}>
              {f.action === "open_engines"
                ? "Open Engines"
                : f.action === "open_domains"
                  ? "Open Domains"
                  : "Open Toolkit"}
            </Button>
          )}
        </div>
      ))}
      {note && <div className="cv-fixes__note">{note}</div>}
    </section>
  );
}
