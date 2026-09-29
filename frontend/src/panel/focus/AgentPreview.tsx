import { useEffect, useState } from "react";

import { Badge, Button } from "../../design-system/components";
import {
  type ContextPreview,
  type ContextPreviewDraft,
  type ContextSkill,
  previewNodeContext,
} from "../../lib/api/nodes";
import { MODE_LABELS, type SkillMode } from "../skills/nodeSkills";
import { FocusSubView } from "./FocusSubView";

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; preview: ContextPreview };

/** Long parts show their first lines, then "…" and Show all (FOCUS-41). */
const MAX_LINES = 6;

const tokens = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "token" : "tokens"}`;

/** The section marker the executor puts first ("--- ORIGINAL IDEA ---"): the card's label says it. */
const body = (text: string) => text.replace(/^\n+/, "").replace(/^--- [^\n]+ ---\n+/, "");

const alwaysOn = (s: ContextSkill) => s.mode === "always";

function modeLine(s: ContextSkill): string {
  if (s.fetched_at_run_time) return `${s.name} · fetched when the team runs`;
  const mode = MODE_LABELS[s.mode as SkillMode] ?? "Agent decides";
  return [`${s.name} · ${mode}`, ...s.triggers].join(" ");
}

function lede(preview: ContextPreview | null): string {
  const default_ =
    "Read-only. Built from the last run’s idea and spec, plus your current instructions and always-on skills.";
  if (!preview) return default_;
  const spec = preview.parts.some((p) => p.key === "spec");
  if (!preview.source_run) {
    return spec
      ? "Read-only. No run yet, so the idea and the spec are placeholders. The rest is your current setup."
      : "Read-only. No run yet, so the idea is a placeholder. The rest is your current setup.";
  }
  const skills = preview.skills.some(alwaysOn);
  return (
    `Read-only. Built from the last run’s idea${spec ? " and spec" : ""}, plus your current ` +
    `instructions${skills ? " and always-on skills" : ""}.`
  );
}

/**
 * "Preview as the agent sees it" (Focus-AgentSees, FOCUS-40..44): the first-round context the
 * executor compiles for this agent with the unsaved draft applied (POST …/context-preview), as
 * numbered read-only cards in the order the agent receives them (spec OQ-1: your instructions come
 * first), then its skills, each with its size, and the budget and notes last.
 */
export function AgentPreview({
  teamId,
  nodeId,
  draft,
  onBack,
}: {
  teamId: string;
  nodeId: string;
  draft: ContextPreviewDraft;
  onBack: () => void;
}) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Rebuild only when what the preview compiles actually changes.
  const draftKey = JSON.stringify(draft);

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    previewNodeContext(teamId, nodeId, JSON.parse(draftKey) as ContextPreviewDraft)
      .then((preview) => {
        if (live) setState({ status: "ready", preview });
      })
      .catch((e: unknown) => {
        if (live) {
          setState({
            status: "error",
            message: e instanceof Error && e.message ? e.message : "Couldn’t build the preview.",
          });
        }
      });
    return () => {
      live = false;
    };
  }, [teamId, nodeId, draftKey, attempt]);

  const preview = state.status === "ready" ? state.preview : null;
  return (
    <FocusSubView
      variant="preview"
      title="Preview as the agent sees it"
      lede={lede(preview)}
      onBack={onBack}
    >
      {state.status === "loading" && (
        <p className="fx-preview__status" role="status">
          Building what the agent sees…
        </p>
      )}
      {state.status === "error" && (
        <div className="fx-preview__status">
          <p role="alert">{state.message}</p>
          <Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      )}
      {preview && <PreviewCards preview={preview} />}
    </FocusSubView>
  );
}

function PreviewCards({ preview }: { preview: ContextPreview }) {
  const always = preview.skills.filter(alwaysOn);
  const others = preview.skills.filter((s) => !alwaysOn(s));
  const cards = preview.parts.map((part) => ({
    part: part.key,
    label: part.label,
    source: part.source.label ?? "",
    text: body(part.text),
    tokens: part.tokens,
    placeholder: part.placeholder,
  }));
  if (always.length > 0) {
    cards.push({
      part: "skills",
      label: "Always-on skills",
      source: always.map((s) => s.name).join(", "),
      text: always
        .map((s) => s.content?.trim() || `${s.name}: fetched when the team runs.`)
        .join("\n\n"),
      tokens: preview.skills_tokens,
      placeholder: false,
    });
  }
  if (others.length > 0) {
    cards.push({
      part: "skills-listed",
      label: "Skills it can load",
      source: "listed, loaded when needed",
      text: others.map(modeLine).join("\n"),
      tokens: 0,
      placeholder: false,
    });
  }
  return (
    <>
      {cards.map((card, i) => (
        <PreviewCard key={`${card.part}-${i}`} n={i + 1} {...card} />
      ))}
      <div className="fx-preview__foot">
        <p>
          About {tokens(preview.total_tokens)} of its {tokens(preview.budget)} budget
          {preview.over_budget ? ": over budget." : "."}
        </p>
        {preview.notes.length > 0 && (
          <ul>
            {preview.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function PreviewCard({
  n,
  label,
  source,
  text,
  tokens: size,
  placeholder,
  part,
}: {
  n: number;
  label: string;
  source: string;
  text: string;
  tokens: number;
  placeholder: boolean;
  /** The part's key (`node_prompt` = your instructions, tinted as the design draws it). */
  part: string;
}) {
  const [open, setOpen] = useState(false);
  const lines = text.split("\n");
  const long = lines.length > MAX_LINES;
  const shown = long && !open ? `${lines.slice(0, MAX_LINES).join("\n")}\n…` : text;
  return (
    <section
      className={`fx-part${part === "node_prompt" ? " fx-part--yours" : ""}`}
      aria-label={label}
    >
      <div className="fx-part__head">
        <span className="fx-part__n" aria-hidden>
          {n}
        </span>
        <span className="fx-part__label">{label}</span>
        {source && <span className="fx-part__source">{source}</span>}
        {placeholder && <Badge variant="neutral">Placeholder</Badge>}
        <span className="fx-part__end">
          {size > 0 && <span className="fx-part__tokens">about {tokens(size)}</span>}
          {long && (
            <button type="button" className="fx-part__more" onClick={() => setOpen((o) => !o)}>
              {open ? "Show less" : `Show all ${lines.length} lines`}
            </button>
          )}
        </span>
      </div>
      <pre className="fx-part__text">{shown}</pre>
    </section>
  );
}
