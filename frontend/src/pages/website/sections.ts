/**
 * `#/welcome?s=<section>` (website.md WEB-7): the landing brings that section under its sticky
 * header (`scroll-margin-top` in website.css), smoothly or as a jump under reduced motion, then
 * drops the `?s=` with a replace so the same link works again and Back never collects scroll
 * steps. Never a raw `#id` anchor: the hash is the app's router.
 */
import { type MouseEvent, useEffect } from "react";

import { type SiteSection, navigate, parseRoute } from "../../lib/nav";

export function useSectionScroll(section: SiteSection | undefined): void {
  useEffect(() => {
    if (!section) return;
    const go = () => {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      document
        .getElementById(section)
        ?.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "start" });
    };
    // Web fonts change the page's height: aim once they're in.
    void (document.fonts?.ready ?? Promise.resolve()).then(go);
    navigate({ page: "welcome" }, { replace: true });
  }, [section]);
}

/** A section link's click: when that section is on this page, scroll in place with a replace;
 *  from another page it's a normal visit. */
export function onSectionLink(e: MouseEvent<HTMLAnchorElement>): void {
  const route = parseRoute(e.currentTarget.hash);
  if (route.page !== "welcome" || !route.section || !document.getElementById(route.section)) return;
  e.preventDefault();
  navigate(route, { replace: true });
}
