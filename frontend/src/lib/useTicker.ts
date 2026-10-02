import { useEffect, useState } from "react";

/** The time now, read again every `ms` so an "updated 2m ago" ages while the page sits idle. */
export function useTicker(ms = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
