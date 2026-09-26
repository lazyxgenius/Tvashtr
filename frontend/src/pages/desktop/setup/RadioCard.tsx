import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
} from "react";

interface GroupContext {
  value: string | null;
  values: readonly string[];
  select: (value: string) => void;
}

const Ctx = createContext<GroupContext | null>(null);

const NEXT_KEYS = new Set(["ArrowDown", "ArrowRight"]);
const PREV_KEYS = new Set(["ArrowUp", "ArrowLeft"]);

/**
 * A group of radio cards (desktop-app.md DT-29, DT-34): one tab stop — the checked card, else the
 * first — and the arrow keys move the choice (wrapping), Space selects the focused card. `values`
 * is the cards' order.
 */
export function RadioCardGroup({
  label,
  value,
  values,
  onChange,
  className,
  children,
}: {
  label: string;
  value: string | null;
  values: readonly string[];
  onChange: (value: string) => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const select = useCallback((v: string) => onChange(v), [onChange]);
  const ctx = useMemo(() => ({ value, values, select }), [value, values, select]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const current = target.getAttribute("data-radio-value");
    if (target.getAttribute("role") !== "radio" || current === null) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      select(current);
      return;
    }
    const step = NEXT_KEYS.has(e.key) ? 1 : PREV_KEYS.has(e.key) ? -1 : 0;
    if (!step || values.length === 0) return;
    e.preventDefault();
    const at = values.indexOf(current);
    const next = values[(at + step + values.length) % values.length];
    select(next);
    const el = ref.current?.querySelector<HTMLElement>(
      `[role="radio"][data-radio-value="${CSS.escape(next)}"]`,
    );
    el?.focus();
  };

  return (
    <div ref={ref} role="radiogroup" aria-label={label} className={className} onKeyDown={onKeyDown}>
      <Ctx.Provider value={ctx}>{children}</Ctx.Provider>
    </div>
  );
}

/**
 * One radio card. With `indicator` (Project) the drawn circle is the radio and the card's extra
 * content (the folder row and its buttons) sits beside it, outside the radio; without it (First
 * team) the whole card is the radio. A click anywhere on the card chooses it.
 */
export function RadioCard({
  value,
  title,
  description,
  indicator = false,
  className,
  children,
}: {
  value: string;
  title: ReactNode;
  description: ReactNode;
  indicator?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("RadioCard must sit inside a RadioCardGroup");
  const titleId = useId();
  const descId = useId();
  const checked = ctx.value === value;
  const tabbable = checked || (ctx.value === null && ctx.values[0] === value);
  const radio = {
    role: "radio" as const,
    "aria-checked": checked,
    "aria-labelledby": titleId,
    "aria-describedby": descId,
    tabIndex: tabbable ? 0 : -1,
    "data-radio-value": value,
  };
  const classes = ["st-card", checked && "st-card--checked", className].filter(Boolean).join(" ");
  const choose = () => {
    if (!checked) ctx.select(value);
  };
  const text = (
    <>
      <span id={titleId} className="st-card__title">
        {title}
      </span>
      <span id={descId} className="st-card__desc">
        {description}
      </span>
    </>
  );

  if (!indicator) {
    return (
      <div {...radio} className={classes} onClick={choose}>
        {text}
        {children}
      </div>
    );
  }
  return (
    <div className={classes} onClick={choose}>
      <span {...radio} className="st-card__dot">
        {checked && <span className="st-card__dot-fill" />}
      </span>
      <div className="st-card__body">
        {text}
        {children}
      </div>
    </div>
  );
}
