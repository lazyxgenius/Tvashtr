import { useHomeData, refreshHome } from "./homeData";
import { SECTION_IDS, money } from "./homeFormat";
import "./home-runs.css";

/**
 * Spend (HOME-87–89): this month's total, this week's, and a bar per team (this month, largest
 * first, scaled to the largest), with the budget footnote. Live from B-RUNS `GET /api/spend`.
 */
export function SpendCard() {
  const { spend } = useHomeData();

  if (spend.loading && !spend.data) {
    return (
      <div className="hm-skel-card" style={{ height: 160 }} aria-hidden="true">
        <div className="hm-skel-bar" style={{ width: "30%", height: 14 }} />
        <div className="hm-skel-bar" style={{ width: "80%", height: 12 }} />
        <div className="hm-skel-bar" style={{ width: "60%", height: 12 }} />
      </div>
    );
  }

  const s = spend.data;
  const rows = s ? [...s.by_team] : [];
  if (s && s.other_usd > 0)
    rows.push({ team_id: "other", name: "Other runs", total_usd: s.other_usd });
  const max = rows.reduce((m, r) => Math.max(m, r.total_usd), 0);

  return (
    <section id={SECTION_IDS.spend} className="hm-card hm-target" tabIndex={-1} aria-label="Spend">
      <div className="hm-spend">
        <div className="hm-spend__row">
          <h2 className="hm-section__title hm-section__title--side">Spend</h2>
          {s && <span className="hm-section__aside">{s.month.label}</span>}
        </div>
        {!s ? (
          <div className="hm-spend__note" role="alert">
            Couldn’t load spend.{" "}
            <button type="button" className="hm-linkbtn" onClick={() => void refreshHome()}>
              Retry
            </button>
          </div>
        ) : (
          <>
            <div className="hm-spend__row">
              <span className="hm-spend__total">{money(s.month.total_usd)}</span>
              <span className="hm-spend__week">{money(s.week.total_usd)} this week</span>
            </div>
            {rows.length === 0 && <div className="hm-spend__note">No spend yet this month.</div>}
            {rows.map((r) => (
              <div key={r.team_id} className="hm-spend__team">
                <span className="hm-spend__name" title={r.name}>
                  {r.name}
                </span>
                <div className="hm-spend__track" aria-hidden="true">
                  <div
                    className="hm-spend__fill"
                    style={{ width: `${max > 0 ? Math.round((r.total_usd / max) * 100) : 0}%` }}
                  />
                </div>
                <span className="hm-spend__amount">{money(r.total_usd)}</span>
              </div>
            ))}
            <div className="hm-spend__note">
              {s.default_run_budget_usd
                ? `Each run stops at ${money(s.default_run_budget_usd)} unless you change its budget. `
                : ""}
              Subscription runs on Desktop count against your plan, not here.
            </div>
          </>
        )}
      </div>
    </section>
  );
}
