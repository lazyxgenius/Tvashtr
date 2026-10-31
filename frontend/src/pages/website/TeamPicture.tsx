/**
 * The hero's picture of a team at work (landing-1.md §1, §5): drawn in code, not a screenshot, and
 * not a real run, so it shows no times, costs or counts. Its markup rests on the finished state, so
 * reduced motion, or GSAP failing to load, still shows the whole team with its pull request open.
 * Visitors can take Tests pass or the Reviewer out and watch the path change; it claims no result.
 */
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  Check,
  ClipboardCheck,
  type LucideIcon,
  Package,
  PenLine,
  Plus,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

gsap.registerPlugin(useGSAP);

type Kind = "task" | "agent" | "gate" | "pr";
type StopId = "task" | "pm" | "prd" | "eng" | "tests" | "rev" | "scan" | "edits" | "ship" | "pr";
type Optional = "tests" | "rev";

interface Stop {
  id: StopId;
  kind: Kind;
  title: string;
  /** The line under the title, and the status chip while it works, fails and finishes. */
  does?: string;
  run?: string;
  fail?: string;
  done?: string;
  /** Drawn the way the real canvas draws them (AgentNodeCard): icon, capability, model. */
  Icon?: LucideIcon;
  edits?: "Edits on" | "Edits off";
  model?: string;
}

const STOPS: Stop[] = [
  { id: "task", kind: "task", title: "A task" },
  {
    id: "pm",
    kind: "agent",
    title: "Product manager",
    does: "Writes the spec",
    run: "Writing",
    done: "Done",
    Icon: PenLine,
    edits: "Edits off",
    model: "grok-4.7",
  },
  {
    id: "prd",
    kind: "gate",
    title: "PRD approval",
    does: "You approve the spec",
    run: "Waiting for you",
    done: "Approved",
    Icon: ShieldCheck,
  },
  {
    id: "eng",
    kind: "agent",
    title: "Engineer",
    does: "Builds it",
    run: "Building",
    done: "Done",
    Icon: Terminal,
    edits: "Edits on",
    model: "claude-sonnet-5",
  },
  {
    id: "tests",
    kind: "gate",
    title: "Tests pass",
    does: "Tvashtr runs your tests",
    run: "Running",
    fail: "Failed",
    done: "Passed",
    Icon: ShieldCheck,
  },
  {
    id: "rev",
    kind: "agent",
    title: "Reviewer",
    does: "Checks against the spec",
    run: "Checking",
    done: "Approved",
    Icon: ClipboardCheck,
    edits: "Edits off",
    model: "grok-4.7",
  },
  {
    id: "scan",
    kind: "gate",
    title: "Secret scan",
    does: "Looks for secrets",
    done: "Passed",
    Icon: ShieldCheck,
  },
  {
    id: "edits",
    kind: "gate",
    title: "No edits to a folder",
    does: "The one you name",
    done: "Passed",
    Icon: ShieldCheck,
  },
  {
    id: "ship",
    kind: "gate",
    title: "Ship",
    does: "Opens a pull request",
    done: "Opened",
    Icon: Package,
  },
  { id: "pr", kind: "pr", title: "Pull request" },
];

/** What each moment of the cycle says, in the film's approved words. Finished state last. */
const CAPTIONS = {
  task: "A task comes in.",
  pm: "The Product manager writes the spec.",
  prd: "The run waits for you. You approve the spec.",
  eng: "The Engineer builds it.",
  tests: "Tvashtr runs your tests.",
  fail: "A failure goes back to the Engineer, with the last 12 lines.",
  retry: "The Engineer works from what failed.",
  pass: "Your tests pass.",
  rev: "The Reviewer checks the work against the spec.",
  checks: "A secret scan and a folder check come next.",
  ship: "Ship opens the pull request.",
  pr: "A reviewed pull request, on your repo.",
};
type CaptionKey = keyof typeof CAPTIONS;
const FINISHED: CaptionKey = "pr";

const WIDE_AT = 1000;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
type Layout = { wide: boolean; width: number; height: number; at: Record<StopId, Box> };

function layout(width: number): Layout {
  const wide = width >= WIDE_AT;
  const nodeW = wide ? Math.min(196, width / 5 - 24) : Math.max(180, Math.min(220, width - 90));
  const size = (kind: Kind): [number, number] => {
    if (kind === "task") return [104, 44];
    if (kind === "pr") return [150, 44];
    return [nodeW, kind === "gate" ? 86 : 118];
  };
  const at = {} as Record<StopId, Box>;
  if (wide) {
    const column = (i: number) => (width * (2 * i + 1)) / 10;
    const rows: [StopId, number, number][] = [
      ["task", 0, 104],
      ["pm", 1, 104],
      ["prd", 2, 104],
      ["eng", 3, 104],
      ["tests", 4, 104],
      ["rev", 4, 296],
      ["scan", 3, 296],
      ["edits", 2, 296],
      ["ship", 1, 296],
      ["pr", 0, 296],
    ];
    for (const [id, i, y] of rows) {
      const [w, h] = size(STOPS.find((s) => s.id === id)!.kind);
      at[id] = { x: column(i), y, w, h };
    }
    return { wide, width, height: 364, at };
  }
  // One column on the left, with the loops running back up its right side.
  const x = Math.max(0, (width - nodeW - 96) / 2) + nodeW / 2;
  let y = 0;
  for (const stop of STOPS) {
    const [w, h] = size(stop.kind);
    at[stop.id] = { x, y: y + h / 2, w, h };
    y += h + 30;
  }
  return { wide, width, height: y - 30, at };
}

/** The line from one stop to the next one on the path. */
function edgePath(a: Box, b: Box, wide: boolean): string {
  if (wide && a.y === b.y) {
    const dir = b.x > a.x ? 1 : -1;
    return `M${a.x + (dir * a.w) / 2} ${a.y}L${b.x - (dir * b.w) / 2} ${b.y}`;
  }
  const y1 = a.y + a.h / 2;
  const y2 = b.y - b.h / 2;
  if (a.x === b.x) return `M${a.x} ${y1}L${b.x} ${y2}`;
  const mid = (y1 + y2) / 2;
  return `M${a.x} ${y1}C${a.x} ${mid},${b.x} ${mid},${b.x} ${y2}`;
}

/** The dashed way back to the Engineer, and where its label sits. */
function loopPath(from: Box, eng: Box, wide: boolean, reach: number) {
  if (wide && from.y === eng.y) {
    const y1 = from.y - from.h / 2;
    const y2 = eng.y - eng.h / 2;
    return {
      d: `M${from.x} ${y1}C${from.x} ${y1 - 54},${eng.x} ${y2 - 54},${eng.x} ${y2}`,
      label: { x: (from.x + eng.x) / 2, y: (y1 + y2) / 2 - 40 },
    };
  }
  if (wide) {
    const x1 = from.x - from.w / 4;
    const y1 = from.y - from.h / 2;
    const y2 = eng.y + eng.h / 2;
    const mid = (y1 + y2) / 2;
    return {
      d: `M${x1} ${y1}C${x1} ${mid},${eng.x} ${mid},${eng.x} ${y2}`,
      label: { x: (x1 + eng.x) / 2, y: mid },
    };
  }
  const x1 = from.x + from.w / 2;
  const x2 = eng.x + eng.w / 2;
  return {
    d: `M${x1} ${from.y}C${x1 + reach} ${from.y},${x2 + reach} ${eng.y},${x2} ${eng.y}`,
    label: { x: x1 + reach * 0.75, y: from.y - from.h / 2 - 13 },
  };
}

/** The whole cycle, on the stops the visitor kept. */
function buildCycle(root: HTMLElement, order: StopId[]): gsap.core.Timeline | null {
  const q = gsap.utils.selector(root);
  const dot = q(".tp__dot")[0];
  const firstEdge = q("[data-edge]")[0] as unknown as SVGPathElement | undefined;
  if (!dot || typeof firstEdge?.getPointAtLength !== "function") return null;

  const tl = gsap.timeline({ repeat: -1, paused: true });
  const wait = (seconds: number) => tl.to({}, { duration: seconds });
  const say = (key: CaptionKey) => {
    tl.to(q(".tp__cap"), { opacity: 0, duration: 0.12 });
    tl.to(q(`[data-cap="${key}"]`), { opacity: 1, duration: 0.2 });
  };
  const state = (id: StopId, name: "run" | "fail" | "done") => {
    tl.to(q(`[data-stop="${id}"] .tp__st`), { opacity: 0, duration: 0.12 });
    tl.to(q(`[data-stop="${id}"] [data-st="${name}"]`), { opacity: 1, duration: 0.2 });
  };
  const ring = (id: StopId, on: boolean) =>
    tl.to(q(`[data-stop="${id}"] .tp__ring`), { opacity: on ? 1 : 0, duration: 0.2 });
  const travel = (selector: string) => {
    const path = q(selector)[0] as unknown as SVGPathElement | undefined;
    if (!path) return;
    const length = path.getTotalLength();
    const along = { at: 0 };
    tl.to(along, {
      at: 1,
      duration: 0.75,
      ease: "power1.inOut",
      onUpdate: () => {
        const point = path.getPointAtLength(along.at * length);
        gsap.set(dot, { x: point.x, y: point.y });
      },
    });
  };
  const work = (id: StopId, key: CaptionKey, seconds: number) => {
    ring(id, true);
    state(id, "run");
    say(key);
    wait(seconds);
    state(id, "done");
    ring(id, false);
  };

  // Back to the start of the story: nothing done, the token on the task.
  tl.set(q(".tp__st"), { opacity: 0 });
  tl.set(q(".tp__ring"), { opacity: 0 });
  tl.set(q(".tp__lit"), { opacity: 0 });
  tl.set(q(".tp__cap"), { opacity: 0 });
  tl.set(q('[data-cap="task"]'), { opacity: 1 });
  const start = firstEdge.getPointAtLength(0);
  tl.set(dot, { opacity: 1, x: start.x, y: start.y });
  wait(0.8);

  order.slice(1).forEach((id, i) => {
    travel(`[data-edge="${order[i]}-${id}"]`);
    if (id === "pm") work(id, "pm", 1.4);
    else if (id === "prd") work(id, "prd", 1.7);
    else if (id === "eng") work(id, "eng", 1.4);
    else if (id === "rev") work(id, "rev", 1.5);
    else if (id === "tests") {
      ring(id, true);
      state(id, "run");
      say("tests");
      wait(1);
      state(id, "fail");
      say("fail");
      wait(1.1);
      ring(id, false);
      travel('[data-loop="tests"]');
      work("eng", "retry", 1.2);
      travel('[data-edge="eng-tests"]');
      ring(id, true);
      state(id, "run");
      say("tests");
      wait(0.8);
      state(id, "done");
      say("pass");
      wait(0.7);
      ring(id, false);
    } else if (id === "scan" || id === "edits") {
      ring(id, true);
      say("checks");
      state(id, "done");
      wait(0.5);
      ring(id, false);
    } else if (id === "ship") {
      ring(id, true);
      say("ship");
      state(id, "done");
      wait(0.5);
      ring(id, false);
    } else if (id === "pr") {
      tl.to(q(".tp__lit"), { opacity: 1, duration: 0.3 });
      tl.to(dot, { opacity: 0, duration: 0.2 }, "<");
      say("pr");
      wait(3);
    }
  });
  return tl;
}

export function TeamPicture({ id }: { id?: string }) {
  const root = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [removed, setRemoved] = useState<Optional[]>([]);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = new ResizeObserver(() => setWidth(el.clientWidth));
    measure.observe(el);
    return () => measure.disconnect();
  }, []);

  const place = useMemo(() => layout(width), [width]);
  const stops = STOPS.filter((s) => !removed.includes(s.id as Optional));
  const order = stops.map((s) => s.id);
  const cycleKey = `${order.join()}:${place.wide}:${width}`;

  useGSAP(
    () => {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
      if (reduce || !width || !root.current) return;
      gsap.registerPlugin(ScrollTrigger);
      const cycle = buildCycle(root.current, order);
      if (!cycle) return;
      ScrollTrigger.create({
        trigger: root.current,
        start: "top 85%",
        end: "bottom top",
        animation: cycle,
        toggleActions: "play pause resume pause",
      });
    },
    { scope: root, dependencies: [cycleKey], revertOnUpdate: true },
  );

  const toggle = (stop: Optional) =>
    setRemoved((now) => (now.includes(stop) ? now.filter((s) => s !== stop) : [...now, stop]));

  const eng = place.at.eng;
  const tests = removed.includes("tests") ? null : loopPath(place.at.tests, eng, place.wide, 34);
  const rev = removed.includes("rev") ? null : loopPath(place.at.rev, eng, place.wide, 62);

  return (
    <figure
      ref={root}
      id={id}
      className={`tp${place.wide ? " tp--wide" : ""}`}
      data-ui
      aria-labelledby="team-picture-says"
    >
      <p id="team-picture-says" className="web-visually-hidden">
        A team at work: a task goes to the Product manager, you approve the spec, the Engineer
        builds it, Tests pass fails once and sends the work back, then passes, the Reviewer
        approves, the checks pass, and Ship opens a pull request.
      </p>
      <figcaption className="tp__bar">
        <span className="tp__caps" aria-hidden="true">
          {(Object.keys(CAPTIONS) as CaptionKey[]).map((key) => (
            <span
              key={key}
              data-cap={key}
              className={`tp__cap${key === FINISHED ? " tp__cap--end" : ""}`}
            >
              {CAPTIONS[key]}
            </span>
          ))}
        </span>
        <span className="tp__try">
          <span>The team is yours:</span>
          {(
            [
              ["tests", "Tests pass"],
              ["rev", "Reviewer"],
            ] as [Optional, string][]
          ).map(([stop, label]) => {
            const on = !removed.includes(stop);
            const Icon = on ? Check : Plus;
            return (
              <button
                key={stop}
                type="button"
                className="tp__toggle"
                aria-pressed={on}
                onClick={() => toggle(stop)}
              >
                <Icon size={15} strokeWidth={2} aria-hidden />
                {label}
              </button>
            );
          })}
        </span>
      </figcaption>
      <div ref={stage} className="tp__stage" style={{ height: place.height }} aria-hidden="true">
        <svg className="tp__lines" width="100%" height={place.height}>
          <defs>
            <marker
              id="tp-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path className="tp__tip" d="M0 0L8 4L0 8z" />
            </marker>
            <marker
              id="tp-back"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path className="tp__tip tp__tip--back" d="M0 0L8 4L0 8z" />
            </marker>
          </defs>
          {stops.slice(1).map((stop, i) => (
            <path
              key={stop.id}
              data-edge={`${order[i]}-${stop.id}`}
              className="tp__edge"
              markerEnd="url(#tp-arrow)"
              d={edgePath(place.at[order[i]], place.at[stop.id], place.wide)}
            />
          ))}
          {tests && (
            <path data-loop="tests" className="tp__loop" markerEnd="url(#tp-back)" d={tests.d} />
          )}
          {rev && <path data-loop="rev" className="tp__loop" markerEnd="url(#tp-back)" d={rev.d} />}
        </svg>
        {stops.map((stop) => {
          const box = place.at[stop.id];
          return (
            <div
              key={stop.id}
              data-stop={stop.id}
              className={`tp__n tp__n--${stop.kind}${stop.id === "pm" ? " tp__n--start" : ""}`}
              style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            >
              <span className="tp__ring" />
              {stop.kind === "pr" && <span className="tp__lit" />}
              <span className="tp__head">
                {stop.Icon && (
                  <span className="tp__ico">
                    <stop.Icon size={13} strokeWidth={1.7} />
                  </span>
                )}
                <span className="tp__t">{stop.title}</span>
              </span>
              {stop.does && <span className="tp__does">{stop.does}</span>}
              {stop.done && (
                <span className="tp__chips">
                  {stop.edits && <span className="tp__edits">{stop.edits}</span>}
                  <span className="tp__states">
                    {stop.run && (
                      <span className="tp__st tp__st--hot" data-st="run">
                        {stop.run}
                      </span>
                    )}
                    {stop.fail && (
                      <span className="tp__st tp__st--hot" data-st="fail">
                        {stop.fail}
                      </span>
                    )}
                    <span className="tp__st tp__st--end" data-st="done">
                      {stop.done}
                    </span>
                  </span>
                </span>
              )}
              {stop.model && <span className="tp__m">{stop.model}</span>}
            </div>
          );
        })}
        {tests && (
          <span className="tp__label" style={{ left: tests.label.x, top: tests.label.y }}>
            tests failed
          </span>
        )}
        {rev && (
          <span
            className="tp__label"
            style={{
              left: place.wide ? rev.label.x : Math.min(rev.label.x, width - 66),
              top: rev.label.y,
            }}
          >
            changes requested
          </span>
        )}
        <span className="tp__dot" />
      </div>
    </figure>
  );
}
