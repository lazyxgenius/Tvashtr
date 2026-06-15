import React from 'react';

/** Checkbox or radio with optional label + description. Pass type="radio" for a round control. */
export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** "checkbox" (square) or "radio" (round). @default "checkbox" */
  type?: 'checkbox' | 'radio';
  /** Inline label text. */
  label?: React.ReactNode;
  /** Secondary description under the label. */
  description?: React.ReactNode;
}

export function Checkbox(props: CheckboxProps): JSX.Element;
