import { GitCompare } from "lucide-react";
import { useState } from "react";

import { ChangeSection, VersionDialog } from "../../canvas/VersionDialogs";
import { Button } from "../../design-system/components";
import { getInstructionHistory, type InstructionEntry } from "../../lib/api/versions";
import { diffPill, versionAge } from "../../lib/versionFormat";
import { glyphForNode } from "../nodeGlyph";
import { LoadState } from "../runs/RunsTab";
import { useLoaded } from "../runs/useLoaded";
import { diffLines } from "./lineDiff";

const OPS = { same: "context", add: "added", del: "removed" } as const;

/**
 * Ver-AgentCompare — an older text against the drawer's text now (the client-side line diff, 1 line
 * of context), with "Use this text".
 */
export function InstructionCompare({
  entry: e,
  agent,
  role,
  draft,
  onUse,
  onClose,
}: {
  entry: InstructionEntry;
  agent: string;
  role: string;
  draft: string;
  onUse: () => void;
  onClose: () => void;
}) {
  const diff = diffLines(e.text, draft, 1);
  const n = e.number;
  return (
    <VersionDialog
      title={`Compare v${n} with the text now`}
      icon={<GitCompare size={17} strokeWidth={1.6} aria-hidden />}
      sub={`${agent}’s instructions · v${n} was saved ${versionAge(e.created_at, Date.now(), true)}${e.from_builtin ? "" : ` by ${e.author}`}`}
      wide
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onUse}>
            Use this text
          </Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <ChangeSection
        icon={glyphForNode("agent", role)}
        name={agent}
        field="Instructions"
        pill={diffPill(diff.removed, diff.added)}
        lines={diff.rows.flatMap((r) => (r.op === "gap" ? [] : [{ op: OPS[r.op], text: r.text }]))}
      />
      <div className="nd-ihist__compare-note">
        − is in v{n}’s text, + is in the text now. Using v{n}’s text changes only these
        instructions. It becomes a draft until you save.
      </div>
    </VersionDialog>
  );
}

/**
 * M5 — the drawer's Instructions › History (Ver-AgentHistory): the versions in which this agent's
 * instructions changed, newest first, each with its added / removed lines; "Use this text" puts an
 * older text in the editor as a draft, and Compare sets it beside the text now.
 */
export function InstructionHistory({
  teamId,
  nodeId,
  version,
  agent,
  role,
  draft,
  onUse,
}: {
  teamId: string;
  nodeId: string;
  /** The team's latest version: the history is read again when it changes. */
  version?: number;
  /** The agent's name and role (the Compare dialog's heading). */
  agent: string;
  role: string;
  /** The editor's text now. */
  draft: string;
  onUse: (text: string, number: number) => void;
}) {
  const h = useLoaded(`${teamId}:${nodeId}:${version ?? ""}`, () =>
    getInstructionHistory(teamId, nodeId),
  );
  const [comparing, setComparing] = useState<InstructionEntry | null>(null);
  const v = h.value;
  return (
    <section className="nd-ihist" aria-label="Instruction history">
      <div className="nd-ihist__head">
        <span className="nd-ihist__label">Instruction history</span>
        {v && (
          <span className="nd-ihist__count">
            {v.count} version{v.count === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {v ? (
        <ol className="nd-ihist__list">
          {v.entries.map((e) => (
            <li
              key={e.number}
              className={`nd-ihist__item${e.current ? " nd-ihist__item--now" : ""}`}
            >
              <div className="nd-ihist__l1">
                <span className="nd-ihist__num">v{e.number}</span>
                {e.current && <span className="cv-now">Now</span>}
                <span className="nd-ihist__when">
                  {versionAge(e.created_at)}
                  {e.from_builtin ? "" : ` · ${e.author}`}
                </span>
              </div>
              <div className="nd-ihist__text">
                {e.first ? (
                  e.from_builtin ? (
                    `First text, from the built-in ${e.from_builtin}`
                  ) : (
                    "First text"
                  )
                ) : (
                  <>
                    {e.added.map((line, i) => (
                      <span key={`a${i}`} className="nd-ihist__line nd-ihist__line--added">
                        + {line}
                      </span>
                    ))}
                    {e.removed.map((line, i) => (
                      <span key={`r${i}`} className="nd-ihist__line nd-ihist__line--removed">
                        − {line}
                      </span>
                    ))}
                  </>
                )}
              </div>
              {!e.current && (
                <div className="nd-ihist__acts">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Use the v${e.number} text`}
                    onClick={() => onUse(e.text, e.number)}
                  >
                    Use this text
                  </Button>
                  <button
                    type="button"
                    className="cv-link"
                    aria-label={`Compare v${e.number}`}
                    onClick={() => setComparing(e)}
                  >
                    Compare
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <LoadState
          state={h.state === "error" ? "error" : "loading"}
          loading="Loading the instruction history"
          error="Couldn’t load the instruction history."
          onRetry={h.retry}
        />
      )}
      <div className="nd-ihist__note">
        Using an older text changes only these instructions. It becomes a draft until you save.
      </div>
      {comparing && (
        <InstructionCompare
          entry={comparing}
          agent={agent}
          role={role}
          draft={draft}
          onUse={() => {
            onUse(comparing.text, comparing.number);
            setComparing(null);
          }}
          onClose={() => setComparing(null)}
        />
      )}
    </section>
  );
}
