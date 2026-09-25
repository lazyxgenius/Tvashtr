import { History, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { type TeamRunRow, getTeamRuns } from "../../lib/api";
import { navigate } from "../../lib/nav";
import { Badge, Button, Sheet } from "../../design-system/components";
import { money, runStatusLook } from "./homeFormat";

/** The team runs endpoint's revamp fields (teams.md) on top of the older row type. */
type HistoryRow = TeamRunRow & {
  spent_usd?: number;
  pr_url?: string | null;
  pr_number?: number | null;
};

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Run history (HmF-History-1…4): one team's runs, newest first, in a 480px sheet — loading rows,
 * the list (idea, status, date · spend, PR link), an error with Try again, and the never-run
 * empty state with Start a run.
 */
export function RunHistorySheet({
  teamId,
  teamName,
  onClose,
  onStartRun,
}: {
  teamId: string | null;
  teamName: string;
  onClose: () => void;
  onStartRun: (teamId: string) => void;
}) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async (id: string) => {
    setRows(null);
    setError(false);
    try {
      const list: HistoryRow[] = await getTeamRuns(id);
      setRows(list);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    if (teamId) void load(teamId);
  }, [teamId, load]);

  if (!teamId) return null;
  const open = (runId?: string) => {
    onClose();
    navigate({ page: "team", teamId, ...(runId ? { runId } : {}) });
  };

  let body;
  if (error) {
    body = (
      <div className="hm-history__error" role="alert">
        <span className="hm-history__error-line">
          <TriangleAlert size={15} strokeWidth={1.6} aria-hidden />
          Couldn’t load this team’s runs — is the backend running?
        </span>
        <Button variant="secondary" size="sm" onClick={() => void load(teamId)}>
          Try again
        </Button>
      </div>
    );
  } else if (rows === null) {
    body = [0, 1, 2, 3].map((i) => (
      <div key={i} className="hm-history__skel" aria-hidden="true">
        <div className="hm-skel-bar" style={{ width: "70%", height: 12 }} />
        <div className="hm-skel-bar" style={{ width: "40%", height: 12 }} />
      </div>
    ));
  } else if (rows.length === 0) {
    body = (
      <section className="hm-card">
        <div className="hm-history__empty">
          <span className="hm-history__empty-icon">
            <History size={24} strokeWidth={1.6} aria-hidden />
          </span>
          <div className="hm-history__empty-title">This team hasn’t run yet</div>
          <div className="hm-history__empty-text">
            Start a run from Home, or open the team and press Run.
          </div>
          <div className="hm-history__empty-actions">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                onClose();
                onStartRun(teamId);
              }}
            >
              Start a run
            </Button>
          </div>
        </div>
      </section>
    );
  } else {
    body = (
      <ul className="hm-history">
        {rows.map((r) => {
          const look = runStatusLook(r.status);
          const spent = r.spent_usd ?? r.cost_total_usd ?? 0;
          return (
            <li key={r.run_id} className="hm-history__row">
              <button type="button" className="hm-history__idea" onClick={() => open(r.run_id)}>
                <span>{r.idea}</span>
              </button>
              <Badge variant={look.variant} dot>
                {look.label}
              </Badge>
              <span className="hm-history__meta">
                {shortDate(r.created_at)} · {money(spent)}
              </span>
              {r.pr_url ? (
                <a
                  className="hm-history__pr"
                  href={r.pr_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  PR #{r.pr_number ?? ""}
                </a>
              ) : (
                <span />
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Sheet
      open
      width={480}
      title="Run history"
      subtitle={`${teamName} · newest first`}
      onClose={onClose}
      footerNote="Click a run to open it on the canvas."
      footer={
        <Button variant="secondary" size="sm" onClick={() => open()}>
          Open canvas
        </Button>
      }
    >
      {body}
    </Sheet>
  );
}
