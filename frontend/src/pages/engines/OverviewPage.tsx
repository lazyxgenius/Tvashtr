/**
 * Engines › Overview (Eng-Overview, Eng-OverviewWeb, Eng-Flow-Blocked-2): the two surfaces, every
 * provider the user's teams use with how each surface covers it (and the fix), the saved keys no
 * team uses, and "Can your teams run?" per team. With nothing set up yet it is the first-time
 * chooser instead (EnF-FirstTime-1).
 *
 * A row's fixes (EnF-OvAddKey, EnF-OvConnect): Add key opens the sheet with that provider; Connect
 * on Desktop says "Checking…" in the row while the sign-in runs; the row a save or a Connect just
 * changed flashes (ENG-23), and the cells, verdicts and nav badges recompute from the new data.
 */
import { Globe, Monitor, Plus } from "lucide-react";
import { Fragment, useState } from "react";

import { Button } from "../../design-system/components";
import type { SubscriptionProviderId } from "../../lib/engines";
import { formatRelativeTime } from "../../lib/time";
import {
  type Cell,
  type CellAction,
  type EngineInputs,
  type ProviderRow,
  type Verdict,
  alsoSaved,
  isFirstTime,
  providerRows,
  teamVerdicts,
} from "./engineModel";
import { useEngines } from "./enginesData";
import {
  EnginesHead,
  EnginesLoadError,
  EnginesSection,
  EnginesSkeleton,
  MonogramTile,
  StatusLine,
} from "./enginesUi";
import { FirstTimeChooser } from "./FirstTimeChooser";

const LEDE =
  "The models your agents run on. Use your own subscription on Tvashtr Desktop, or an API key anywhere.";

export interface OverviewActions {
  /** Add API key (nothing picked) or a row's Add key (that provider picked). */
  onAddKey: (provider?: string) => void;
  /** A row's Connect / Set up / Refresh / Open in Desktop. */
  onCellAction: (action: CellAction) => void;
  onOpenSubscriptions: () => void;
  /** Download Tvashtr Desktop: the Get Tvashtr Desktop dialog (ENG-47). */
  onGetDesktop: () => void;
}

/** The rows a save or a Connect just changed (ENG-23); `seq` restarts the flash. */
export interface RowFlash {
  providers: readonly string[];
  seq: number;
}

/** Rows whose subscription is being connected read "Checking…" (EnF-OvConnect-2). */
function withChecking(i: EngineInputs, checking: readonly SubscriptionProviderId[]): EngineInputs {
  if (!checking.length) return i;
  return {
    ...i,
    subs: i.subs.map((s) =>
      checking.includes(s.provider) && !s.connected ? { ...s, state: "checking" } : s,
    ),
  };
}

function DesktopStatus({ onGetDesktop }: { onGetDesktop: () => void }) {
  const { surface, runner } = useEngines();
  if (surface === "desktop") {
    return <StatusLine tone="ok">Tvashtr Desktop is open on this computer</StatusLine>;
  }
  // The website only knows the user's Desktop checked in lately, not which computer (OQ-15).
  if (runner.fresh) {
    const when = runner.last_seen_at ? formatRelativeTime(runner.last_seen_at) : "";
    return (
      <StatusLine tone="ok">
        {`Tvashtr Desktop is open on your computer${when ? ` · checked in ${when}` : ""}`}
      </StatusLine>
    );
  }
  return (
    <div className="eng-surface__status-row">
      <StatusLine tone="muted">Not open on this computer</StatusLine>
      <Button variant="secondary" size="sm" onClick={onGetDesktop}>
        Download Tvashtr Desktop
      </Button>
    </div>
  );
}

function Surfaces({ onGetDesktop }: { onGetDesktop: () => void }) {
  return (
    <div className="eng-surfaces">
      <div className="eng-surface">
        <span className="eng-surface__icon">
          <Monitor size={18} strokeWidth={1.6} aria-hidden />
        </span>
        <div className="eng-surface__body">
          <div className="eng-surface__name">Tvashtr Desktop</div>
          <div className="eng-surface__desc">
            Runs on this computer. Uses your Claude or Grok subscription first, or an API key.
          </div>
          <DesktopStatus onGetDesktop={onGetDesktop} />
        </div>
      </div>
      <div className="eng-surface">
        <span className="eng-surface__icon">
          <Globe size={18} strokeWidth={1.6} aria-hidden />
        </span>
        <div className="eng-surface__body">
          <div className="eng-surface__name">Website (hosted)</div>
          <div className="eng-surface__desc">
            Runs on Tvashtr’s servers, including Domains ingest and Ask. Needs an API key for every
            provider. Subscriptions don’t work here.
          </div>
          <StatusLine tone="ok">Always available</StatusLine>
        </div>
      </div>
    </div>
  );
}

function CellView({ cell, onAction }: { cell: Cell; onAction: (a: CellAction) => void }) {
  if (cell.tone === "ok") {
    return (
      <StatusLine tone="ok">
        {cell.text}
        {cell.suffix ? " " : null}
        {cell.suffix ? <span className="eng-muted">{cell.suffix}</span> : null}
      </StatusLine>
    );
  }
  // The only neutral cell is a Connect in progress: "Checking…".
  if (cell.tone === "neutral") return <StatusLine tone="busy">{cell.text}</StatusLine>;
  const action = cell.action;
  return (
    <StatusLine tone="warn">
      {cell.text}
      {action ? " " : null}
      {action ? (
        <Button variant="tint" size="sm" onClick={() => onAction(action)}>
          {action.label}
        </Button>
      ) : null}
    </StatusLine>
  );
}

/** Keep each row where the page first put it (rows to fix first, ENG-10): a fix changes the row in
 *  place, where its flash shows it, instead of moving it down the table; a new provider joins at
 *  the end. A new visit sorts again. */
function useStableRows(rows: ProviderRow[]): ProviderRow[] {
  const [order, setOrder] = useState<readonly string[]>([]);
  const added = rows.map((r) => r.provider).filter((p) => !order.includes(p));
  const next = added.length ? [...order, ...added] : order;
  // Remembering what an earlier render showed: React re-renders at once with the new order.
  if (next !== order) setOrder(next);
  const at = (p: string) => next.indexOf(p);
  return [...rows].sort((a, b) => at(a.provider) - at(b.provider));
}

function rowClass(row: ProviderRow, highlightFixes: boolean, flashed: boolean): string | undefined {
  if (flashed) return "eng-row--ok";
  return highlightFixes && row.needsFix ? "eng-row--fix" : undefined;
}

function ProvidersTable({
  rows,
  highlightFixes,
  flash,
  onAction,
}: {
  rows: ProviderRow[];
  highlightFixes: boolean;
  flash: RowFlash | null;
  onAction: (a: CellAction) => void;
}) {
  return (
    <table className="eng-table">
      <thead>
        <tr>
          <th scope="col">Provider</th>
          <th scope="col">Used by</th>
          <th scope="col">
            <Monitor size={12} strokeWidth={1.6} aria-hidden /> Tvashtr Desktop
          </th>
          <th scope="col">
            <Globe size={12} strokeWidth={1.6} aria-hidden /> Website (hosted)
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.provider}
            data-provider={row.provider}
            className={rowClass(
              row,
              highlightFixes,
              Boolean(flash?.providers.includes(row.provider)),
            )}
          >
            <td>
              <div className="eng-prov">
                <MonogramTile letter={row.monogram} />
                <span className="eng-prov__slug">{row.provider}</span>
              </div>
            </td>
            <td>
              <span className="eng-usedby" title={row.usedByFull}>
                {row.usedBy}
              </span>
            </td>
            <td>
              <CellView cell={row.desktop} onAction={onAction} />
            </td>
            <td>
              <CellView cell={row.website} onAction={onAction} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VerdictView({ v }: { v: Verdict }) {
  return <StatusLine tone={v.ready ? "ok" : "warn"}>{v.text}</StatusLine>;
}

export function OverviewPage({
  highlightFixes = false,
  checking = [],
  flash = null,
  onAddKey,
  onCellAction,
  onOpenSubscriptions,
  onGetDesktop,
}: OverviewActions & {
  highlightFixes?: boolean;
  /** Subscriptions a row's Connect is signing in to. */
  checking?: readonly SubscriptionProviderId[];
  flash?: RowFlash | null;
}) {
  const engines = useEngines();
  const { status, inputs } = engines;
  const rows = useStableRows(
    status === "ready" ? providerRows(withChecking(inputs, checking)) : [],
  );

  if (status !== "ready") {
    return (
      <>
        <EnginesHead title="Engines" lede={LEDE} />
        {status === "error" ? (
          <EnginesLoadError onRetry={() => void engines.refresh()} />
        ) : (
          <EnginesSkeleton />
        )}
      </>
    );
  }

  if (isFirstTime(inputs)) {
    return <FirstTimeChooser onAddKey={() => onAddKey()} onConnect={onOpenSubscriptions} />;
  }

  const also = alsoSaved(inputs);
  const verdicts = teamVerdicts(inputs);
  const hasTeams = inputs.usage.teams.length > 0;

  return (
    <>
      <EnginesHead
        title="Engines"
        lede={LEDE}
        actions={
          <>
            {/* The design puts the icon and the label in one span: no gap between them. */}
            <Button variant="secondary" className="eng-btn-inline" onClick={onOpenSubscriptions}>
              <Monitor size={15} strokeWidth={1.6} aria-hidden />
              <span>Subscriptions</span>
            </Button>
            <Button variant="primary" className="eng-btn-inline" onClick={() => onAddKey()}>
              <Plus size={15} strokeWidth={1.6} aria-hidden />
              <span>Add API key</span>
            </Button>
          </>
        }
      />
      <Surfaces onGetDesktop={onGetDesktop} />
      {(hasTeams || also.providers.length > 0) && (
        <EnginesSection title="Providers your teams use" titleId="eng-providers-title">
          {rows.length > 0 ? (
            <ProvidersTable
              rows={rows}
              highlightFixes={highlightFixes}
              flash={flash}
              onAction={onCellAction}
            />
          ) : (
            <p className="eng-empty">
              {hasTeams ? "None of your teams use a model yet." : "You have no teams yet."}
            </p>
          )}
          {also.providers.length > 0 && (
            <div className="eng-also">
              Also saved, not used by any team yet:{" "}
              {also.providers.map((p, i) => (
                <Fragment key={p}>
                  {i > 0 ? ", " : null}
                  <span className="eng-code">{p}</span>
                </Fragment>
              ))}
              {also.notes.map((note) => (
                <span key={note} className="eng-also__note">
                  {` · ${note}`}
                </span>
              ))}
            </div>
          )}
        </EnginesSection>
      )}
      {hasTeams && (
        <EnginesSection title="Can your teams run?" titleId="eng-teams-title">
          <ul className="eng-teams">
            {verdicts.map((v) => (
              <li key={v.teamId} className="eng-team">
                <span className="eng-team__name">{v.name}</span>
                <VerdictView v={v.desktop} />
                <VerdictView v={v.website} />
              </li>
            ))}
          </ul>
        </EnginesSection>
      )}
    </>
  );
}
