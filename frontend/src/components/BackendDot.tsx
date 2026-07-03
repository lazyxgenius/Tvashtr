import { useEffect, useState } from "react";

import { getHealth } from "../lib/api";

/** A quiet "is the backend reachable" affordance for the header. */
export function BackendDot() {
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const h = await getHealth();
        if (active) setOk(h.db === "ok");
      } catch {
        if (active) setOk(false);
      }
    };
    void check();
    const id = setInterval(() => void check(), 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const color = ok === null ? "var(--stone-400)" : ok ? "var(--sage-500)" : "var(--red-500)";
  // F-canvas-fidelity-1 Part C: the design's toolbar status dot is a bare 8px dot with a soft tonal
  // halo (no inline label — the status reads via the tooltip / aria-label). Sage when connected.
  const ring = ok === null ? "var(--panel-300)" : ok ? "var(--sage-100)" : "var(--red-100)";
  const label =
    ok === null ? "Checking backend…" : ok ? "Backend connected" : "Backend unreachable";

  return (
    <span className="inline-flex items-center" title={label} role="img" aria-label={label}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 0 3px ${ring}`,
        }}
      />
    </span>
  );
}
