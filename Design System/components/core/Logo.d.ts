import React from 'react';

/** Brand lockup — the rosette mark plus optional wordmark. Color (tone) is the only thing that may change about the mark. */
export interface LogoProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Mark color. @default "coral" */
  tone?: 'coral' | 'charcoal' | 'cream';
  /** Mark pixel size (square). @default 28 */
  size?: number;
  /** Show the "Tvashtr" wordmark next to the mark. @default true */
  showWordmark?: boolean;
  /** Override wordmark text. @default "Tvashtr" */
  wordmark?: string;
  /** Override the mark image path (set to your asset path if not at the default). */
  markSrc?: string;
  /** Use light wordmark color on dark/coral surfaces. @default false */
  inverse?: boolean;
}

export function Logo(props: LogoProps): JSX.Element;
