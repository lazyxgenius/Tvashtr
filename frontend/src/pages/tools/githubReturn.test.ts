import { afterEach, describe, expect, it } from "vitest";

import {
  BEFORE_KEY,
  RETURN_KEY,
  forgetGithubReturn,
  rememberGithubReturn,
  takeGithubBefore,
  takeGithubReturn,
} from "./githubReturn";
import { githubChanged } from "./useGithubStatus";

afterEach(() => sessionStorage.clear());

const status = (installed: boolean, repo_count: number) => ({
  hosted: true,
  installed,
  installation_count: installed ? 1 : 0,
  repo_count,
});

describe("the GitHub round trip's memory", () => {
  it("remembers Browse and what it saw, and hands each back once", () => {
    rememberGithubReturn({ installed: false, repo_count: 0 });
    expect(takeGithubReturn()).toBe("#/toolkit/tools/browse");
    expect(takeGithubReturn()).toBeNull();
    expect(takeGithubBefore()).toEqual({ installed: false, repo_count: 0 });
    expect(takeGithubBefore()).toBeNull();
  });

  it("ignores values it didn't write", () => {
    sessionStorage.setItem(RETURN_KEY, "https://evil.example/");
    sessionStorage.setItem(BEFORE_KEY, "{not json");
    expect(takeGithubReturn()).toBeNull();
    expect(takeGithubBefore()).toBeNull();
    sessionStorage.setItem(BEFORE_KEY, JSON.stringify({ installed: "yes", repo_count: 2 }));
    expect(takeGithubBefore()).toBeNull();
  });

  it("forgets both when the page is still here", () => {
    rememberGithubReturn({ installed: true, repo_count: 2 });
    forgetGithubReturn();
    expect(sessionStorage.length).toBe(0);
  });
});

describe("githubChanged", () => {
  it("is true when the App got installed or its repo count changed", () => {
    expect(githubChanged({ installed: false, repo_count: 0 }, status(true, 2))).toBe(true);
    expect(githubChanged({ installed: true, repo_count: 2 }, status(true, 3))).toBe(true);
    expect(githubChanged({ installed: true, repo_count: 2 }, status(true, 2))).toBe(false);
    expect(githubChanged({ installed: false, repo_count: 0 }, status(false, 0))).toBe(false);
  });
});
