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
  const label =
    ok === null ? "Checking backend…" : ok ? "Backend connected" : "Backend unreachable";

  return (
    <span
      className="inline-flex items-center gap-2 text-secondary"
      style={{ fontSize: "var(--fs-caption)" }}
      title={label}
    >
      <span
        className="inline-block rounded-full"
        style={{ width: 8, height: 8, background: color }}
      />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}
