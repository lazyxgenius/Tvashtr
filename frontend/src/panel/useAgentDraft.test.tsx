import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TeamGraphNode } from "../lib/api";
import { __resetBackendStatusForTests } from "../lib/backendStatus";
import { useAgentDraft } from "./useAgentDraft";

function node(over: Partial<TeamGraphNode> = {}): TeamGraphNode {
  return {
    id: "n-rev",
    role_name: "reviewer",
    kind: "agent",
    model: "xai/grok-4.7",
    engine: "openhands",
    prompt: "You are the Reviewer",
    position: { x: 0, y: 0 },
    edits_allowed: false,
    config: { title: "Reviewer" },
    tool_config: null,
    skills: null,
    ...over,
  };
}

const ok = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  __resetBackendStatusForTests();
});

describe("useAgentDraft", () => {
  it("tracks changes, PATCHes only them, and is clean right after Save", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      ok(node({ multimodal: true } as never)),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    const { result } = renderHook(() => useAgentDraft(node(), { teamId: "t1", onSaved }));
    expect(result.current.isDirty).toBe(false);

    act(() => result.current.set("multimodal", true));
    expect(result.current.changed).toEqual(["images"]);
    expect(result.current.dirtyCount).toBe(1);

    let saved = false;
    await act(async () => {
      saved = await result.current.save();
    });
    expect(saved).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/teams/t1/nodes/n-rev");
    expect(JSON.parse(init!.body as string)).toEqual({ multimodal: true });
    expect(result.current.isDirty).toBe(false);
    expect(result.current.saveState).toBe("saved");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("Discard restores the saved values", () => {
    const { result } = renderHook(() => useAgentDraft(node(), { teamId: "t1" }));
    act(() => result.current.update({ prompt: "Other", editsAllowed: true }));
    expect(result.current.dirtyCount).toBe(2);
    act(() => result.current.discard());
    expect(result.current.isDirty).toBe(false);
    expect(result.current.draft.prompt).toBe("You are the Reviewer");
  });

  it("won't save empty instructions", async () => {
    const fetchMock = vi.fn(() => ok({}));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAgentDraft(node(), { teamId: "t1" }));
    act(() => result.current.set("prompt", "   "));
    expect(result.current.problem).toBe("Instructions can’t be empty.");
    await act(async () => {
      await result.current.save();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's words on a refused save and keeps the draft", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        ok(
          {
            detail: "The first agent writes the shared spec the team reads, so it stays read-only.",
          },
          409,
        ),
      ),
    );
    const { result } = renderHook(() => useAgentDraft(node(), { teamId: "t1" }));
    act(() => result.current.set("editsAllowed", true));
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.saveState).toBe("error");
    expect(result.current.saveError).toMatch(/stays read-only/);
    expect(result.current.isDirty).toBe(true);
  });

  it("a refetched node re-seeds a clean draft but keeps a dirty one", () => {
    const { result, rerender } = renderHook(({ n }) => useAgentDraft(n, { teamId: "t1" }), {
      initialProps: { n: node() },
    });
    rerender({ n: node({ model: "openai/gpt-4.1-mini" }) });
    expect(result.current.draft.model).toBe("openai/gpt-4.1-mini");
    expect(result.current.isDirty).toBe(false);

    act(() => result.current.set("prompt", "Mine"));
    rerender({ n: node({ model: "openai/gpt-4.1-mini", skills: [{ type: "inline" }] }) });
    expect(result.current.draft.prompt).toBe("Mine");
    // The Toolkit-side skills change is picked up, never reverted: only the user's edit is a change.
    expect(result.current.changed).toEqual(["instructions"]);
    expect(result.current.draft.skills).toEqual([{ type: "inline" }]);
  });

  it("another node starts over", () => {
    const { result, rerender } = renderHook(({ n }) => useAgentDraft(n, { teamId: "t1" }), {
      initialProps: { n: node() },
    });
    act(() => result.current.set("prompt", "Mine"));
    rerender({ n: node({ id: "n-eng", prompt: "Engineer" }) });
    expect(result.current.isDirty).toBe(false);
    expect(result.current.draft.prompt).toBe("Engineer");
  });

  it("the saved notice decays to clean", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => ok(node())),
    );
    const { result } = renderHook(() => useAgentDraft(node(), { teamId: "t1" }));
    act(() => result.current.set("multimodal", true));
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.saveState).toBe("saved");
    act(() => {
      vi.advanceTimersByTime(4100);
    });
    await waitFor(() => expect(result.current.saveState).toBe("idle"));
  });
});
