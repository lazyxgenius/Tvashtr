import { useEffect, useState } from "react";

type Health = { status: string; db: string };

type Probe =
  | { state: "loading" }
  | { state: "ok"; health: Health }
  | { state: "error"; message: string };

export default function App() {
  const [probe, setProbe] = useState<Probe>({ state: "loading" });

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const res = await fetch("/health");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const health = (await res.json()) as Health;
        if (active) setProbe({ state: "ok", health });
      } catch (err) {
        if (active) setProbe({ state: "error", message: String(err) });
      }
    };
    void check();
    const id = setInterval(check, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const healthy = probe.state === "ok" && probe.health.db === "ok";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-neutral-950 text-neutral-100">
      <h1 className="text-5xl font-semibold tracking-tight">Tvashtr</h1>
      <div className="flex items-center gap-3 rounded-full border border-neutral-800 bg-neutral-900 px-5 py-2.5">
        <span
          className={`inline-block h-3 w-3 rounded-full ${
            probe.state === "loading"
              ? "animate-pulse bg-amber-400"
              : healthy
                ? "bg-emerald-400"
                : "bg-rose-500"
          }`}
        />
        <span className="text-sm text-neutral-300">
          {probe.state === "loading"
            ? "checking backend…"
            : probe.state === "error"
              ? "backend unreachable"
              : `backend: ${probe.health.status} · db: ${probe.health.db}`}
        </span>
      </div>
      <p className="text-xs text-neutral-600">Phase 0 · durable spine</p>
    </main>
  );
}
