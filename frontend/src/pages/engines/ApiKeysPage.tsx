/**
 * Engines › API keys (Eng-Keys, Eng-Flow-Key-2..4, EnF-KeyUsed-1..4) — the same on the website and
 * on Tvashtr Desktop: the lede and Add key, a banner for providers the teams use without a key
 * (ENG-52), the saved keys newest first with a ⋯ menu each (Replace key / See where it’s used /
 * Remove key, ENG-53/54), and the Domains embeddings section (ENG-59, data-driven per OQ-7).
 *
 * e2e hooks: the page is `section[aria-labelledby='tv-engines-keys']` (the "API keys" h1) and each
 * saved key's provider is `[data-testid='engines-key-provider']`.
 */
import {
  BookOpen,
  ClipboardCheck,
  DraftingCompass,
  KeyRound,
  MoreHorizontal,
  Pencil,
  PenLine,
  Plus,
  Terminal,
  Trash,
  TriangleAlert,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";

import { Button, IconButton, Menu, Popover } from "../../design-system/components";
import type { SavedKey } from "../../lib/api/engines";
import { routeToHash } from "../../lib/nav";
import { useEngines } from "./enginesData";
import {
  EnginesHead,
  EnginesLoadError,
  EnginesSkeleton,
  MonogramTile,
  StatusLine,
} from "./enginesUi";
import { ReplaceKeyDialog, RemoveKeyDialog } from "./KeyDialogs";
import {
  API_KEYS_LEDE,
  type KeyRow,
  type KeyUsage,
  type UsageRow,
  embeddingsSection,
  keyRows,
  keyUsage,
  suggestedKeys,
} from "./keysModel";

export interface AddKeyOptions {
  /** The Domains embeddings "Add key": the sheet reads "Add an embeddings key" (ENG-60). */
  embeddings?: boolean;
  /** A suggested-keys banner "+ provider": the save toast reads "Add <q> too, so …" (ENG-58). */
  banner?: boolean;
  /** An Overview row's Add key: the save toast reads "… still needs <q> for the website." (ENG-18). */
  row?: boolean;
}

export interface ApiKeysActions {
  /** Add key (nothing picked), a banner "+ provider" or the embeddings Add key (that provider). */
  onAddKey: (provider?: string, options?: AddKeyOptions) => void;
}

// ---- The suggested-keys banner (ENG-52) ----

function SuggestBanner({
  providers,
  onAdd,
}: {
  providers: string[];
  onAdd: (provider: string) => void;
}) {
  return (
    <div className="eng-banner" role="note">
      <TriangleAlert size={16} strokeWidth={1.6} aria-hidden />
      <span className="eng-banner__text">
        Your teams also use{" "}
        {providers.map((p, i) => (
          <Fragment key={p}>
            {i > 0 ? (i === providers.length - 1 ? " and " : ", ") : null}
            <b>{p}</b>
          </Fragment>
        ))}
        {providers.length === 1
          ? ". Add a key to run them on the website."
          : ". Add keys to run them on the website."}
      </span>
      {providers.map((p) => (
        <Button
          key={p}
          variant="secondary"
          size="sm"
          className="eng-btn-inline"
          onClick={() => onAdd(p)}
        >
          <Plus size={13} strokeWidth={1.6} aria-hidden />
          <span>{p}</span>
        </Button>
      ))}
    </div>
  );
}

// ---- Where the <p> key is used (ENG-55) ----

function usageIcon(row: UsageRow): ReactNode {
  const p = { size: 15, strokeWidth: 1.6, "aria-hidden": true } as const;
  if (row.kind === "domain") return <BookOpen {...p} />;
  switch (row.role) {
    case "pm":
      return <PenLine {...p} />;
    case "architect":
      return <DraftingCompass {...p} />;
    case "engineer":
      return <Terminal {...p} />;
    case "reviewer":
      return <ClipboardCheck {...p} />;
    default:
      return <Pencil {...p} />;
  }
}

function usageHref(row: UsageRow): string {
  if (row.kind === "domain" || !row.teamId) return routeToHash({ page: "domains" });
  return routeToHash({ page: "team", teamId: row.teamId, node: row.nodeId });
}

function KeyUsageList({ usage }: { usage: KeyUsage }) {
  const ref = useRef<HTMLDivElement>(null);
  // Move focus into the popover so a keyboard user lands on its first Open link.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("a")?.focus();
  }, []);
  return (
    <div className="eng-usage__inner" ref={ref}>
      <div className="eng-usage__head">
        <span className="eng-usage__title">{usage.heading}</span>
      </div>
      {usage.rows.map((row, i) => (
        <div key={`${row.kind}-${row.nodeId ?? row.title}-${i}`} className="eng-usage__row">
          {usageIcon(row)}
          <div className="eng-usage__body">
            <div className="eng-usage__name">{row.title}</div>
            <div className="eng-usage__detail">{row.detail}</div>
          </div>
          <a className="eng-usage__open" href={usageHref(row)}>
            Open
          </a>
        </div>
      ))}
      {usage.rows.length === 0 && <div className="eng-usage__foot">{usage.empty}</div>}
      {usage.footer && <div className="eng-usage__foot">{usage.footer}</div>}
    </div>
  );
}

// ---- The key table (ENG-53/54) ----

function KeyActions({
  row,
  usage,
  usageOpen,
  onUsage,
  onCloseUsage,
  onReplace,
  onRemove,
}: {
  row: KeyRow;
  usage: KeyUsage | null;
  usageOpen: boolean;
  onUsage: () => void;
  onCloseUsage: () => void;
  onReplace: () => void;
  onRemove: () => void;
}) {
  const icon = { size: 15, strokeWidth: 1.6, "aria-hidden": true } as const;
  return (
    <Popover
      open={usageOpen}
      onClose={onCloseUsage}
      align="end"
      width={320}
      label={`Where the ${row.provider} key is used`}
      className="eng-usage"
      trigger={
        <Menu
          label={`More actions for ${row.provider}`}
          // The design's menu is content-box: 220px of items inside 5px padding and a 1px border.
          width={232}
          trigger={(props) => (
            <IconButton size="sm" aria-label={`More actions for ${row.provider}`} {...props}>
              <MoreHorizontal size={15} strokeWidth={1.6} aria-hidden />
            </IconButton>
          )}
          items={[
            {
              key: "replace",
              label: "Replace key",
              icon: <KeyRound {...icon} />,
              onSelect: onReplace,
            },
            {
              key: "usage",
              label: "See where it’s used",
              icon: <BookOpen {...icon} />,
              onSelect: onUsage,
            },
            "separator",
            {
              key: "remove",
              label: "Remove key",
              icon: <Trash {...icon} />,
              danger: true,
              onSelect: onRemove,
            },
          ]}
        />
      }
    >
      {usageOpen && usage ? <KeyUsageList usage={usage} /> : null}
    </Popover>
  );
}

function KeysTable({
  rows,
  usageFor,
  usage,
  setUsageFor,
  onReplace,
  onRemove,
}: {
  rows: KeyRow[];
  usageFor: string | null;
  usage: KeyUsage | null;
  setUsageFor: (p: string | null) => void;
  onReplace: (p: string) => void;
  onRemove: (p: string) => void;
}) {
  return (
    <section className="eng-card eng-card--keys" aria-label="Saved API keys">
      {rows.length === 0 ? (
        <p className="eng-empty">No API keys saved yet.</p>
      ) : (
        <table className="eng-table">
          <thead>
            <tr>
              <th scope="col">Provider</th>
              <th scope="col">Key</th>
              <th scope="col">Works on</th>
              <th scope="col">Used by</th>
              <th scope="col">Added</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.provider} data-provider={row.provider}>
                <td>
                  <div className="eng-prov">
                    <MonogramTile letter={row.monogram} />
                    <span className="eng-prov__slug" data-testid="engines-key-provider">
                      {row.provider}
                    </span>
                  </div>
                </td>
                <td>
                  <span className="eng-key__last4">{`•••• ${row.last4}`}</span>
                </td>
                <td>
                  <span className="eng-usedby">Desktop · Website</span>
                </td>
                <td>
                  <span
                    className={row.unused ? "eng-usedby eng-muted" : "eng-usedby"}
                    title={row.usedByFull || undefined}
                  >
                    {row.usedBy}
                  </span>
                </td>
                <td>
                  <span className="eng-usedby eng-muted" title={row.addedTitle}>
                    {row.added}
                  </span>
                </td>
                <td>
                  <KeyActions
                    row={row}
                    usage={usageFor === row.provider ? usage : null}
                    usageOpen={usageFor === row.provider}
                    onUsage={() => setUsageFor(row.provider)}
                    onCloseUsage={() => setUsageFor(null)}
                    onReplace={() => onReplace(row.provider)}
                    onRemove={() => onRemove(row.provider)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ---- Domains embeddings (ENG-59, OQ-7) ----

function EmbeddingsCard({ onAdd }: { onAdd: (provider: string) => void }) {
  const { inputs } = useEngines();
  const section = embeddingsSection(inputs);
  return (
    <section className="eng-card" id="engines-embeddings" aria-labelledby="eng-embeddings-title">
      <div className="eng-embed">
        <span className="eng-embed__icon">
          <BookOpen size={18} strokeWidth={1.6} aria-hidden />
        </span>
        <div className="eng-embed__body">
          <div className="eng-embed__title" id="eng-embeddings-title">
            Domains embeddings
          </div>
          <div className="eng-embed__desc">{section.description}</div>
        </div>
        <div className="eng-embed__items">
          {section.items.map((it) =>
            it.last4 ? (
              <StatusLine key={it.provider} tone="ok">
                {`${it.provider} •••• ${it.last4}`}
              </StatusLine>
            ) : (
              <div key={it.provider} className="eng-embed__item">
                <StatusLine tone="warn">{`${it.provider} not added`}</StatusLine>
                <Button variant="secondary" size="sm" onClick={() => onAdd(it.provider)}>
                  Add key
                </Button>
              </div>
            ),
          )}
        </div>
      </div>
    </section>
  );
}

// ---- The page ----

/** The current time, ticking while a key reads "Just now" so it turns into a date after a minute. */
function useNow(keys: readonly SavedKey[]): Date {
  const [now, setNow] = useState(() => new Date());
  const recent = keys.some((k) => Date.now() - new Date(k.updated_at).getTime() < 60_000);
  useEffect(() => {
    if (!recent) return;
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, [recent]);
  return now;
}

export function ApiKeysPage({ onAddKey }: ApiKeysActions) {
  const engines = useEngines();
  const { status, inputs } = engines;
  const [usageFor, setUsageFor] = useState<string | null>(null);
  const [replaceFor, setReplaceFor] = useState<string | null>(null);
  const [removeFor, setRemoveFor] = useState<string | null>(null);
  const now = useNow(inputs.keys);

  const head = (
    <EnginesHead
      title="API keys"
      titleId="tv-engines-keys"
      lede={API_KEYS_LEDE}
      actions={
        <Button variant="primary" className="eng-btn-inline" onClick={() => onAddKey()}>
          <Plus size={15} strokeWidth={1.6} aria-hidden />
          <span>Add key</span>
        </Button>
      }
    />
  );

  if (status !== "ready") {
    return (
      <section className="eng-page" aria-labelledby="tv-engines-keys">
        {head}
        {status === "error" ? (
          <EnginesLoadError onRetry={() => void engines.refresh()} />
        ) : (
          <EnginesSkeleton />
        )}
      </section>
    );
  }

  const rows = keyRows(inputs, now);
  const suggested = suggestedKeys(inputs);
  const usage = usageFor ? keyUsage(inputs, usageFor) : null;

  return (
    <section className="eng-page" aria-labelledby="tv-engines-keys">
      {head}
      {suggested.length > 0 && (
        <SuggestBanner providers={suggested} onAdd={(p) => onAddKey(p, { banner: true })} />
      )}
      <KeysTable
        rows={rows}
        usageFor={usageFor}
        usage={usage}
        setUsageFor={setUsageFor}
        onReplace={setReplaceFor}
        onRemove={setRemoveFor}
      />
      <EmbeddingsCard onAdd={(p) => onAddKey(p, { embeddings: true })} />
      <ReplaceKeyDialog provider={replaceFor} onClose={() => setReplaceFor(null)} />
      <RemoveKeyDialog provider={removeFor} onClose={() => setRemoveFor(null)} />
    </section>
  );
}
