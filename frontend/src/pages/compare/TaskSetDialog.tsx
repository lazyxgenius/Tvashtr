import { Check, Eye, History, ListChecks, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { VersionDialog } from "../../canvas/VersionDialogs";
import { Button, Checkbox, IconButton, Input, Popover } from "../../design-system/components";
import { createTaskSet, type TaskSet, updateTaskSet } from "../../lib/api/compare";
import { listRecentTasks, type RecentTask } from "../../lib/api/myAgents";
import { formatRelativeTime } from "../../lib/time";
import { money } from "../home/homeFormat";

type Row = { key: number; task: string; starts_from: string; hidden_check: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const blank = (r: Row) => !r.task.trim() && !r.starts_from.trim() && !r.hidden_check.trim();

/**
 * M9 — New / Edit task set (Quality › Set-Edit, Set-AddRecent): the name, the tasks (task, starts
 * from, hidden check), "Add a task", "Add from recent tasks", what a hidden check is, Save set. The
 * server's 4xx words show in the dialog; the dialog stays open.
 */
export function TaskSetDialog({
  teamId,
  set,
  onClose,
  onSaved,
}: {
  teamId: string;
  /** null: a new set. */
  set: TaskSet | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const next = useRef(0);
  const row = (task = "", starts_from = "", hidden_check = ""): Row => ({
    key: next.current++,
    task,
    starts_from,
    hidden_check,
  });
  const [name, setName] = useState(set?.name ?? "");
  const [rows, setRows] = useState<Row[]>(() =>
    (set?.items ?? []).map((it) => row(it.task, it.starts_from ?? "", it.hidden_check)),
  );
  // "Add a task" puts the cursor in the new row's Task.
  const [focus, setFocus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edit = (key: number, field: "task" | "starts_from" | "hidden_check", value: string) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const add = (tasks: string[]) => setRows((rs) => [...rs, ...tasks.map((t) => row(t))]);

  const save = () => {
    setBusy(true);
    setError(null);
    const body = {
      name: name.trim(),
      // A row left blank is not a task.
      items: rows
        .filter((r) => !blank(r))
        .map((r) => ({
          task: r.task.trim(),
          starts_from: r.starts_from.trim() || null,
          hidden_check: r.hidden_check.trim(),
        })),
    };
    (set ? updateTaskSet(set.id, body) : createTaskSet(teamId, body)).then(
      onSaved,
      (e: unknown) => {
        setBusy(false);
        setError(message(e));
      },
    );
  };

  const e = set?.estimate;
  return (
    <VersionDialog
      title={set ? "Edit task set" : "New task set"}
      icon={<ListChecks size={17} strokeWidth={1.6} aria-hidden />}
      sub={null}
      size="cv-vdlg cmp-setdlg"
      onClose={onClose}
      footNote={
        e
          ? `Comparing two versions on this set: about ${money(e.cost_usd)} and ${e.minutes} min`
          : null
      }
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" className="cv-btn-flush" loading={busy} onClick={save}>
            <Check size={14} strokeWidth={2} aria-hidden />
            <span>Save set</span>
          </Button>
        </>
      }
    >
      <Input label="Name" value={name} maxLength={80} onChange={(ev) => setName(ev.target.value)} />
      <div className="cmp-setdlg__tasks">
        <div className="cmp-setdlg__bar">
          <span className="cmp-eyebrow">Tasks ({rows.length})</span>
          <span className="cmp-setdlg__adds">
            <Recent teamId={teamId} have={rows.map((r) => r.task.trim())} onAdd={add} />
            <button
              type="button"
              className="cmp-link cmp-setdlg__add"
              onClick={() => {
                const r = row();
                setRows((rs) => [...rs, r]);
                setFocus(r.key);
              }}
            >
              <Plus size={13} strokeWidth={1.8} aria-hidden />
              Add a task
            </button>
          </span>
        </div>
        {rows.length > 0 && (
          <>
            <div className="cmp-setdlg__grid cmp-setdlg__cols" aria-hidden>
              <span />
              <span className="cmp-eyebrow">Task</span>
              <span className="cmp-eyebrow">Starts from</span>
              <span className="cmp-eyebrow">Hidden check</span>
              <span />
            </div>
            <ul className="cmp-setdlg__rows">
              {rows.map((r, i) => (
                <li key={r.key} className="cmp-setdlg__grid cmp-setdlg__row">
                  <span className="cmp-setdlg__n">{i + 1}</span>
                  <input
                    className="cmp-setdlg__in"
                    aria-label="Task"
                    value={r.task}
                    maxLength={2000}
                    autoFocus={focus === r.key}
                    onChange={(ev) => edit(r.key, "task", ev.target.value)}
                  />
                  <input
                    className="cmp-setdlg__in cmp-setdlg__in--mono"
                    aria-label="Starts from"
                    placeholder="main"
                    value={r.starts_from}
                    onChange={(ev) => edit(r.key, "starts_from", ev.target.value)}
                  />
                  <input
                    className="cmp-setdlg__in cmp-setdlg__check"
                    aria-label="Hidden check"
                    value={r.hidden_check}
                    maxLength={2000}
                    spellCheck={false}
                    onChange={(ev) => edit(r.key, "hidden_check", ev.target.value)}
                  />
                  <IconButton
                    size="sm"
                    aria-label={`Remove ${r.task.trim() || `task ${i + 1}`}`}
                    title={`Remove ${r.task.trim() || `task ${i + 1}`}`}
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  >
                    <X size={14} strokeWidth={1.6} aria-hidden />
                  </IconButton>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="cmp-setdlg__what">
        <Eye size={18} strokeWidth={1.6} aria-hidden />
        <div>
          <div className="cmp-setdlg__what-title">What a hidden check is</div>
          <div className="cmp-setdlg__what-text">
            A command Tvashtr runs after each run to see if the task really works. The agents never
            see it, so they can’t write code just to pass it.
          </div>
        </div>
      </div>
      {error && (
        <div className="lv-confirm__error" role="alert">
          {error}
        </div>
      )}
    </VersionDialog>
  );
}

/** Set-AddRecent: this team's recent tasks; those already in the set are ticked and off. */
function Recent({
  teamId,
  have,
  onAdd,
}: {
  teamId: string;
  have: string[];
  onAdd: (tasks: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<RecentTask[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setPicked([]);
    listRecentTasks("", 20).then(
      (tasks) => {
        // ponytail: the newest 20 across teams, then this team's; a team filter on the route if short.
        const mine = tasks.filter((t) => t.team?.id === teamId);
        if (live) setRecent(mine.filter((t, i) => mine.findIndex((u) => u.task === t.task) === i));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [open, teamId]);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align="end"
      width={430}
      label="Add from recent tasks"
      className="cmp-recent"
      trigger={
        <button
          type="button"
          className="cmp-link cmp-setdlg__add"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <History size={13} strokeWidth={1.8} aria-hidden />
          Add from recent tasks
        </button>
      }
    >
      <div className="cmp-recent__head">Recent tasks on this team</div>
      <ul className="cmp-recent__list">
        {recent.map((t) => {
          const inSet = have.includes(t.task);
          return (
            <li key={t.task}>
              <Checkbox
                label={t.task}
                checked={inSet || picked.includes(t.task)}
                disabled={inSet}
                onChange={(ev) =>
                  setPicked((p) =>
                    ev.target.checked ? [...p, t.task] : p.filter((x) => x !== t.task),
                  )
                }
              />
              <span className="cmp-recent__when">
                {inSet ? "In the set" : formatRelativeTime(t.created_at)}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="cmp-recent__foot">
        <Button
          variant="primary"
          size="sm"
          className="cv-btn-flush"
          disabled={picked.length === 0}
          onClick={() => {
            onAdd(picked);
            setOpen(false);
          }}
        >
          <Plus size={14} strokeWidth={1.8} aria-hidden />
          <span>Add {picked.length}</span>
        </Button>
      </div>
    </Popover>
  );
}
