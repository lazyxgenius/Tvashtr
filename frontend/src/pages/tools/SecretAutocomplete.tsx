/**
 * The `${` secret picker (TkF-AddTool-3, TOOL-38): a listbox of your stored secrets with who uses
 * each ("used by github", "not used"), a divider, then "Create <NAME>". The input that owns it keeps
 * focus (`aria-activedescendant`); the mouse picks without stealing focus.
 */
import { KeyRound, Plus } from "lucide-react";
import { Fragment } from "react";

import type { PickerOption } from "./connectionForm";

export function SecretAutocomplete({
  id,
  options,
  active,
  onPick,
  onHover,
}: {
  id: string;
  options: PickerOption[];
  active: number;
  onPick: (option: PickerOption) => void;
  onHover: (index: number) => void;
}) {
  return (
    <div role="listbox" id={id} aria-label="Secrets" className="tk-ac">
      {options.map((o, i) => (
        <Fragment key={`${o.kind}-${o.name}`}>
          {o.kind === "create" && i > 0 && <div className="tk-ac__sep" aria-hidden="true" />}
          <div
            role="option"
            id={`${id}-${i}`}
            aria-selected={i === active}
            className="tk-ac__opt"
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onHover(i)}
            onClick={() => onPick(o)}
          >
            {o.kind === "secret" ? (
              <>
                <KeyRound size={13} strokeWidth={1.6} aria-hidden />
                <span className="tk-ac__name">{o.name}</span>
                <span className="tk-ac__usage">{o.usage}</span>
              </>
            ) : (
              <>
                <Plus size={13} strokeWidth={1.6} aria-hidden />
                <span className="tk-ac__create">
                  Create <span className="tk-ac__mono">{o.name}</span>
                </span>
              </>
            )}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
