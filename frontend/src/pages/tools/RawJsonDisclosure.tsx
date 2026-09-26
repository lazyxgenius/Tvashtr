/**
 * "Advanced (raw JSON)" (TkF-AddTool-4, TOOL-39): the server's settings as JSON. Edits here and in
 * the form above stay in sync; JSON that doesn't parse shows an inline error and leaves the form as
 * it was.
 */
import { ChevronDown, ChevronRight } from "lucide-react";
import { useId } from "react";

export function RawJsonDisclosure({
  open,
  onToggle,
  text,
  error,
  onChange,
}: {
  open: boolean;
  onToggle: () => void;
  text: string;
  error: string | null;
  onChange: (text: string) => void;
}) {
  const id = useId();
  const lines = text.split("\n").length;
  return (
    <div className="tk-raw">
      <button
        type="button"
        id={`${id}-toggle`}
        className="tk-raw__toggle"
        aria-expanded={open}
        aria-controls={open ? `${id}-text` : undefined}
        onClick={onToggle}
      >
        {open ? (
          <ChevronDown size={14} strokeWidth={1.6} aria-hidden />
        ) : (
          <ChevronRight size={14} strokeWidth={1.6} aria-hidden />
        )}
        Advanced (raw JSON)
      </button>
      {open && (
        <>
          <textarea
            id={`${id}-text`}
            className="tk-raw__text"
            aria-labelledby={`${id}-toggle`}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-note`}
            spellCheck={false}
            autoComplete="off"
            value={text}
            style={{ height: lines * 19.8 + 26 }}
            onChange={(e) => onChange(e.target.value)}
          />
          {error ? (
            <span id={`${id}-note`} className="tk-raw__note tk-raw__note--error" role="alert">
              {error}
            </span>
          ) : (
            <span id={`${id}-note`} className="tk-raw__note">
              Edits here and in the form above stay in sync.
            </span>
          )}
        </>
      )}
    </div>
  );
}
