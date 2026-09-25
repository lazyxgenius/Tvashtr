/**
 * React port of the Tvashtr Labs design system components (Button, IconButton, Logo, Avatar, Badge,
 * Card, Checkbox, Field, Input, Select, Switch, Tabs). Props and markup mirror the design bundle so a
 * screen written against the design file renders at the same size; classes use the `ds-` prefix
 * (see ds.css for why).
 */
import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  forwardRef,
  useId,
  useRef,
  useState,
} from "react";

import { cx, initials } from "./utils";

// ---- Button ----

export type ButtonVariant = "primary" | "secondary" | "ghost" | "tint" | "danger";
export type ControlSize = "sm" | "md" | "lg";

interface ButtonOwnProps {
  variant?: ButtonVariant;
  size?: ControlSize;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
}

export type ButtonProps = ButtonOwnProps & ButtonHTMLAttributes<HTMLButtonElement>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    iconLeft,
    iconRight,
    loading = false,
    fullWidth = false,
    disabled = false,
    className,
    children,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "ds-btn",
        `ds-btn--${variant}`,
        `ds-btn--${size}`,
        fullWidth && "ds-btn--block",
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="ds-btn__spin" aria-hidden="true" />}
      {!loading && iconLeft}
      {children !== undefined && children !== null && <span>{children}</span>}
      {!loading && iconRight}
    </button>
  );
});

/** A link styled as a Button (e.g. "Open PR", "Download"). */
export function ButtonLink({
  variant = "secondary",
  size = "sm",
  iconLeft,
  iconRight,
  className,
  children,
  ...rest
}: Omit<ButtonOwnProps, "loading" | "fullWidth"> & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={cx("ds-btn", `ds-btn--${variant}`, `ds-btn--${size}`, className)} {...rest}>
      {iconLeft}
      {children !== undefined && children !== null && <span>{children}</span>}
      {iconRight}
    </a>
  );
}

// ---- IconButton ----

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "ghost" | "outline" | "solid";
  size?: ControlSize;
  active?: boolean;
  "aria-label": string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = "ghost", size = "md", active = false, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "ds-iconbtn",
        `ds-iconbtn--${size}`,
        variant === "outline" && "ds-iconbtn--outline",
        variant === "solid" && "ds-iconbtn--solid",
        active && "ds-iconbtn--active",
        className,
      )}
      aria-pressed={active || undefined}
      {...rest}
    >
      {children}
    </button>
  );
});

// ---- Logo ----

export function Logo({
  size = 28,
  showWordmark = true,
  wordmark = "Tvashtr",
  tone = "coral",
  inverse = false,
  className,
}: {
  size?: number;
  showWordmark?: boolean;
  wordmark?: string;
  tone?: "coral" | "charcoal";
  inverse?: boolean;
  className?: string;
}) {
  return (
    <span className={cx("ds-logo", inverse && "ds-logo--inverse", className)}>
      <img
        className="ds-logo__mark"
        src={tone === "charcoal" ? "/mark-charcoal.png" : "/mark-coral.png"}
        width={size}
        height={size}
        alt={showWordmark ? "" : "Tvashtr"}
      />
      {showWordmark && (
        <span className="ds-logo__word" style={{ fontSize: Math.round(size * 0.78) }}>
          {wordmark}
        </span>
      )}
    </span>
  );
}

// ---- Avatar ----

export function Avatar({
  name = "",
  src,
  size = "md",
  shape = "circle",
  accent = false,
  className,
  ...rest
}: {
  name?: string;
  src?: string;
  size?: "xs" | "sm" | "md" | "lg";
  shape?: "circle" | "square";
  accent?: boolean;
} & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cx(
        "ds-avatar",
        `ds-avatar--${size}`,
        shape === "square" && "ds-avatar--square",
        accent && "ds-avatar--accent",
        className,
      )}
      {...rest}
    >
      {src ? <img src={src} alt={name} /> : initials(name)}
    </span>
  );
}

// ---- Badge ----

export type BadgeVariant =
  | "neutral"
  | "accent"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "outline";

export function Badge({
  variant = "neutral",
  dot = false,
  className,
  children,
  ...rest
}: { variant?: BadgeVariant; dot?: boolean } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cx("ds-badge", `ds-badge--${variant}`, className)} {...rest}>
      {dot && <span className="ds-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

// ---- Card ----

export function Card({
  variant = "paper",
  pad = "md",
  interactive = false,
  as: Tag = "div",
  className,
  children,
  ...rest
}: {
  variant?: "paper" | "panel" | "raised" | "inverse";
  pad?: "none" | "sm" | "md" | "lg";
  interactive?: boolean;
  as?: "div" | "section" | "article" | "li";
} & HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      className={cx(
        "ds-card",
        variant === "panel" && "ds-card--panel",
        variant === "raised" && "ds-card--raised",
        variant === "inverse" && "ds-card--inverse",
        pad !== "md" && `ds-card--pad-${pad}`,
        interactive && "ds-card--interactive",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

// ---- Checkbox / Radio ----

export function Checkbox({
  type = "checkbox",
  label,
  description,
  className,
  ...rest
}: {
  type?: "checkbox" | "radio";
  label?: ReactNode;
  description?: ReactNode;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const round = type === "radio";
  return (
    <label className={cx("ds-check", className)}>
      <input type={type} {...rest} />
      <span className={cx("ds-check__box", round && "ds-check__box--round")} aria-hidden="true">
        {round ? (
          <span className="ds-check__dot" />
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
        )}
      </span>
      {(label || description) && (
        <span className="ds-check__text">
          {label && <span className="ds-check__title">{label}</span>}
          {description && <span className="ds-check__desc">{description}</span>}
        </span>
      )}
    </label>
  );
}

// ---- Field / Input ----

export function Field({
  label,
  optional,
  helper,
  error,
  htmlFor,
  labelAside,
  children,
  className,
}: {
  label?: ReactNode;
  optional?: boolean;
  helper?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  /** Right side of the label row (e.g. a "Templates" link) — used where the design puts one. */
  labelAside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("ds-field", className)}>
      {(label || optional || labelAside) && (
        <div className="ds-field__top">
          {label && (
            <label className="ds-field__label" htmlFor={htmlFor}>
              {label}
            </label>
          )}
          {optional && <span className="ds-field__optional">Optional</span>}
          {labelAside}
        </div>
      )}
      {children}
      {(error || helper) && (
        <span
          className={cx("ds-field__help", Boolean(error) && "ds-field__help--error")}
          role={error ? "alert" : undefined}
        >
          {error || helper}
        </span>
      )}
    </div>
  );
}

interface InputOwnProps {
  label?: ReactNode;
  optional?: boolean;
  helper?: ReactNode;
  error?: ReactNode;
  size?: "sm" | "md";
  mono?: boolean;
}

export const Input = forwardRef<
  HTMLInputElement,
  InputOwnProps & Omit<InputHTMLAttributes<HTMLInputElement>, "size">
>(function Input({ label, optional, helper, error, size, mono, id, className, ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  const control = (
    <input
      ref={ref}
      id={fid}
      className={cx(
        "ds-input",
        Boolean(error) && "ds-input--error",
        size === "sm" && "ds-input--sm",
        mono && "ds-input--mono",
        className,
      )}
      aria-invalid={error ? true : undefined}
      {...rest}
    />
  );
  if (!label && !helper && !error && !optional) return control;
  return (
    <Field label={label} optional={optional} helper={helper} error={error} htmlFor={fid}>
      {control}
    </Field>
  );
});

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  Omit<InputOwnProps, "size"> & TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea(
  { label, optional, helper, error, mono, id, rows = 4, className, ...rest },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  const control = (
    <textarea
      ref={ref}
      id={fid}
      rows={rows}
      className={cx(
        "ds-input",
        "ds-input--area",
        Boolean(error) && "ds-input--error",
        mono && "ds-input--mono",
        className,
      )}
      aria-invalid={error ? true : undefined}
      {...rest}
    />
  );
  if (!label && !helper && !error && !optional) return control;
  return (
    <Field label={label} optional={optional} helper={helper} error={error} htmlFor={fid}>
      {control}
    </Field>
  );
});

// ---- Select ----

export type SelectOption = string | { value: string; label: string };

export function Select({
  label,
  optional,
  helper,
  error,
  id,
  options,
  size,
  className,
  children,
  ...rest
}: {
  label?: ReactNode;
  optional?: boolean;
  helper?: ReactNode;
  error?: ReactNode;
  options?: SelectOption[];
  size?: "sm" | "md";
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "size">) {
  const auto = useId();
  const fid = id ?? auto;
  const control = (
    <span className="ds-select-wrap">
      <select
        id={fid}
        className={cx("ds-select", size === "sm" && "ds-select--sm", className)}
        {...rest}
      >
        {options
          ? options.map((o) => {
              const opt = typeof o === "string" ? { value: o, label: o } : o;
              return (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              );
            })
          : children}
      </select>
      <svg
        className="ds-select-wrap__chevron"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </span>
  );
  if (!label && !helper && !error && !optional) return control;
  return (
    <Field label={label} optional={optional} helper={helper} error={error} htmlFor={fid}>
      {control}
    </Field>
  );
}

// ---- Switch ----

export function Switch({
  label,
  className,
  onCheckedChange,
  onChange,
  disabled,
  ...rest
}: {
  label?: ReactNode;
  onCheckedChange?: (checked: boolean) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role">) {
  return (
    <label className={cx("ds-switch", disabled && "ds-switch--disabled", className)}>
      <input
        type="checkbox"
        role="switch"
        disabled={disabled}
        onChange={(e) => {
          onChange?.(e);
          onCheckedChange?.(e.target.checked);
        }}
        {...rest}
      />
      <span className="ds-switch__track" aria-hidden="true">
        <span className="ds-switch__thumb" />
      </span>
      {label && <span className="ds-switch__label">{label}</span>}
    </label>
  );
}

// ---- Tabs ----

export interface TabItem<V extends string = string> {
  value: V;
  label: ReactNode;
  count?: number | string | null;
  icon?: ReactNode;
}

export function Tabs<V extends string = string>({
  items,
  value,
  defaultValue,
  onChange,
  variant = "line",
  className,
  "aria-label": ariaLabel,
}: {
  items: TabItem<V>[];
  value?: V;
  defaultValue?: V;
  onChange?: (value: V) => void;
  variant?: "line" | "pill";
  className?: string;
  "aria-label"?: string;
}) {
  const [internal, setInternal] = useState<V | undefined>(defaultValue ?? items[0]?.value);
  const active = value !== undefined ? value : internal;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const select = (v: V) => {
    if (value === undefined) setInternal(v);
    onChange?.(v);
  };
  // Arrow keys move between tabs (roving focus), per the WAI-ARIA tabs pattern.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = items.findIndex((it) => it.value === active);
    const next = (i + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    select(items[next].value);
    refs.current[next]?.focus();
    e.preventDefault();
  };
  return (
    <div
      className={cx("ds-tabs", `ds-tabs--${variant}`, className)}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      {items.map((it, i) => {
        const selected = active === it.value;
        return (
          <button
            key={it.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="ds-tab"
            onClick={() => select(it.value)}
          >
            {it.icon}
            <span>{it.label}</span>
            {it.count !== undefined && it.count !== null && (
              <span className="ds-tab__count">{it.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---- Small shared bits ----

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="ds-kbd">{children}</kbd>;
}

export function Count({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "warn";
  className?: string;
}) {
  return (
    <span className={cx("ds-count", tone !== "neutral" && `ds-count--${tone}`, className)}>
      {children}
    </span>
  );
}

/** The small square letter tile the designs put before a team or provider name. */
export function LetterTile({ name, tone = "coral" }: { name: string; tone?: "coral" | "dark" }) {
  return (
    <span className={cx("ds-letter", tone === "dark" && "ds-letter--dark")} aria-hidden="true">
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}
