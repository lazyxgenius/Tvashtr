import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "./time";

// All inputs are computed relative to the real Date.now() so no clock mocking is needed; the
// formatter is pure and the sub-millisecond call delay never crosses a unit boundary.
function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

describe("formatRelativeTime", () => {
  it("reads 'just now' under a minute", () => {
    expect(formatRelativeTime(isoAgo(5 * 1000))).toBe("just now");
    expect(formatRelativeTime(isoAgo(59 * 1000))).toBe("just now");
  });

  it("reads '{n}m ago' under an hour", () => {
    expect(formatRelativeTime(isoAgo(5 * 60 * 1000))).toBe("5m ago");
    expect(formatRelativeTime(isoAgo(59 * 60 * 1000))).toBe("59m ago");
  });

  it("reads '{n}h ago' under a day", () => {
    expect(formatRelativeTime(isoAgo(2 * 60 * 60 * 1000))).toBe("2h ago");
    expect(formatRelativeTime(isoAgo(23 * 60 * 60 * 1000))).toBe("23h ago");
  });

  it("reads '{n}d ago' under a week", () => {
    expect(formatRelativeTime(isoAgo(3 * 24 * 60 * 60 * 1000))).toBe("3d ago");
    expect(formatRelativeTime(isoAgo(6 * 24 * 60 * 60 * 1000))).toBe("6d ago");
  });

  it("reads a short absolute date past ~7 days (not a relative phrase)", () => {
    const out = formatRelativeTime(isoAgo(30 * 24 * 60 * 60 * 1000));
    expect(out).not.toMatch(/ago|just now/);
    expect(out.length).toBeGreaterThan(0); // e.g. "May 27"
  });

  it("a future timestamp reads 'just now' (clock skew); an unparseable input reads ''", () => {
    expect(formatRelativeTime(new Date(Date.now() + 10_000).toISOString())).toBe("just now");
    expect(formatRelativeTime("not-a-date")).toBe("");
  });
});
