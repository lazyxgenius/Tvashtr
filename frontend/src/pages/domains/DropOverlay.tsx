/**
 * The overlay while files are dragged over a domain's Sources tab (DM-40, DmF-Drag-1): a coral
 * dashed box over the tab body with "Drop to add <n> files to <name>". The table can run past the
 * window, so the box is clamped to the part of the tab body on screen (the frame ends it 26px
 * above the window's bottom, the page's padding).
 */
import { useLayoutEffect, useRef } from "react";
import { Upload } from "lucide-react";

const BOTTOM_GAP = 26;

export function DropOverlay({ count, domainName }: { count: number; domainName: string }) {
  const box = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = box.current;
    const body = el?.parentElement?.getBoundingClientRect();
    if (!el || !body || body.height === 0) return;
    const top = Math.max(0, -body.top);
    const bottom = Math.min(body.height, window.innerHeight - BOTTOM_GAP - body.top);
    el.style.top = `${top}px`;
    el.style.height = `${Math.max(0, bottom - top)}px`;
  }, []);

  const what = count === 1 ? "1 file" : count > 1 ? `${count} files` : "files";
  return (
    <div ref={box} className="dm-dropover" data-testid="drop-overlay">
      <span className="dm-dropover__tile">
        <Upload size={26} strokeWidth={1.6} aria-hidden />
      </span>
      <div className="dm-dropover__title">
        Drop to add {what} to {domainName}
      </div>
      <div className="dm-dropover__sub">
        They’re read automatically. You can ask about them in about a minute.
      </div>
    </div>
  );
}
