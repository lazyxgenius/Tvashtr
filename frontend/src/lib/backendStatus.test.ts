import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetBackendStatusForTests,
  failureForStatus,
  probeBackend,
  probeBackendWithRetries,
  useBackendStatus,
} from "./backendStatus";

function answer(status: number, body: unknown = { status: "ok", db: "ok" }) {
  return vi.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  __resetBackendStatusForTests();
});

describe("probeBackend — the launch check with a failure kind", () => {
  it("is ok when /health answers ok, and records it", async () => {
    vi.stubGlobal("fetch", answer(200));
    const { result } = renderHook(() => useBackendStatus());
    let out: Awaited<ReturnType<typeof probeBackend>> | null = null;
    await act(async () => {
      out = await probeBackend();
    });
    expect(out).toEqual({ ok: true });
    expect(result.current.state).toBe("connected");
  });

  it("splits the failures the Offline line names", async () => {
    vi.stubGlobal("fetch", answer(502));
    expect(await probeBackend()).toEqual({ ok: false, kind: "unreachable" });
    vi.stubGlobal("fetch", answer(504));
    expect(await probeBackend()).toEqual({ ok: false, kind: "unreachable" });
    vi.stubGlobal("fetch", answer(500));
    expect(await probeBackend()).toEqual({ ok: false, kind: "error", status: 500 });
    vi.stubGlobal("fetch", answer(200, { status: "degraded", db: "down" }));
    expect(await probeBackend()).toEqual({ ok: false, kind: "error", status: "db down" });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    expect(await probeBackend()).toEqual({ ok: false, kind: "unreachable" });
    expect(failureForStatus(503)).toEqual({ kind: "error", status: 503 });
  });

  it("aborts the request after the timeout and says so", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      }),
    );
    const pending = probeBackend(10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({ ok: false, kind: "timeout" });
    expect(signal?.aborted).toBe(true);
  });
});

describe("probeBackendWithRetries", () => {
  it("stops at the first success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: () => Promise.resolve({}) })
      .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ db: "ok" }) });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    const pending = probeBackendWithRetries();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await pending).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops between tries once cancelled", async () => {
    const fetchMock = answer(503);
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    let cancelled = false;
    const pending = probeBackendWithRetries(() => cancelled);
    await vi.advanceTimersByTimeAsync(0);
    cancelled = true;
    await vi.advanceTimersByTimeAsync(3_000);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
