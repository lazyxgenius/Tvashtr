import type { CreateNodeBody } from "../lib/api";
import { type PaletteChip, PALETTE_PRESETS, PALETTE_PRIMITIVES } from "./paletteItems";

// F1b: the inline "+" kind picker — opened when a thinker/worker node's hover "+" is clicked. It
// reuses the EXACT palette menu (single source of truth), so Add primitives (Thinker/Worker/Gate/
// Ship/Stop) + Presets (PM/Architect/Engineer/Reviewer) stay identical between the top-left palette
// and this inline picker. Picking an item adds the next node DOWNSTREAM of the source (a forward
// edge), via the parent's `onAddDownstream`. Anchored near the node at (x, y) in canvas-local px.
export function NodePicker({
  x,
  y,
  onPick,
  onCancel,
}: {
  x: number;
  y: number;
  onPick: (body: CreateNodeBody) => void;
  onCancel: () => void;
}) {
  return (
    <>
      <div className="tv-picker__backdrop" onClick={onCancel} aria-hidden />
      <div
        className="tv-picker"
        role="dialog"
        aria-label="Add a downstream node"
        style={{ left: x, top: y }}
      >
        <div className="tv-picker__label">Add node</div>
        <PickerGroup items={PALETTE_PRIMITIVES} onPick={onPick} />
        <div className="tv-picker__divider" />
        <PickerGroup items={PALETTE_PRESETS} onPick={onPick} />
      </div>
    </>
  );
}

function PickerGroup({
  items,
  onPick,
}: {
  items: PaletteChip[];
  onPick: (body: CreateNodeBody) => void;
}) {
  return (
    <>
      {items.map((c) => (
        <button
          key={c.label}
          type="button"
          className="tv-picker__item"
          onClick={() => onPick(c.body)}
        >
          <span className="tv-picker__icon">
            <c.Icon size={14} strokeWidth={1.7} />
          </span>
          <span className="tv-picker__text">
            <span className="tv-picker__name">{c.label}</span>
            <span className="tv-picker__desc">{c.title}</span>
          </span>
        </button>
      ))}
    </>
  );
}
