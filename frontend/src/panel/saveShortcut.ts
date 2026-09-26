/** "⌘S" on macOS, "Ctrl S" elsewhere (Desktop reports its platform; the web reads the browser's). */
export function saveShortcutLabel(): string {
  const platform =
    window.tvashtrDesktopInfo?.platform ??
    (typeof navigator !== "undefined" ? navigator.platform : "");
  return /mac|darwin/i.test(platform) ? "⌘S" : "Ctrl S";
}
