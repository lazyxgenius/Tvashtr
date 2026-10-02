import "../panel/run/live/live.css";

import {
  Check,
  History,
  Info,
  type LucideIcon,
  RotateCcw,
  Route,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { createPortal } from "react-dom";

import { Badge, Button, IconButton } from "../design-system/components";
import {
  getRestorePreview,
  getVersion,
  restoreVersion,
  type VersionChange,
} from "../lib/api/versions";
import { formatRelativeTimeWords } from "../lib/time";
import { useModalDialog } from "../lib/useModalDialog";
import { diffPill, runLook } from "../lib/versionFormat";
import { listNatural } from "../pages/home/homeFormat";
import { glyphForNode } from "../panel/nodeGlyph";
import { LoadState } from "../panel/runs/RunsTab";
import { useLoaded } from "../panel/runs/useLoaded";

type DiffLine = NonNullable<VersionChange["lines"]>[number];

/** The boards' dialog shell (the Resume confirm's): icon tile, serif title, sub, body, footer. */
export function VersionDialog({
  title,
  icon,
  sub,
  wide,
  onClose,
  children,
  footNote,
  actions,
}: {
  title: string;
  icon: ReactNode;
  sub: ReactNode;
  /** Ver-Changes / Ver-AgentCompare: 720px, 96px from the top; else Ver-Restore's 560px, centred. */
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
  footNote?: ReactNode;
  actions: ReactNode;
}) {
  const ref = useModalDialog<HTMLDivElement>(true, onClose);
  return createPortal(
    <>
      <div className="ds-scrim" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`lv-confirm ${wide ? "cv-vdlg--wide" : "cv-vdlg"}`}
        tabIndex={-1}
      >
        <header className="lv-confirm__head">
          <span className="lv-confirm__icon">{icon}</span>
          <div className="lv-confirm__titles">
            <h2 className="lv-confirm__title">{title}</h2>
            <div className="lv-confirm__sub">{sub}</div>
          </div>
          <IconButton size="sm" aria-label="Close" title="Close" onClick={onClose}>
            <X size={16} strokeWidth={1.6} aria-hidden />
          </IconButton>
        </header>
        <div className="lv-confirm__body">{children}</div>
        <footer className="lv-confirm__foot">
          <div className="lv-confirm__foot-note">{footNote}</div>
          <div className="lv-confirm__actions">{actions}</div>
        </footer>
      </div>
    </>,
    document.body,
  );
}

/**
 * One changed thing (Ver-Changes / Ver-ChangesFields / Ver-AgentCompare): "Reviewer › Instructions"
 * with its icon and pill, and the diff block when there are lines to show.
 */
export function ChangeSection({
  icon: Icon,
  name,
  field,
  pill,
  lines,
}: {
  icon: LucideIcon;
  name: string;
  field?: string | null;
  pill: string;
  lines?: DiffLine[];
}) {
  return (
    <section className="cv-dsec" aria-label={field ? `${name} › ${field}` : name}>
      <div className="cv-dsec__head">
        <span className="cv-dsec__icon">
          <Icon size={15} strokeWidth={1.6} aria-hidden />
        </span>
        <span className="cv-dsec__agent">{name}</span>
        {field && (
          <>
            <span className="cv-dsec__sep">›</span>
            <span className="cv-dsec__field">{field}</span>
          </>
        )}
        <span className="cv-pill cv-dsec__pill">{pill}</span>
      </div>
      {lines && lines.length > 0 && (
        <div className="cv-diff">
          {lines.map((l, i) => (
            <div key={i} className={`cv-diff__row cv-diff__row--${l.op}`}>
              <span className="cv-diff__mark">
                {l.op === "removed" ? "−" : l.op === "added" ? "+" : " "}
              </span>
              <span className="cv-diff__text">{l.text}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const isRoute = (c: VersionChange) => c.key.startsWith("route:");

/** A row's icon: the team's (a team field), a gate's, else the agent's role glyph. */
function glyphOf(c: VersionChange): LucideIcon {
  if (!c.agent) return Users;
  if (c.gate || c.role?.endsWith("gate")) return ShieldCheck;
  return glyphForNode("agent", c.role ?? "");
}

/** One section per change row; every route row goes into one "Routes" section where the first is. */
function ChangeRows({ changes }: { changes: VersionChange[] }) {
  const routes = changes.filter(isRoute);
  const firstRoute = changes.findIndex(isRoute);
  return changes.map((c, i) => {
    if (isRoute(c)) {
      if (i !== firstRoute) return null;
      // Added first, then removed (Ver-ChangesFields).
      const added = routes.filter((r) => r.kind === "added");
      const removed = routes.filter((r) => r.kind !== "added");
      return (
        <ChangeSection
          key="routes"
          icon={Route}
          name="Routes"
          pill={[
            added.length && `${added.length} added`,
            removed.length && `${removed.length} removed`,
          ]
            .filter(Boolean)
            .join(", ")}
          lines={[
            ...added.map((r): DiffLine => ({ op: "added", text: r.text ?? "" })),
            ...removed.map((r): DiffLine => ({ op: "removed", text: r.text ?? "" })),
          ]}
        />
      );
    }
    const icon = glyphOf(c);
    // A team field has no agent: its field is the name ("Budget").
    const name = c.agent ?? c.field ?? "";
    const field = c.agent ? c.field : null;
    if (c.kind === "text")
      return (
        <ChangeSection
          key={c.key}
          icon={icon}
          name={name}
          field={field}
          pill={diffPill(c.removed ?? 0, c.added ?? 0)}
          lines={c.lines}
        />
      );
    if (c.kind === "value") {
      const lines: DiffLine[] = [];
      if (c.before != null) lines.push({ op: "removed", text: c.before });
      if (c.after != null) lines.push({ op: "added", text: c.after });
      return (
        <ChangeSection
          key={c.key}
          icon={icon}
          name={name}
          field={field}
          pill="changed"
          lines={lines}
        />
      );
    }
    if (c.kind === "changed")
      return <ChangeSection key={c.key} icon={icon} name={name} field={field} pill="changed" />;
    // A whole agent / gate / end, added or removed.
    return (
      <ChangeSection
        key={c.key}
        icon={icon}
        name={name}
        field={c.gate ? "Gate" : null}
        pill={c.kind}
      />
    );
  });
}

/**
 * Ver-Changes / Ver-ChangesFields — What changed in vN, compared with the version before it: each
 * change, what stayed the same, the runs on it; Restore v(N-1) and Close.
 */
export function VersionChanges({
  teamId,
  number,
  current,
  onRestore,
  onClose,
}: {
  teamId: string;
  number: number;
  /** The team's latest version ("v7 is your current version"). */
  current: number;
  onRestore: (number: number) => void;
  onClose: () => void;
}) {
  const loaded = useLoaded(`${teamId}:${number}`, () => getVersion(teamId, number));
  const d = loaded.value;
  const saved = d ? `saved ${formatRelativeTimeWords(d.created_at)} by ${d.author}` : "";
  return (
    <VersionDialog
      title={`What changed in v${number}`}
      icon={<History size={17} strokeWidth={1.6} aria-hidden />}
      sub={
        d ? (d.compared_with != null ? `Compared with v${d.compared_with} · ${saved}` : saved) : ""
      }
      wide
      onClose={onClose}
      footNote={`v${current} is your current version`}
      actions={
        <>
          {d?.compared_with != null && (
            <Button
              variant="secondary"
              className="cv-btn-flush"
              onClick={() => onRestore(d.compared_with as number)}
            >
              <RotateCcw size={14} strokeWidth={1.6} aria-hidden />
              <span>Restore v{d.compared_with}</span>
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {d ? (
        <>
          <ChangeRows changes={d.changes} />
          {d.compared_with != null && d.same.length > 0 && (
            <div className="cv-vsame">
              <span className="cv-vsame__icon">
                <Check size={14} strokeWidth={2} aria-hidden />
              </span>
              Nothing else changed: {listNatural(d.same)} {d.same.length === 1 ? "is" : "are"} the
              same as v{d.compared_with}.
            </div>
          )}
          {d.runs.length > 0 && (
            <div className="cv-vruns">
              {d.runs.map((r, i) => {
                const look = runLook(r.status);
                return (
                  <div key={r.run_id} className="cv-vruns__row">
                    {i === 0 && <span className="lv-confirm__eyebrow">Runs on v{number}</span>}
                    <span className="cv-vruns__run">
                      {r.number != null ? `run #${r.number} · ${r.idea}` : r.idea}
                    </span>
                    <Badge variant={look.variant} dot>
                      {look.label}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <LoadState
          state={loaded.state === "error" ? "error" : "loading"}
          loading="Loading what changed"
          error="Couldn’t load what changed."
          onRetry={loaded.retry}
        />
      )}
    </VersionDialog>
  );
}

/**
 * Ver-Restore — Restore vN?: restoring makes a new version that matches vN (nothing is deleted;
 * runs that are going keep their version). What goes back, then Restore as v(next).
 */
export function VersionRestore({
  teamId,
  number,
  guard,
  onRestored,
  onClose,
}: {
  teamId: string;
  number: number;
  /** Run the restore through the agent drawer's unsaved guard. */
  guard: (proceed: () => void) => void;
  onRestored: () => void;
  onClose: () => void;
}) {
  const loaded = useLoaded(`${teamId}:${number}:restore`, () => getRestorePreview(teamId, number));
  const p = loaded.value;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = () => {
    if (!busy) onClose();
  };
  const restore = () =>
    guard(() => {
      setBusy(true);
      setError(null);
      restoreVersion(teamId, number).then(onRestored, (e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      });
    });
  // Only an agent's instructions are drawn in this list so far (Ver-Restore).
  const rows = p ? p.changes.filter((c) => c.kind === "text") : [];
  const count = p?.changes.length ?? 0;
  return (
    <VersionDialog
      title={`Restore v${number}?`}
      icon={<RotateCcw size={17} strokeWidth={1.6} aria-hidden />}
      sub={
        p
          ? `${p.draft_saved_as != null ? `Your changes are saved as v${p.draft_saved_as} first. ` : ""}Restoring makes a new version, v${p.makes}, that matches v${number}. v${p.current} stays in History, so you can switch back at any time.`
          : ""
      }
      onClose={cancel}
      actions={
        <>
          <Button variant="ghost" onClick={cancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="cv-btn-flush"
            loading={busy}
            disabled={!p}
            onClick={restore}
          >
            <RotateCcw size={14} strokeWidth={1.6} aria-hidden />
            <span>Restore as v{p?.makes ?? ""}</span>
          </Button>
        </>
      }
    >
      {p ? (
        <>
          {rows.length > 0 && (
            <div className="cv-vwhat">
              <span className="lv-confirm__eyebrow">What changes</span>
              <ul className="cv-vlist">
                {rows.map((c, i) => (
                  <li key={c.key}>
                    <span className="cv-vlist__icon">
                      <Info size={16} strokeWidth={1.6} aria-hidden />
                    </span>
                    <div className="cv-vlist__text">
                      <span className="cv-vlist__title">
                        {c.agent} › {c.field} go back to the v{number} text
                      </span>
                      {i === 0 && (
                        <span className="cv-vlist__sub">
                          {count} change{count === 1 ? "" : "s"}. Everything else is already the
                          same.
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="cv-file__note cv-vcallout">
            <span className="cv-file__lock">
              <Info size={18} strokeWidth={1.6} aria-hidden />
            </span>
            <div className="cv-file__note-text">
              <div className="cv-file__note-title">Runs that are going keep their version</div>
              <div className="cv-file__note-body">
                A run started on v{p.current} finishes on v{p.current}. New runs use v{p.makes}.
              </div>
            </div>
          </div>
          {error && (
            <div className="lv-confirm__error" role="alert">
              {error}
            </div>
          )}
        </>
      ) : (
        <LoadState
          state={loaded.state === "error" ? "error" : "loading"}
          loading="Loading what Restore changes"
          error="Couldn’t load what Restore changes."
          onRetry={loaded.retry}
        />
      )}
    </VersionDialog>
  );
}
