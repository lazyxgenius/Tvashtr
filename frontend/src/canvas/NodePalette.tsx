import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";

import type { CreateNodeBody } from "../lib/api";
import { PALETTE_PRESETS, PALETTE_PRIMITIVES } from "./paletteItems";

// The canvas palette (P1.8d): drop blank primitives or a pre-filled-but-editable role preset onto
// the open team (node-granularity drop-and-edit). Distinct from the left teams rail: this adds
// NODES to the current team. The parent fills in the drop `position` (auto, via nextDropPosition).
//
// F1b: relocated to the design's compact top-left "+" that opens an "Add to canvas" popover (was a
// persistent bottom tray). The menu itself lives in `./paletteItems` — the same items the inline
// node "+" picker uses (single source of truth). Ship + Stop stay SEPARATE (see paletteItems).
//
// F-canvas-fidelity-2 Part 4: the popover now opens on HOVER (the design's behavior), with the click
// still toggling it. A short close-grace bridges the small gap between the trigger and the panel below
// it; leaving the palette (or picking an item) closes it. No full-screen backdrop — it would sit under
// the hover region and defeat the mouse-leave close.

export function NodePalette({
  onAdd,
  disabled = false,
}: {
  onAdd: (body: CreateNodeBody) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const openNow = () => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const closeSoon = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  };

  const add = (body: CreateNodeBody) => {
    onAdd(body);
    setOpen(false);
  };

  return (
    <div className="tv-palette" onMouseEnter={openNow} onMouseLeave={closeSoon}>
      <button
        type="button"
        className={`tv-palette__trigger${open ? " tv-palette__trigger--open" : ""}`}
        title="Add to canvas"
        aria-label="Add to canvas"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <Plus size={17} strokeWidth={1.8} />
      </button>
      {open && (
        <div className="tv-palette__panel" role="menu" aria-label="Add to canvas">
          <div className="tv-palette__label">Add to canvas</div>
          <div className="tv-palette__grid">
            {PALETTE_PRIMITIVES.map((c) => (
              <button
                key={c.label}
                type="button"
                className="tv-palette__chip"
                title={c.title}
                disabled={disabled}
                onClick={() => add(c.body)}
              >
                <c.Icon size={13} strokeWidth={1.6} />
                {c.label}
              </button>
            ))}
          </div>
          <div className="tv-palette__label">Presets</div>
          <div className="tv-palette__grid">
            {PALETTE_PRESETS.map((c) => (
              <button
                key={c.label}
                type="button"
                className="tv-palette__chip tv-palette__chip--preset"
                title={c.title}
                disabled={disabled}
                onClick={() => add(c.body)}
              >
                <c.Icon size={13} strokeWidth={1.6} />
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
