/**
 * The Connection step's "Headers" (Remote) and "Environment" (Local) rows (TOOL-35, TOOL-36): a
 * name input, a value that shows `${NAME}` chips and opens the secret picker, and a remove button;
 * then "Add header" / "Add variable".
 */
import { Plus, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

import { Button, IconButton, Input, cx } from "../../design-system/components";
import { SecretRefInput } from "./SecretRefInput";
import type { SecretOption } from "./connectionForm";
import type { KeyValueRow } from "./toolConfig";

const COPY = {
  header: {
    title: "Headers",
    name: "Header name",
    value: "value",
    add: "Add header",
    remove: "Remove header",
  },
  env: {
    title: "Environment",
    name: "Variable name",
    value: "value",
    add: "Add variable",
    remove: "Remove variable",
  },
} as const;

export function KeyValueRows({
  kind,
  rows,
  onChange,
  options,
  stored,
  suggestion,
}: {
  kind: "header" | "env";
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
  options: SecretOption[];
  stored: Set<string> | null;
  suggestion: string;
}) {
  const copy = COPY[kind];
  const id = useId();
  const grid = useRef<HTMLDivElement>(null);
  const added = useRef(false);

  // "Add header" puts the cursor in the new row's name.
  useEffect(() => {
    if (!added.current) return;
    added.current = false;
    const inputs = grid.current?.querySelectorAll<HTMLInputElement>(".tk-kv__key");
    inputs?.[inputs.length - 1]?.focus();
  }, [rows.length]);

  const update = (i: number, patch: Partial<KeyValueRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="tk-kv" role="group" aria-labelledby={`${id}-title`}>
      <span id={`${id}-title`} className="tk-wiz__label">
        {copy.title}
      </span>
      {rows.length > 0 && (
        <div ref={grid} className={cx("tk-kv__grid", kind === "env" && "tk-kv__grid--env")}>
          {rows.map((row, i) => {
            const nameId = `${id}-name-${i}`;
            const valueId = `${id}-value-${i}`;
            return (
              <div key={i} className="tk-kv__row">
                <span id={nameId} className="tk-sr">
                  {`${copy.name} ${i + 1}`}
                </span>
                <Input
                  size="sm"
                  className="tk-kv__key"
                  aria-labelledby={nameId}
                  autoComplete="off"
                  spellCheck={false}
                  value={row.key}
                  onChange={(e) => update(i, { key: e.target.value })}
                />
                <span id={valueId} className="tk-sr">
                  {`${row.key.trim() || copy.name} ${copy.value}`}
                </span>
                <SecretRefInput
                  value={row.value}
                  onChange={(value) => update(i, { value })}
                  labelledBy={valueId}
                  options={options}
                  stored={stored}
                  suggestion={suggestion}
                />
                <IconButton
                  size="sm"
                  aria-label={copy.remove}
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                >
                  <X size={14} strokeWidth={1.6} aria-hidden />
                </IconButton>
              </div>
            );
          })}
        </div>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="tk-btn-inline"
        onClick={() => {
          added.current = true;
          onChange([...rows, { key: "", value: "" }]);
        }}
      >
        <Plus size={13} strokeWidth={1.6} aria-hidden />
        <span>{copy.add}</span>
      </Button>
    </div>
  );
}
