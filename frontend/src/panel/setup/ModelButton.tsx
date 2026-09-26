import type { Ref } from "react";
import { ChevronDown } from "lucide-react";

import { providerOf } from "../../lib/api";
import { modelId } from "../nodeBadges";

/**
 * The model button (PANEL-39): the provider's letter tile and the model id, or "Choose a model" /
 * "None" (the backup model) when nothing is set. A model the catalogue doesn't list (a custom ID)
 * shows its whole slug without a tile (Panel-Warnings' backup model). Opens the model picker.
 */
export function ModelButton({
  model,
  emptyLabel,
  onOpen,
  expanded,
  catalogued = true,
  buttonRef,
  controls,
}: {
  model: string;
  emptyLabel: string;
  onOpen?: () => void;
  expanded?: boolean;
  /** The slug is one the catalogue lists (tile + short id); otherwise the full slug. */
  catalogued?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  /** The listbox this button opens (while it's open). */
  controls?: string;
}) {
  const slug = model.trim();
  return (
    <button
      ref={buttonRef}
      type="button"
      className="nd-model"
      aria-haspopup="listbox"
      aria-expanded={expanded ?? false}
      aria-controls={controls}
      onClick={onOpen}
    >
      {slug && catalogued ? (
        <>
          <span className="nd-model__tile" aria-hidden>
            {(providerOf(slug)[0] ?? "?").toUpperCase()}
          </span>
          <span className="nd-model__id">{modelId(slug)}</span>
        </>
      ) : slug ? (
        <span className="nd-model__id">{slug}</span>
      ) : (
        <span className="nd-model__none">{emptyLabel}</span>
      )}
      <span className="nd-model__chev" aria-hidden>
        <ChevronDown size={14} strokeWidth={1.7} />
      </span>
    </button>
  );
}
