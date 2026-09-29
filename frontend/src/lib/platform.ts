/**
 * Which computer the visitor is on, for the download page (website.md WEB-32).
 *
 * - `os` comes from User-Agent Client Hints (`navigator.userAgentData.platform`) when the browser
 *   has them, else the user agent. iPhone, iPad and Android are `phone` (an iPad that asks for the
 *   desktop site says "Mac" but has a touch screen).
 * - `arch` only from UA-CH's high-entropy `architecture` (Chromium). Safari and Firefox report
 *   Intel even on Apple silicon, so they give `unknown` and the page never claims Apple silicon.
 */
import { useEffect, useState } from "react";

export type Os = "mac" | "windows" | "linux" | "phone" | "unknown";
export type Arch = "arm" | "x86" | "unknown";

interface UaData {
  platform?: string;
  mobile?: boolean;
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
}
type Nav = Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints"> & {
  userAgentData?: UaData;
};

export function detectOs(nav: Nav): Os {
  const ua = nav.userAgent ?? "";
  if (nav.userAgentData?.mobile || /iphone|ipad|ipod|android/i.test(ua)) return "phone";
  const platform = nav.userAgentData?.platform || nav.platform || ua;
  if (/mac/i.test(platform)) return (nav.maxTouchPoints ?? 0) > 1 ? "phone" : "mac";
  if (/win/i.test(platform)) return "windows";
  if (/linux|x11/i.test(platform)) return "linux";
  return "unknown";
}

export async function detectArch(nav: Nav): Promise<Arch> {
  try {
    const { architecture } =
      (await nav.userAgentData?.getHighEntropyValues?.(["architecture"])) ?? {};
    return architecture === "arm" || architecture === "x86" ? architecture : "unknown";
  } catch {
    return "unknown";
  }
}

/** This browser's platform. `arch` is null for the moment UA-CH takes to answer, so nothing claims
 *  a Mac kind before it knows. */
export function usePlatform(): { os: Os; arch: Arch | null } {
  const [os] = useState(() => detectOs(navigator as Nav));
  const [arch, setArch] = useState<Arch | null>(null);
  useEffect(() => {
    let live = true;
    void detectArch(navigator as Nav).then((a) => {
      if (live) setArch(a);
    });
    return () => {
      live = false;
    };
  }, []);
  return { os, arch };
}
