/**
 * The landing's scroll motion (landing-1.md §3): each kind of content arrives its own way, once, and
 * two moments are locked to the scrollbar. Only transforms and opacity, set from script: if GSAP
 * doesn't run, or motion is reduced, every word is simply there.
 */
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP);

const ARRIVE = "expo.out";

export function useLandingMotion(): void {
  useGSAP(
    () => {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
      if (reduce) return;
      gsap.registerPlugin(ScrollTrigger);
      const once = (trigger: Element) => ({ trigger, start: "top 88%", once: true });
      const all = gsap.utils.toArray<HTMLElement>;

      // Words rise in reading order.
      for (const group of all("[data-rise]")) {
        gsap.from(group.children, {
          y: 24,
          opacity: 0,
          duration: 0.9,
          stagger: 0.08,
          ease: ARRIVE,
          scrollTrigger: once(group),
        });
      }
      // Lists come row by row.
      for (const list of all("[data-rows]")) {
        gsap.from(list.children, {
          x: -14,
          opacity: 0,
          duration: 0.7,
          stagger: 0.07,
          ease: ARRIVE,
          scrollTrigger: once(list),
        });
      }
      // A product picture settles onto its plate.
      for (const plate of all("[data-plate]")) {
        gsap.from(plate.children, {
          y: 40,
          scale: 0.96,
          opacity: 0,
          duration: 1.2,
          ease: ARRIVE,
          scrollTrigger: once(plate),
        });
      }
      // The demo's window opens as it comes up the page.
      for (const video of all(".web-demo .web-video")) {
        gsap.fromTo(
          video,
          { scale: 0.88 },
          {
            scale: 1,
            ease: "none",
            scrollTrigger: { trigger: video, start: "top bottom", end: "top 30%", scrub: true },
          },
        );
      }
      // The path from idea to pull request draws itself under the scrollbar.
      for (const line of all(".web-how__line")) {
        gsap.fromTo(
          line,
          { scaleX: 0 },
          {
            scaleX: 1,
            ease: "none",
            scrollTrigger: { trigger: line, start: "top 85%", end: "top 40%", scrub: true },
          },
        );
      }
      void document.fonts?.ready.then(() => ScrollTrigger.refresh());
    },
    { scope: "#main" },
  );
}
