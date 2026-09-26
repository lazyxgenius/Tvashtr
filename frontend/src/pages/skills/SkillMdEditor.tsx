import { Fragment, type ReactNode, type Ref, useId, useMemo, useRef, useState } from "react";

import { Tabs } from "../../design-system/components";
import { gutterLines } from "./skillDraft";
import { type MdInline, parseSkillMarkdown } from "./skillMarkdown";

type View = "edit" | "preview";

/**
 * The SKILL.md card (TkF-NewSkill-1…3, Toolkit-SkillEditor; SKILL-23/24): Edit / Preview pill tabs,
 * a monospace editor with a line-number gutter, and the rendered markdown.
 */
export function SkillMdEditor({
  value,
  onChange,
  error,
  textareaRef,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  textareaRef?: Ref<HTMLTextAreaElement>;
}) {
  const [view, setView] = useState<View>("edit");
  const labelId = useId();
  const errorId = useId();
  const gutter = useRef<HTMLDivElement>(null);
  const lines = gutterLines(value);

  return (
    <section className="sk-ed-card" aria-labelledby={labelId}>
      <div className="sk-ed-card__body">
        <div className="sk-ed-card__head">
          <div className="sk-ed-card__label-row">
            <span id={labelId} className="sk-ed-label">
              SKILL.md
            </span>
          </div>
          <Tabs<View>
            variant="pill"
            aria-label="SKILL.md view"
            value={view}
            onChange={setView}
            items={[
              { value: "edit", label: "Edit" },
              { value: "preview", label: "Preview" },
            ]}
          />
        </div>
        {view === "edit" ? (
          <div className={error ? "sk-md sk-md--error" : "sk-md"}>
            <div ref={gutter} className="sk-md__gutter" aria-hidden="true">
              {Array.from({ length: lines }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <textarea
              ref={textareaRef}
              className="sk-md__text"
              aria-labelledby={labelId}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              // The placeholder only shows while empty; leaving it off otherwise lets the page's
              // parity measurement read the text itself, as the design draws it.
              placeholder={value ? undefined : "SKILL.md content…"}
              spellCheck={false}
              wrap="off"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onScroll={(e) => {
                if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
              }}
            />
          </div>
        ) : (
          <MarkdownPreview source={value} />
        )}
        {error && (
          <span id={errorId} className="ds-field__help ds-field__help--error" role="alert">
            {error}
          </span>
        )}
      </div>
    </section>
  );
}

function Inline({ parts }: { parts: MdInline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "code" ? (
          <code key={i} className="sk-mdp__code">
            {p.text}
          </code>
        ) : p.kind === "strong" ? (
          <strong key={i}>{p.text}</strong>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}

/** Preview (TkF-NewSkill-3): the design's h1 in the display face and "•" rows on 14px text. */
function MarkdownPreview({ source }: { source: string }) {
  const blocks = useMemo(() => parseSkillMarkdown(source), [source]);
  if (blocks.length === 0) {
    return (
      <div className="sk-mdp">
        <p className="sk-mdp__empty">Nothing to preview yet.</p>
      </div>
    );
  }
  return (
    <div className="sk-mdp" aria-label="SKILL.md preview">
      {blocks.map((b, i): ReactNode => {
        switch (b.kind) {
          case "heading": {
            const H = b.level <= 1 ? "h1" : b.level === 2 ? "h2" : "h3";
            return (
              <H key={i} className={`sk-mdp__h${Math.min(b.level, 3)}`}>
                <Inline parts={b.inline} />
              </H>
            );
          }
          case "bullet":
          case "number":
            return (
              <div key={i} className="sk-mdp__item">
                <span className="sk-mdp__mark">{b.kind === "bullet" ? "•" : b.marker}</span>
                <span>
                  <Inline parts={b.inline} />
                </span>
              </div>
            );
          case "code":
            return (
              <pre key={i} className="sk-mdp__pre">
                {b.text}
              </pre>
            );
          default:
            return (
              <p key={i} className="sk-mdp__p">
                <Inline parts={b.inline} />
              </p>
            );
        }
      })}
    </div>
  );
}
