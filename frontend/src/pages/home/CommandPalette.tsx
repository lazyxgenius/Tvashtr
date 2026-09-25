import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  History,
  KeyRound,
  Layers,
  Play,
  Plus,
  Search,
  ShieldCheck,
  TriangleAlert,
  Wrench,
} from "lucide-react";

import { type DomainSummary, listDomains, type TeamSummary } from "../../lib/api";
import {
  getInboxBrief,
  type InboxBrief,
  listRunsBrief,
  type RunBrief,
} from "../../lib/api/homeSearch";
import { listTeams } from "../../lib/api/teams";
import { requestHomeAction } from "../../lib/homeActions";
import { navigate } from "../../lib/nav";
import { useModalDialog } from "../../lib/useModalDialog";
import { buildPaletteGroups, type PaletteIcon, type PaletteTarget } from "./paletteItems";
import "./teams.css";

const ICONS: Record<PaletteIcon, (p: { size: number; strokeWidth: number }) => ReactNode> = {
  approval: (p) => <ShieldCheck {...p} aria-hidden />,
  failed: (p) => <TriangleAlert {...p} aria-hidden />,
  run: (p) => <Play {...p} aria-hidden />,
  plus: (p) => <Plus {...p} aria-hidden />,
  key: (p) => <KeyRound {...p} aria-hidden />,
  toolkit: (p) => <Wrench {...p} aria-hidden />,
  engines: (p) => <KeyRound {...p} aria-hidden />,
  team: (p) => <Layers {...p} aria-hidden />,
  history: (p) => <History {...p} aria-hidden />,
  domain: (p) => <BookOpen {...p} aria-hidden />,
};

function go(target: PaletteTarget): void {
  switch (target.kind) {
    case "team":
      navigate({ page: "team", teamId: target.teamId });
      return;
    case "run":
      navigate({ page: "team", teamId: target.teamId, runId: target.runId });
      return;
    case "new-run":
      requestHomeAction({ kind: "new-run", teamId: target.teamId });
      return;
    case "new-team":
      requestHomeAction({ kind: "new-team" });
      return;
    case "api-keys":
      navigate({ page: "engines", tab: "keys" });
      return;
    case "engines":
      navigate({ page: "engines", tab: "overview" });
      return;
    case "toolkit":
      navigate({ page: "tools", view: "installed" });
      return;
    case "domains":
      // Domains has no per-domain address yet, so this opens the Domains page.
      navigate({ page: "domains" });
      return;
  }
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [inbox, setInbox] = useState<InboxBrief[]>([]);
  const [runs, setRuns] = useState<RunBrief[]>([]);
  const [active, setActive] = useState(0);
  const listId = useId();
  const optId = (i: number) => `${listId}-opt-${i}`;
  const ref = useModalDialog<HTMLDivElement>(true, onClose);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void listTeams()
      .then((t) => live && setTeams(t))
      .catch(() => undefined);
    void listDomains()
      .then((d) => live && setDomains(d))
      .catch(() => undefined);
    void getInboxBrief()
      .then((i) => live && setInbox(i))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // Runs are searched on the server (the list is paged), debounced.
  const q = query.trim();
  useEffect(() => {
    if (!q) {
      setRuns([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      void listRunsBrief({ q, limit: 5 })
        .then((r) => live && setRuns(r))
        .catch(() => live && setRuns([]));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  const groups = useMemo(
    () => buildPaletteGroups({ query, teams, runs, domains, inbox }),
    [query, teams, runs, domains, inbox],
  );
  const flat = groups.flatMap((g) => g.options);
  const current = Math.min(active, Math.max(0, flat.length - 1));

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[id="${CSS.escape(`${listId}-opt-${current}`)}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [current, listId]);

  const choose = (i: number) => {
    const opt = flat[i];
    if (!opt) return;
    onClose();
    go(opt.target);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      // ⌘K again closes the palette.
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(current);
    }
  };

  let index = -1;
  return (
    <>
      <div className="ds-scrim" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Search and actions"
        className="hm-cmdk"
        tabIndex={-1}
      >
        <div className="hm-cmdk__bar">
          <Search size={17} strokeWidth={1.6} aria-hidden />
          <input
            className="hm-cmdk__input"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={flat.length ? optId(current) : undefined}
            aria-label="Search teams, runs and actions"
            placeholder="Search teams, runs and actions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          <span className="hm-cmdk__esc">esc</span>
        </div>
        <div
          className="hm-cmdk__list"
          role="listbox"
          id={listId}
          ref={listRef}
          aria-label="Results"
        >
          {flat.length === 0 ? (
            <div className="hm-cmdk__none">
              Nothing matches “{q}”. Try a team name, a run, or an action like “new team”.
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.label} role="group" aria-label={g.label}>
                <div className="hm-cmdk__group" aria-hidden="true">
                  {g.label}
                </div>
                {g.options.map((o) => {
                  index += 1;
                  const i = index;
                  return (
                    <div
                      key={o.id}
                      id={optId(i)}
                      role="option"
                      aria-selected={i === current}
                      className="hm-cmdk__opt"
                      onMouseMove={() => i !== current && setActive(i)}
                      onClick={() => choose(i)}
                    >
                      <span className="hm-cmdk__icon">
                        {ICONS[o.icon]({ size: 15, strokeWidth: 1.6 })}
                      </span>
                      <span className="hm-cmdk__label">{o.label}</span>
                      <span className="hm-cmdk__hint">{o.hint}</span>
                      <span className="hm-cmdk__end">
                        {o.kbd && <kbd className="hm-cmdk__kbd">{o.kbd}</kbd>}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="hm-cmdk__foot">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </>
  );
}

/**
 * ⌘K (HmF-CmdK-1…3, TEAMS-49–54): search teams, runs and domains, and run actions, from anywhere
 * in the dashboard. ↑/↓ move across every group, ↵ opens, Esc closes; hovering moves the selection.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return createPortal(<PaletteBody onClose={onClose} />, document.body);
}
