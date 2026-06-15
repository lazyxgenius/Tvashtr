import React from 'react';

interface Option { value: string; label: string; }

/** Styled native select with the same label/helper shell as Input. */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: React.ReactNode;
  optional?: boolean;
  helper?: React.ReactNode;
  error?: React.ReactNode;
  /** Convenience: pass options instead of children. Strings or {value,label}. */
  options?: Array<string | Option>;
  children?: React.ReactNode;
}

export function Select(props: SelectProps): JSX.Element;
