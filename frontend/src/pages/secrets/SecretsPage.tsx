/**
 * Toolkit › Secrets (`#/toolkit/secrets`; Toolkit-Secrets, TkF-SecretsEmpty-1, TkF-AddSecret-*,
 * TkF-SecretFix-*): the `${NAME}` values tools use. The header with Add secret; one warning banner
 * per name a tool uses that has no value, each with Add value; the table (Name / Used by / Updated
 * / ⋯) — missing rows with a No value badge and Add value, stored rows with a Sensitive badge,
 * the tools that use them, when they were saved and a ⋯ menu (TkF-SecretMenu-*: Replace value, See
 * tools that use it, Copy ${NAME}, Delete secret); the Engines footer; the empty, loading and error
 * states; and the secret and delete dialogs. Values are never shown (SECRET-21).
 */
import { KeyRound, Lock, Plus, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Badge, Button, useToast } from "../../design-system/components";
import { type SecretRef, type SecretsList, listSecrets } from "../../lib/api/tools";
import { refreshBadges } from "../../lib/workspaceStatus";
import { EmptyState } from "../tools/EmptyState";
import "../tools/tools.css";
import { DeleteSecretDialog } from "./DeleteSecretDialog";
import { SecretDialog, type SecretDialogMode } from "./SecretDialog";
import { SecretRowMenu } from "./SecretRowMenu";
import {
  type SecretRow,
  copiedToast,
  deletedToast,
  formatUpdated,
  missingSentence,
  orderMissing,
  orderSecretRows,
  refOf,
  replacedToast,
  savedToast,
  usedByText,
} from "./secretFormat";
import "./secrets.css";

/** The secrets list, loaded once per visit; `reload` after a change returns the new list. */
function useSecretList() {
  const [list, setList] = useState<SecretsList | null>(null);
  const [error, setError] = useState(false);
  const reload = useCallback(async (): Promise<SecretsList | null> => {
    setError(false);
    try {
      const next = await listSecrets();
      setList(next);
      return next;
    } catch {
      setError(true);
      return null;
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const retry = () => {
    setList(null);
    void reload();
  };
  return { list, error, reload, retry };
}

export function SecretsPage() {
  const { list, error, reload, retry } = useSecretList();
  const [dialog, setDialog] = useState<SecretDialogMode | null>(null);
  const [deleting, setDeleting] = useState<{ name: string; usedBy: SecretRef[] } | null>(null);
  // Names added during this visit, newest first: they stay at the top of the table. (A replaced
  // value keeps its row where it is.)
  const [fresh, setFresh] = useState<string[]>([]);
  const toast = useToast();
  const listRef = useRef(list);
  listRef.current = list;
  // What is on screen keeps its place across reloads (orderSecretRows / orderMissing).
  const shown = useRef<{ rows: string[]; banners: string[] }>({ rows: [], banners: [] });
  const banners = list ? orderMissing(list.missing, shown.current.banners) : [];
  const rows = list ? orderSecretRows(list, fresh, shown.current.rows) : [];
  shown.current = { rows: rows.map((r) => r.name), banners: banners.map((m) => m.name) };

  const onSaved = async (mode: SecretDialogMode, name: string) => {
    setDialog(null);
    const before = listRef.current;
    if (mode.kind !== "replace") setFresh((f) => [name, ...f.filter((n) => n !== name)]);
    const after = await reload();
    void refreshBadges();
    if (mode.kind === "replace") {
      toast({ message: replacedToast(name, mode.usedBy) });
      return;
    }
    const wasMissing = before?.missing.find((m) => m.name === name);
    toast({ message: savedToast(name, wasMissing, after) });
  };

  // SECRET-20: a secret a tool still uses comes back as a No value row with its banner (spec Q2).
  const onDeleted = async (name: string, usedBy: SecretRef[]) => {
    setDeleting(null);
    setFresh((f) => f.filter((n) => n !== name));
    await reload();
    void refreshBadges();
    toast({ message: deletedToast(name, usedBy) });
  };

  // SECRET-15: the literal ${NAME}, for pasting into a tool's config.
  const copyRef = async (name: string) => {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(refOf(name));
      toast({ message: copiedToast(name) });
    } catch {
      toast({ message: `Couldn’t copy ${refOf(name)}.`, tone: "error" });
    }
  };

  const addValue = (name: string) => setDialog({ kind: "add-prefilled", name });

  return (
    <>
      <div className="tk-head">
        <div>
          <h1 className="tk-head__title">Secrets</h1>
          <p className="tk-head__lede">
            Values your tools use as {"${NAME}"}. Stored encrypted for your account. Once saved, a
            value is never shown again.
          </p>
        </div>
        <div className="tk-head__actions">
          <Button className="tk-btn-inline" onClick={() => setDialog({ kind: "add" })}>
            <Plus size={15} strokeWidth={1.6} aria-hidden />
            <span>Add secret</span>
          </Button>
        </div>
      </div>

      {banners.map((m) => (
        <div key={m.name} className="sc-banner" role="status">
          <TriangleAlert size={16} strokeWidth={1.6} aria-hidden />
          <span className="sc-banner__text">
            <b>{m.name}</b>
            {missingSentence(m)}
          </span>
          <Button variant="secondary" size="sm" onClick={() => addValue(m.name)}>
            Add value
          </Button>
        </div>
      ))}

      <SecretsBody
        list={list}
        rows={rows}
        error={error}
        onRetry={retry}
        onAdd={() => setDialog({ kind: "add" })}
        onAddValue={addValue}
        rowActions={(row) => ({
          onReplace: () =>
            setDialog({ kind: "replace", name: row.name, usedBy: row.secret.used_by_tools }),
          onCopy: () => void copyRef(row.name),
          onDelete: () => setDeleting({ name: row.name, usedBy: row.secret.used_by_tools }),
        })}
      />

      <div className="sc-footer">
        <KeyRound size={15} strokeWidth={1.6} aria-hidden />
        <span className="sc-footer__text">
          Model API keys (OpenAI, Gemini, OpenRouter…) live in <b>Engines</b>, not here.
        </span>
        <a className="sc-footer__link" href="#/engines">
          Open Engines →
        </a>
      </div>

      {dialog && (
        <SecretDialog
          mode={dialog}
          onClose={() => setDialog(null)}
          onSaved={(name) => void onSaved(dialog, name)}
        />
      )}
      {deleting && (
        <DeleteSecretDialog
          name={deleting.name}
          usedBy={deleting.usedBy}
          onClose={() => setDeleting(null)}
          onDeleted={() => void onDeleted(deleting.name, deleting.usedBy)}
        />
      )}
    </>
  );
}

function SecretsBody({
  list,
  rows,
  error,
  onRetry,
  onAdd,
  onAddValue,
  rowActions,
}: {
  list: SecretsList | null;
  rows: SecretRow[];
  error: boolean;
  onRetry: () => void;
  onAdd: () => void;
  onAddValue: (name: string) => void;
  rowActions: (row: Extract<SecretRow, { kind: "stored" }>) => {
    onReplace: () => void;
    onCopy: () => void;
    onDelete: () => void;
  };
}) {
  if (list === null) {
    if (error) {
      return (
        <section className="tk-card">
          <div className="tk-state" role="alert">
            <span>Couldn’t load your secrets.</span>
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </section>
      );
    }
    return (
      <section className="tk-card" aria-busy="true" aria-label="Loading secrets">
        <div className="tk-skel" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="tk-skel__row">
              <span className="tk-skel__bar" style={{ width: 140 }} />
              <span className="tk-skel__bar" style={{ width: 120 }} />
              <span className="tk-skel__bar" style={{ width: 70 }} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (list.secrets.length === 0 && list.missing.length === 0) {
    return (
      <section className="tk-card">
        <EmptyState
          icon={<KeyRound size={24} strokeWidth={1.6} />}
          title="No secrets yet"
          actions={
            <Button size="sm" onClick={onAdd}>
              Add secret
            </Button>
          }
        >
          Secrets hold values like tokens. Tools use them as {"${NAME}"}, so the value never sits in
          the config. Add one here, or while adding a tool.
        </EmptyState>
      </section>
    );
  }

  const now = Date.now();
  return (
    <section className="tk-card tk-card--open">
      <table className="tk-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Used by</th>
            <th scope="col">Updated</th>
            <th scope="col">
              <span className="tk-sr">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) =>
            row.kind === "missing" ? (
              <tr key={row.name}>
                <td>
                  <div className="sc-name">
                    <span className="sc-name__text">{row.name}</span>
                    <Badge variant="warning">No value</Badge>
                  </div>
                </td>
                <td>{row.missing.used_by_tools.map((t) => t.name).join(", ")}</td>
                <td>
                  <span className="sc-muted">—</span>
                </td>
                <td>
                  <Button variant="tint" size="sm" onClick={() => onAddValue(row.name)}>
                    Add value
                  </Button>
                </td>
              </tr>
            ) : (
              <tr key={row.name}>
                <td>
                  <div className="sc-name">
                    <span className="sc-name__text">{row.name}</span>
                    <Badge variant="neutral">
                      <Lock size={11} strokeWidth={1.6} aria-hidden /> Sensitive
                    </Badge>
                  </div>
                </td>
                <td>
                  {row.secret.used_by_tools.length > 0 ? (
                    usedByText(row.secret.used_by_tools)
                  ) : (
                    <span className="sc-muted">{usedByText([])}</span>
                  )}
                </td>
                <td>
                  <span className="sc-updated">
                    {formatUpdated(row.secret.updated_at ?? row.secret.created_at, now)}
                  </span>
                </td>
                <td>
                  <SecretRowMenu
                    name={row.name}
                    usedBy={row.secret.used_by_tools}
                    {...rowActions(row)}
                  />
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </section>
  );
}
