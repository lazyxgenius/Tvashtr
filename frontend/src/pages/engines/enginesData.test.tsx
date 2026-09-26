import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SavedKey } from "../../lib/api/engines";
import { type EnginesData, EnginesDataProvider, useEngines } from "./enginesData";
import {
  KEYS,
  SUBS,
  installDesktop,
  key,
  mockEnginesApi,
  resetEnginesState,
  sub,
} from "./enginesTestUtils";

beforeEach(() => resetEnginesState());
afterEach(() => {
  vi.unstubAllGlobals();
  resetEnginesState();
});

let engines: EnginesData | null = null;

/** Run `fn`, then let every promise it settles (the fetch answers, the refresh) land. */
async function settle(fn: () => void) {
  await act(async () => {
    fn();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function Probe() {
  engines = useEngines();
  const grok = engines.subs.find((s) => s.provider === "grok");
  return (
    <div data-testid="probe" data-status={engines.status} data-grok={grok?.state}>
      {engines.keys.map((k) => k.provider).join(",")}
    </div>
  );
}

function renderData() {
  render(
    <EnginesDataProvider>
      <Probe />
    </EnginesDataProvider>,
  );
  return screen.getByTestId("probe");
}

/** GET /api/providers answers at once on the first load; later reads wait for `release()`. */
function slowProvidersAfterFirst() {
  let calls = 0;
  let release: (keys: SavedKey[]) => void = () => undefined;
  const reply = () => {
    calls += 1;
    if (calls === 1) return { providers: KEYS };
    return new Promise((resolve) => {
      release = (keys) => resolve({ providers: keys });
    });
  };
  return { reply, release: (keys: SavedKey[]) => release(keys), calls: () => calls };
}

describe("a refresh never undoes a change made while it was in flight", () => {
  it("keeps a key saved during a focus refresh", async () => {
    const providers = slowProvidersAfterFirst();
    mockEnginesApi({ "GET /api/providers": providers.reply });
    const probe = renderData();
    await waitFor(() => expect(probe).toHaveAttribute("data-status", "ready"));

    act(() => {
      fireEvent.focus(window);
    });
    await waitFor(() => expect(providers.calls()).toBe(2));
    act(() => engines!.setKeys([key("anthropic", "wQ3f"), ...KEYS]));
    expect(probe).toHaveTextContent("anthropic,openrouter");

    // The refresh read the keys before the save landed.
    await settle(() => providers.release(KEYS));
    expect(probe.textContent?.split(",")).toContain("anthropic");
  });

  it("keeps a subscription status the Desktop pushed during a focus refresh", async () => {
    const providers = slowProvidersAfterFirst();
    mockEnginesApi({ "GET /api/providers": providers.reply });
    const desktop = installDesktop(SUBS);
    const probe = renderData();
    await waitFor(() => expect(probe).toHaveAttribute("data-status", "ready"));
    expect(probe).toHaveAttribute("data-grok", "needs_login");

    act(() => {
      fireEvent.focus(window);
    });
    await waitFor(() => expect(providers.calls()).toBe(2));
    // getStatus already answered with the cached needs_login; then the re-probe pushes connected.
    act(() => desktop.push(sub("grok", "connected")));
    expect(probe).toHaveAttribute("data-grok", "connected");

    await settle(() => providers.release(KEYS));
    expect(probe).toHaveAttribute("data-grok", "connected");
  });

  it("still takes everything else the refresh read", async () => {
    const providers = slowProvidersAfterFirst();
    mockEnginesApi({ "GET /api/providers": providers.reply });
    const probe = renderData();
    await waitFor(() => expect(probe).toHaveAttribute("data-status", "ready"));
    act(() => {
      fireEvent.focus(window);
    });
    await waitFor(() => expect(providers.calls()).toBe(2));
    await settle(() => providers.release([key("xai", "9Kx2")]));
    expect(probe).toHaveTextContent(/^xai$/);
  });
});
