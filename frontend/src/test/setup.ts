// Vitest global setup (vite.config.ts `setupFiles`).
//
// 1. jest-dom matchers (`toBeInTheDocument`, `toHaveTextContent`, …) on the global `expect`.
// 2. The jsdom shims React Flow needs: it measures the DOM via ResizeObserver / DOMMatrixReadOnly
//    / element box metrics, none of which jsdom implements. Without these the canvas renders
//    zero nodes/edges and the canvas-level RTL tests can't see anything. (Adapted from the
//    @xyflow/react testing guide.)
import "@testing-library/jest-dom/vitest";

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
