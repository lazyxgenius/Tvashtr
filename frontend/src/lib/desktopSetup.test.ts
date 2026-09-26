import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getDesktopSetupState,
  loadDesktopSetup,
  rememberAfterSetup,
  resetDesktopSetup,
  resumeStep,
  saveDesktopSetup,
  setupUnfinished,
  takeAfterSetup,
  useDesktopSetup,
} from "./desktopSetup";

const ID = "00000000-0000-4000-8000-000000000001";
const EMPTY: TvashtrDesktopSetup = {
  version: 1,
  step: null,
  finishedAt: null,
  planConsentAt: null,
  workspace: null,
};

function installSetup(record: Partial<TvashtrDesktopSetup> | "reject" = {}) {
  let stored = { ...EMPTY, ...(record === "reject" ? {} : record) };
  const setup = {
    get: vi.fn(() =>
      record === "reject" ? Promise.reject(new Error("nope")) : Promise.resolve({ ...stored }),
    ),
    update: vi.fn((_id: string, patch: Partial<TvashtrDesktopSetup>) => {
      stored = { ...stored, ...patch };
      return Promise.resolve({ ...stored });
    }),
  };
  window.tvashtrDesktop = { setup } as unknown as TvashtrDesktopBridge;
  return setup;
}

afterEach(() => {
  resetDesktopSetup();
  delete window.tvashtrDesktop;
});

describe("this Mac's setup store (DB-4, DT-17)", () => {
  it("the website (no bridge) has no setup to do", async () => {
    expect(await loadDesktopSetup(ID)).toBeNull();
    expect(getDesktopSetupState()).toEqual({ status: "none" });
    const { result } = renderHook(() => useDesktopSetup(ID));
    expect(result.current).toEqual({ status: "none" });
  });

  it("a new account starts unfinished at Engines; saving merges and keeps it in the store", async () => {
    const setup = installSetup();
    const loaded = await loadDesktopSetup(ID);
    expect(setup.get).toHaveBeenCalledWith(ID);
    expect(loaded).toEqual(EMPTY);
    expect(setupUnfinished(getDesktopSetupState())).toBe(true);
    expect(resumeStep(loaded!)).toBe("engines");

    await saveDesktopSetup({ step: "project" });
    expect(setup.update).toHaveBeenCalledWith(ID, { step: "project" });
    const state = getDesktopSetupState();
    expect(state.status === "ready" && resumeStep(state.setup)).toBe("project");

    await saveDesktopSetup({ finishedAt: "2026-09-26T10:00:00.000Z" });
    expect(setupUnfinished(getDesktopSetupState())).toBe(false);
  });

  it("a store that can't be read never blocks the app, and isn't asked again in a loop", async () => {
    const setup = installSetup("reject");
    const { result } = renderHook(() => useDesktopSetup(ID));
    await waitFor(() => expect(result.current).toEqual({ status: "none", accountId: ID }));
    expect(setup.get).toHaveBeenCalledTimes(1);
    await expect(saveDesktopSetup({ step: "team" })).rejects.toThrow(
      "Couldn't save this Mac's setup. Try again.",
    );
  });

  it("the hook loads the account's setup when the launch didn't (a browser sign-in)", async () => {
    installSetup({ step: "team" });
    const { result } = renderHook(() => useDesktopSetup(ID));
    expect(result.current).toEqual({ status: "loading", accountId: ID });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.status === "ready" && result.current.setup.step).toBe("team");
  });

  it("signing out forgets it, and a late answer for the old account is dropped", async () => {
    let answer: (v: TvashtrDesktopSetup) => void = () => {};
    const setup = installSetup();
    setup.get.mockImplementation(() => new Promise((r) => (answer = r)));
    const pending = loadDesktopSetup(ID);
    act(() => resetDesktopSetup());
    answer({ ...EMPTY });
    expect(await pending).toBeNull();
    expect(getDesktopSetupState()).toEqual({ status: "none" });
  });

  it("remembers where the user was headed until setup finishes (OQ-34)", () => {
    rememberAfterSetup("#/engines/keys");
    expect(takeAfterSetup()).toBe("#/engines/keys");
    expect(takeAfterSetup()).toBeNull();
  });
});
