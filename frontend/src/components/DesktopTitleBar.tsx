/**
 * The Desktop design's window title strip: 30px of ink (#232220) with the title centred. On macOS
 * the Electron shell hides the system title bar and puts the traffic lights inside this strip
 * (desktop/electron/windowOptions.cjs), so the strip is a drag region. Everywhere else — the
 * website, and Desktop on Windows/Linux where the native frame stays — it renders nothing.
 */
export function DesktopTitleBar() {
  const info = typeof window === "undefined" ? undefined : window.tvashtrDesktopInfo;
  if (!window.tvashtrDesktop || info?.platform !== "darwin") return null;
  return (
    <div className="tv-titlebar" data-testid="desktop-titlebar">
      <span className="tv-titlebar__title">Tvashtr — the living canvas</span>
    </div>
  );
}
