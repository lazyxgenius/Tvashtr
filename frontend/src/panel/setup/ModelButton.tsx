import { ChevronDown } from "lucide-react";

import { providerOf } from "../../lib/api";
import { modelId } from "../nodeBadges";

/**
 * The model button (PANEL-39): the provider's letter tile and the model id, or "Choose a model" /
 * "None" (the backup model) when nothing is set. Opens the model picker.
 */
export function ModelButton({
  model,
  emptyLabel,
  onOpen,
  expanded,
}: {
  model: string;
  emptyLabel: string;
  onOpen?: () => void;
  expanded?: boolean;
}) {
  const slug = model.trim();
  return (
    <button
      type="button"
      className="nd-model"
      aria-haspopup="listbox"
      aria-expanded={expanded ?? false}
      onClick={onOpen}
    >
      {slug ? (
        <>
          <span className="nd-model__tile" aria-hidden>
            {(providerOf(slug)[0] ?? "?").toUpperCase()}
          </span>
          <span className="nd-model__id">{modelId(slug)}</span>
        </>
      ) : (
        <span className="nd-model__none">{emptyLabel}</span>
      )}
      <span className="nd-model__chev" aria-hidden>
        <ChevronDown size={14} strokeWidth={1.7} />
      </span>
    </button>
  );
}
