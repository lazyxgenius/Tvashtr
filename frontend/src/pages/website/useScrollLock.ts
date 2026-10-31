import { useEffect } from "react";

/** A scrim or full-screen layer holds the page still while it's open. */
export function useScrollLock(): void {
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, []);
}
