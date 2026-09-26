// Vitest global setup (vite.config.ts `setupFiles`).
//
// 1. jest-dom matchers (`toBeInTheDocument`, `toHaveTextContent`, …) on the global `expect`.
// 2. The jsdom shims React Flow needs: it measures the DOM via ResizeObserver / DOMMatrixReadOnly
//    / element box metrics, none of which jsdom implements. Without these the canvas renders
//    zero nodes/edges and the canvas-level RTL tests can't see anything. (Adapted from the
//    @xyflow/react testing guide.)
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

import { setProviderCatalogue } from "../lib/api";

// React Flow's <MiniMap> can't project node geometry under jsdom: the box-metric shims below satisfy
// the main canvas, but the minimap's own SVG viewport divides by an element box it never gets a real
// size for, so it spews `Received NaN` for its `cx/cy/r/x/y` attributes and fires an
// `update to MiniMap … not wrapped in act(...)` on its ResizeObserver tick. It renders nothing any
// canvas test asserts on, so stub ONLY that one export to render null; every other @xyflow/react
// export (ReactFlow, Background, Controls, Handle, …) stays the real implementation.
vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return { ...actual, MiniMap: () => null };
});

class ResizeObserverMock {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element): void {
    // Fire immediately so React Flow gets a size and lays the graph out synchronously.
    this.callback([{ target } as ResizeObserverEntry], this);
  }
  unobserve(): void {}
  disconnect(): void {}
}

class DOMMatrixReadOnlyMock {
  readonly m22: number;
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
    this.m22 = scale === undefined ? 1 : Number(scale);
  }
}

globalThis.ResizeObserver = ResizeObserverMock;
globalThis.DOMMatrixReadOnly = DOMMatrixReadOnlyMock as unknown as typeof DOMMatrixReadOnly;

// Non-zero box metrics so React Flow believes nodes are measured.
Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: {
    get(this: HTMLElement): number {
      return parseFloat(this.style.height) || 1;
    },
  },
  offsetWidth: {
    get(this: HTMLElement): number {
      return parseFloat(this.style.width) || 1;
    },
  },
});

(SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () =>
  ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;

// M-runnable: the provider catalogue is served on GET /api/config and cached in api.ts at boot. Tests
// have no boot fetch, so seed a representative catalogue here (mirrors the backend
// control_plane.teams.PROVIDER_CATALOGUE) exactly as getConfig would — so the node picker's
// quick-picks + the dashboard's provider suggestions resolve in component tests. A test needing a
// specific catalogue overrides it with setProviderCatalogue.
setProviderCatalogue([
  {
    provider: "openrouter",
    // 2026-09-26: the thinker moved to gpt-4.1-mini (gpt-4o-mini failed the entry node's REPORT.md
    // job 4/4 live); the worker seat is unchanged — mirrored exactly from the backend catalogue.
    thinker_default: "openrouter/openai/gpt-4.1-mini",
    worker_default: "openrouter/openai/gpt-4o-mini",
    thinker_presets: [
      "openrouter/openai/gpt-4.1-mini",
      "openrouter/meta-llama/llama-3.1-8b-instruct",
      "openrouter/google/gemini-flash-1.5",
    ],
    worker_presets: ["openrouter/openai/gpt-4o-mini"],
  },
  {
    provider: "nvidia_nim",
    // NIM declares NO seat, mirrored exactly from the backend catalogue: no worker since 2026-09-25
    // (minimax-m3 retired; gpt-oss-20b breaks the loop), no thinker since 2026-09-26 (gpt-oss-20b
    // hangs). The provider itself stays catalogued.
    thinker_default: null,
    worker_default: null,
    thinker_presets: [],
    worker_presets: [],
  },
  {
    provider: "openai",
    // 2026-09-26: the thinker moved to gpt-4.1-mini too, so both seats read the same slug.
    thinker_default: "openai/gpt-4.1-mini",
    worker_default: "openai/gpt-4.1-mini",
    thinker_presets: ["openai/gpt-4.1-mini"],
    worker_presets: ["openai/gpt-4.1-mini"],
  },
  {
    // M-seat, probed: gemini drives the agent loop and cannot produce a deliverable under the
    // output ceiling. Kept EXACTLY as the backend declares it, `null` included — a fixture that
    // rounded it up to a slug would hide the one shape these tests most need to cover.
    provider: "gemini",
    thinker_default: null,
    worker_default: "gemini/gemini-2.5-flash",
    thinker_presets: [],
    worker_presets: ["gemini/gemini-2.5-flash"],
  },
  {
    provider: "groq",
    thinker_default: "groq/openai/gpt-oss-120b",
    worker_default: "groq/openai/gpt-oss-120b",
    thinker_presets: ["groq/openai/gpt-oss-120b"],
    worker_presets: ["groq/openai/gpt-oss-120b"],
  },
  {
    provider: "deepseek",
    thinker_default: "deepseek/deepseek-chat",
    worker_default: "deepseek/deepseek-chat",
    thinker_presets: ["deepseek/deepseek-chat"],
    worker_presets: ["deepseek/deepseek-chat"],
  },
]);
