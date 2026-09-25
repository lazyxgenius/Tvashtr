import { Plus } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import { Button } from "../../design-system/components";
import { useHome } from "./homeContext";
import { useHomeData } from "./homeData";
import { SECTION_IDS, greetingFor, money, scrollToSection } from "./homeFormat";
import "./home-runs.css";

function nameOf(user: { email: string; display_name?: string | null } | null | undefined): string {
  if (!user) return "";
  if (user.display_name) return user.display_name;
  const local = user.email.split("@")[0] ?? "";
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "";
}

function SummaryLink({
  target,
  tone = "plain",
  children,
}: {
  target: string;
  tone?: "plain" | "amber";
  children: ReactNode;
}) {
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    scrollToSection(target);
  };
  return (
    <a
      href="#"
      className={tone === "amber" ? "hm-head__link hm-head__link--amber" : "hm-head__link"}
      onClick={go}
    >
      {children}
    </a>
  );
}

/**
 * The greeting (Home-Main): "Good morning, {name}." and the summary line — "{n} things need you ·
 * {n} run(s) in progress · ${x} spent this week" — each part a link that scrolls to and focuses its
 * section (HOME-7/8), plus the New team button (HOME-9).
 */
export function HomeHeader() {
  const { user, openNewTeam } = useHome();
  const { inbox, active, spend } = useHomeData();
  const name = nameOf(user);
  const loading = inbox.loading && active.loading && spend.loading;

  if (loading) {
    return (
      <div className="hm-skel-head" aria-busy="true" aria-label="Loading Home">
        <div className="hm-skel-bar" style={{ width: 320, height: 30 }} />
        <div className="hm-skel-bar" style={{ width: 260, height: 12 }} />
      </div>
    );
  }

  const needs = inbox.data?.count ?? 0;
  const inProgress = (active.data ?? []).filter(
    (r) => r.status === "pending" || r.status === "running",
  ).length;
  const week = spend.data?.week.total_usd;

  const parts: ReactNode[] = [];
  parts.push(
    needs > 0 ? (
      <SummaryLink key="needs" target={SECTION_IDS.needsYou} tone="amber">
        {needs === 1 ? "1 thing needs you" : `${needs} things need you`}
      </SummaryLink>
    ) : (
      <span key="needs">Nothing needs you</span>
    ),
  );
  parts.push(
    inProgress > 0 ? (
      <SummaryLink key="running" target={SECTION_IDS.runningNow}>
        {inProgress === 1 ? "1 run in progress" : `${inProgress} runs in progress`}
      </SummaryLink>
    ) : (
      <span key="running">nothing running</span>
    ),
  );
  if (week !== undefined) {
    parts.push(
      <SummaryLink key="spend" target={SECTION_IDS.spend}>
        {money(week)} spent this week
      </SummaryLink>,
    );
  }

  return (
    <div className="hm-head">
      <div>
        <h1 className="hm-head__title">
          {greetingFor()}
          {name ? `, ${name}.` : "."}
        </h1>
        <p className="hm-head__summary">
          {parts.map((p, i) => (
            <span key={i}>
              {i > 0 && (
                <>
                  {" "}
                  <span className="hm-head__sep">·</span>{" "}
                </>
              )}
              {p}
            </span>
          ))}
        </p>
      </div>
      <div className="hm-head__actions">
        <Button
          variant="secondary"
          iconLeft={<Plus size={15} strokeWidth={1.6} aria-hidden />}
          onClick={() => openNewTeam()}
        >
          New team
        </Button>
      </div>
    </div>
  );
}
