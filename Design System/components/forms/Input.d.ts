import React from 'react';

/**
 * Large, low-contrast text input with an optional label/helper/error
 * shell. Set `multiline` for a textarea.
 *
 * @startingPoint section="Forms" subtitle="Labelled inputs, textarea, helper & error text" viewport="700x300"
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Field label rendered above the control. */
  label?: React.ReactNode;
  /** Show a plain "Optional" marker next to the label. */
  optional?: boolean;
  /** Helper text under the control. */
  helper?: React.ReactNode;
  /** Error text under the control (overrides helper, turns control red). */
  error?: React.ReactNode;
  /** Compact height. @default undefined (44px) */
  size?: 'sm';
  /** Render a textarea instead of an input. @default false */
  multiline?: boolean;
  /** Textarea rows when multiline. @default 4 */
  rows?: number;
}

export function Input(props: InputProps): JSX.Element;

export interface FieldProps {
  label?: React.ReactNode;
  optional?: boolean;
  helper?: React.ReactNode;
  error?: React.ReactNode;
  htmlFor?: string;
  children?: React.ReactNode;
}
/** Label + helper/error shell. Wrap any custom control to match form styling. */
export function Field(props: FieldProps): JSX.Element;
