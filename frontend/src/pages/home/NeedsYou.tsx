import {
  Brain,
  CircleCheck,
  History,
  KeyRound,
  ShieldCheck,
  TriangleAlert,
  Wallet,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  type InboxApproval,
  type InboxItem,
  type InboxRunFailed,
  dismissInboxItem,
  undoInboxDismissal,
} from "../../lib/api/home";
import { ApiError } from "../../lib/api";
import { getRunDetail, resolveGate } from "../../lib/api/runs";
import { isDesktopApp } from "../../lib/desktopRepos";
import { navigate } from "../../lib/nav";
import { formatRelativeTime } from "../../lib/time";
import {
  Button,
  Menu,
  type MenuEntry,
  type ToastOptions,
  useToast,
} from "../../design-system/components";
import { ApproveSheet } from "./ApproveSheet";
import { useHome } from "./homeContext";
import {
  type ComposerTarget,
  getHomeData,
  markRunEnded,
  refreshHome,
  removeInboxItem,
  requestAddKeys,
  requestComposerPrefill,
  restoreInboxItem,
  useHomeData,
} from "./homeData";
import {
  SECTION_IDS,
  approvalTitle,
  elapsedShort,
  listNatural,
  money,
  subscriptionName,
} from "./homeFormat";
import "./home-runs.css";

type Tone = "amber" | "red" | "plain";

/** 09:00 local time tomorrow, as an absolute time (Q24). */
function tomorrowNine(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

function inAnHour(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}

function openRun(teamId: string | null | undefined, runId: string) {
  if (teamId) navigate({ page: "team", teamId, runId });
}

function composerTargetOf(run: InboxRunFailed["run"]): ComposerTarget | null {
  const t = run.target;
  if (t?.kind === "github" && t.label) return { kind: "github", repo: t.label };
  if (t?.kind === "desktop_folder" && t.label)
    return { kind: "folder", path: t.label, label: t.label };
  if (t?.kind === "local" && t.label) return { kind: "local", path: t.label };
  if (t?.kind === "none") return { kind: "none" };
  if (run.github_repo) return { kind: "github", repo: run.github_repo };
  return null;
}

function Row({
  tone,
  icon,
  title,
  meta,
  actions,
}: {
  tone: Tone;
  icon: ReactNode;
  title: ReactNode;
  meta: ReactNode;
  actions: ReactNode;
}) {
  return (
    <li className="hm-inbox__item">
      <span className={`hm-inbox__icon hm-inbox__icon--${tone}`}>{icon}</span>
      <div className="hm-inbox__body">
        <div className="hm-inbox__title">{title}</div>
        <div className="hm-inbox__meta">{meta}</div>
      </div>
      <div className="hm-inbox__actions">{actions}</div>
    </li>
  );
}

const ICON = { size: 17, strokeWidth: 1.6, "aria-hidden": true } as const;

/**
 * Needs you (HOME-40–53): every approval, failed run, setup gap and memory batch across the
 * account, oldest first, each with its one action and a ⋯ menu (dismiss / snooze / undo). The
 * count here is the nav badge and the greeting's "{n} things need you".
 */
export function NeedsYou() {
  const { inbox } = useHomeData();
  const { reloadTeams } = useHome();
  const toast = useToast();
  const [reviewing, setReviewing] = useState<InboxApproval | null>(null);
  const surface = isDesktopApp() ? "desktop" : "website";

  /** After an item leaves: the last one gets a plain "All caught up." (HOME-52, HmF-AllClear-1). */
  const say = (opts: ToastOptions) => {
    const left = getHomeData().inbox.data?.count ?? 0;
    toast(left === 0 ? { message: "All caught up." } : opts);
  };

  const hide = async (
    item: InboxItem,
    action: "dismiss" | "snooze",
    until: string | undefined,
    message: string,
  ) => {
    removeInboxItem(item.key);
    try {
      await dismissInboxItem(item.key, action, { until, surface });
    } catch {
      restoreInboxItem(item);
      toast({ message: "Couldn’t do that. Try again.", tone: "error" });
      return;
    }
    say({
      message,
      action: {
        label: "Undo",
        onClick: () => {
          restoreInboxItem(item);
          void undoInboxDismissal(item.key).finally(() => void refreshHome());
        },
      },
    });
  };

  const dismiss = (item: InboxItem) =>
    void hide(
      item,
      "dismiss",
      undefined,
      item.kind === "memories"
        ? "Dismissed. The memories still wait in Toolkit › Memory."
        : "Dismissed.",
    );
  const remindTomorrow = (item: InboxItem) =>
    void hide(item, "snooze", tomorrowNine(), "We’ll remind you tomorrow.");
  const remindInHour = (item: InboxItem) =>
    void hide(item, "snooze", inAnHour(), "We’ll remind you in an hour.");

  const retry = (item: InboxRunFailed) => {
    const run = item.run;
    requestComposerPrefill({
      teamId: item.team?.id ?? run.library_team_id ?? null,
      idea: run.idea,
      target: composerTargetOf(run),
      baseRef: run.target?.base_ref ?? run.base_ref ?? null,
      subpath: run.target?.subpath ?? run.subpath ?? null,
      budget: run.budget_cap_usd ?? null,
      retryOfRunId: run.id,
    });
  };

  const fixKeys = (teamName: string, providers: string[], key: string) =>
    requestAddKeys({
      teamName,
      providers,
      onDone: () => {
        removeInboxItem(key);
        void reloadTeams();
        void refreshHome();
      },
    });

  // ---- approve / reject (the sheet) ----
  const lostRace = () => {
    setReviewing(null);
    toast({ message: "This was already handled." });
    void refreshHome();
  };

  const approve = async () => {
    const item = reviewing;
    if (!item) return;
    try {
      await resolveGate(item.run.id, item.task.id, "approve");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) return lostRace();
      toast({ message: "Couldn’t approve. Try again.", tone: "error" });
      return;
    }
    setReviewing(null);
    removeInboxItem(item.key);
    say({
      message: item.task.next_role
        ? `Approved. The ${item.task.next_role} is building.`
        : "Approved. The run continues.",
      action: { label: "Open run", onClick: () => openRun(item.team?.id, item.run.id) },
    });
    void refreshHome();
    void reloadTeams();
  };

  const reject = async (note: string) => {
    const item = reviewing;
    if (!item) return;
    try {
      await resolveGate(item.run.id, item.task.id, "reject", note || undefined);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) return lostRace();
      toast({ message: "Couldn’t reject. Try again.", tone: "error" });
      return;
    }
    setReviewing(null);
    removeInboxItem(item.key);
    const row = getHomeData().active.data?.find((r) => r.run_id === item.run.id);
    if (row) markRunEnded(row, "rejected");
    say({
      message: "Run stopped. Your note is saved with the run.",
      action: {
        label: "Start again",
        onClick: () => {
          void getRunDetail(item.run.id)
            .catch(() => null)
            .then((run) => {
              const idea = note ? `${item.run.idea}\n\nAlso: ${note}` : item.run.idea;
              const target = run?.target;
              requestComposerPrefill({
                teamId: item.team?.id ?? run?.library_team_id ?? null,
                idea,
                target:
                  target?.kind === "github" && target.label
                    ? { kind: "github", repo: target.label }
                    : target?.kind === "none"
                      ? { kind: "none" }
                      : null,
                baseRef: target?.base_ref ?? null,
                subpath: target?.subpath ?? null,
                budget: run?.budget_cap_usd ?? null,
              });
            });
        },
      },
    });
    void refreshHome();
    void reloadTeams();
  };

  // ---- render ----
  if (inbox.loading && !inbox.data) {
    return (
      <div className="hm-skel-card" style={{ height: 220 }} aria-hidden="true">
        <div className="hm-skel-bar" style={{ width: "30%", height: 14 }} />
        <div className="hm-skel-bar" style={{ width: "80%", height: 12 }} />
        <div className="hm-skel-bar" style={{ width: "60%", height: 12 }} />
      </div>
    );
  }

  const items = inbox.data?.items ?? [];

  const more = (title: string, entries: MenuEntry[]) => (
    <Menu label={`More for ${title}`} items={entries} width={232} />
  );

  const rowFor = (item: InboxItem): ReactNode => {
    switch (item.kind) {
      case "approval": {
        const title = approvalTitle(item.task.kind);
        return (
          <Row
            key={item.key}
            tone="amber"
            icon={<ShieldCheck {...ICON} />}
            title={title}
            meta={`${item.team?.name ?? "A run"} · “${item.run.idea}” · waiting ${elapsedShort(item.since)}`}
            actions={
              <>
                <Button variant="primary" size="sm" onClick={() => setReviewing(item)}>
                  Review
                </Button>
                {more(title, [
                  {
                    key: "open",
                    label: "Open run",
                    onSelect: () => openRun(item.team?.id, item.run.id),
                  },
                  {
                    key: "later",
                    label: "Remind me in 1 hour",
                    icon: <History size={15} strokeWidth={1.6} />,
                    onSelect: () => remindInHour(item),
                  },
                ])}
              </>
            }
          />
        );
      }
      case "nudge": {
        const cap = item.run.budget_cap_usd ?? 0;
        const pct = cap > 0 ? Math.round(((item.run.spent_usd ?? 0) / cap) * 100) : 80;
        const title = `${item.team?.name ?? "A run"} has used ${pct}% of its budget`;
        return (
          <Row
            key={item.key}
            tone="amber"
            icon={<Wallet {...ICON} />}
            title={title}
            meta={`“${item.run.idea}” · ${money(item.run.spent_usd)}${cap ? ` of ${money(cap)}` : ""}`}
            actions={
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openRun(item.team?.id, item.run.id)}
                >
                  Open run
                </Button>
                {more(title, [
                  {
                    key: "later",
                    label: "Remind me tomorrow",
                    icon: <History size={15} strokeWidth={1.6} />,
                    onSelect: () => remindTomorrow(item),
                  },
                  "separator",
                  {
                    key: "dismiss",
                    label: "Dismiss",
                    icon: <X size={15} strokeWidth={1.6} />,
                    onSelect: () => dismiss(item),
                  },
                ])}
              </>
            }
          />
        );
      }
      case "run_failed": {
        const teamId = item.team?.id ?? item.run.library_team_id;
        const when = item.run.ended_at ?? item.since;
        const reason = item.failure?.message ?? "The run stopped with an error.";
        return (
          <Row
            key={item.key}
            tone="red"
            icon={<TriangleAlert {...ICON} />}
            title="Run failed"
            meta={`${item.team?.name ?? "A run"} · “${item.run.idea}” · ${formatRelativeTime(when)} · ${reason}`}
            actions={
              <>
                <Button variant="secondary" size="sm" onClick={() => openRun(teamId, item.run.id)}>
                  View run
                </Button>
                {teamId && (
                  <Button variant="ghost" size="sm" onClick={() => retry(item)}>
                    Retry
                  </Button>
                )}
                {more("Run failed", [
                  { key: "open", label: "Open run", onSelect: () => openRun(teamId, item.run.id) },
                  "separator",
                  {
                    key: "dismiss",
                    label: "Dismiss",
                    icon: <X size={15} strokeWidth={1.6} />,
                    onSelect: () => dismiss(item),
                  },
                ])}
              </>
            }
          />
        );
      }
      case "setup_gap": {
        const where = item.target === "desktop" ? "this computer" : "the website";
        const title = `${item.team.name} can’t run on ${where}`;
        const covers = item.target === "website" ? item.desktop_covers : [];
        const meta =
          `No API keys for ${listNatural(item.missing_providers)}.` +
          (covers.length
            ? ` Desktop runs still work with your ${listNatural(covers.map(subscriptionName))} ${covers.length === 1 ? "plan" : "plans"}.`
            : "");
        return (
          <Row
            key={item.key}
            tone="plain"
            icon={<KeyRound {...ICON} />}
            title={title}
            meta={meta}
            actions={
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fixKeys(item.team.name, item.missing_providers, item.key)}
                >
                  Fix
                </Button>
                {more(title, [
                  {
                    key: "engines",
                    label: "Open Engines",
                    onSelect: () => navigate({ page: "engines", tab: "overview" }),
                  },
                  "separator",
                  {
                    key: "dismiss",
                    label: "Dismiss",
                    icon: <X size={15} strokeWidth={1.6} />,
                    onSelect: () => dismiss(item),
                  },
                ])}
              </>
            }
          />
        );
      }
      case "setup_gaps_folded": {
        const title = `${item.count} more ${item.count === 1 ? "team" : "teams"} can’t run on the website`;
        return (
          <Row
            key={item.key}
            tone="plain"
            icon={<KeyRound {...ICON} />}
            title={title}
            meta={listNatural(item.teams.map((t) => t.name))}
            actions={
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate({ page: "engines", tab: "overview" })}
                >
                  Open Engines
                </Button>
                {more(title, [
                  {
                    key: "dismiss",
                    label: "Dismiss",
                    icon: <X size={15} strokeWidth={1.6} />,
                    onSelect: () => dismiss(item),
                  },
                ])}
              </>
            }
          />
        );
      }
      case "memories": {
        const title =
          item.count === 1 ? "1 new memory to review" : `${item.count} new memories to review`;
        const by = item.learned_by.length ? `Learned by ${listNatural(item.learned_by)}` : "";
        const on = item.repos.length ? ` on ${listNatural(item.repos)}` : "";
        const review = () => navigate({ page: "memory", tab: "inbox" });
        return (
          <Row
            key={item.key}
            tone="plain"
            icon={<Brain {...ICON} />}
            title={title}
            meta={by ? `${by}${on}` : "Waiting in Toolkit › Memory"}
            actions={
              <>
                <Button variant="ghost" size="sm" onClick={review}>
                  Review
                </Button>
                {more(title, [
                  {
                    key: "review",
                    label: "Review in Toolkit",
                    icon: <Brain size={15} strokeWidth={1.6} />,
                    onSelect: review,
                  },
                  {
                    key: "later",
                    label: "Remind me tomorrow",
                    icon: <History size={15} strokeWidth={1.6} />,
                    onSelect: () => remindTomorrow(item),
                  },
                  "separator",
                  {
                    key: "dismiss",
                    label: "Dismiss",
                    icon: <X size={15} strokeWidth={1.6} />,
                    onSelect: () => dismiss(item),
                  },
                ])}
              </>
            }
          />
        );
      }
    }
  };

  return (
    <section
      id={SECTION_IDS.needsYou}
      className="hm-card hm-card--open hm-target"
      tabIndex={-1}
      aria-label="Needs you"
    >
      <div className="hm-card__head">
        <h2 className="hm-section__title">Needs you</h2>
        {items.length > 0 && <span className="hm-pill hm-pill--accent">{items.length}</span>}
        <span className="hm-section__aside">Oldest first</span>
      </div>
      {inbox.error && !inbox.data ? (
        <div className="hm-inbox__empty" role="alert">
          Couldn’t load what needs you.{" "}
          <button type="button" className="hm-linkbtn" onClick={() => void refreshHome()}>
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="hm-inbox__empty">
          <span className="hm-inbox__ok">
            <CircleCheck size={18} strokeWidth={1.6} aria-hidden />
          </span>
          You’re all caught up. Approvals, failed runs and setup gaps show up here.
        </div>
      ) : (
        <ul className="hm-inbox">{items.map(rowFor)}</ul>
      )}
      <ApproveSheet
        item={reviewing}
        onClose={() => setReviewing(null)}
        onOpenRun={() => reviewing && openRun(reviewing.team?.id, reviewing.run.id)}
        onApprove={approve}
        onReject={reject}
      />
    </section>
  );
}
